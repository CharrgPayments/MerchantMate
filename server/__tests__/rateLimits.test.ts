import { describe, it, expect, beforeEach } from '@jest/globals';
import type { Request, Response } from 'express';
import { rateLimit, clearRateLimitBuckets } from '../rateLimits';

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    ip: '1.2.3.4',
    headers: {},
    socket: {} as any,
    body: {},
    ...overrides,
  } as unknown as Request;
}

function makeRes() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let payload: any = null;
  const res = {
    setHeader: (k: string, v: string) => {
      headers[k.toLowerCase()] = v;
    },
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(data: any) {
      payload = data;
      return this;
    },
    get statusCode() { return statusCode; },
    get payload() { return payload; },
    get headers() { return headers; },
  };
  return res as unknown as Response & { payload: any; headers: Record<string, string> };
}

describe('rateLimit middleware', () => {
  beforeEach(() => clearRateLimitBuckets());

  it('returns 429 once the per-identifier burst limit is exceeded', async () => {
    const limiter = rateLimit({
      scope: 'test:login',
      windowMs: 60_000,
      max: 3,
      keyExtractor: (req) => (req.body as any)?.username,
      message: 'Too many login attempts.',
    });

    let nextCalled = 0;
    const callOnce = (ip: string, username: string) => {
      const req = makeReq({ ip, body: { username } } as any);
      const res = makeRes();
      limiter(req, res, () => { nextCalled++; });
      return res as any;
    };

    callOnce('9.9.9.1', 'jdoe');
    callOnce('9.9.9.2', 'jdoe');
    callOnce('9.9.9.3', 'jdoe');
    expect(nextCalled).toBe(3);

    const blocked = callOnce('9.9.9.4', 'jdoe');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.payload.message).toMatch(/too many/i);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('does not bleed counters across separately-scoped limiters', () => {
    const a = rateLimit({ scope: 'login', windowMs: 60_000, max: 1 });
    const b = rateLimit({ scope: 'forgot-password', windowMs: 60_000, max: 1 });
    const ip = '7.7.7.7';

    let aOk = 0, bOk = 0, blocked = 0;
    const tryHit = (mw: any) => {
      const res = makeRes();
      mw(makeReq({ ip } as any), res, () => {});
      if (res.statusCode === 429) blocked++;
      else if (mw === a) aOk++;
      else bOk++;
    };

    tryHit(a); // a: ok
    tryHit(a); // a: blocked
    tryHit(b); // b: ok — must not be coupled to a
    tryHit(b); // b: blocked

    expect(aOk).toBe(1);
    expect(bOk).toBe(1);
    expect(blocked).toBe(2);
  });

  it('allows requests below the per-IP threshold and blocks above it', () => {
    const limiter = rateLimit({ scope: 'test:ipOnly', windowMs: 60_000, max: 2 });
    const ip = '5.5.5.5';
    let nextCalled = 0;

    for (let i = 0; i < 2; i++) {
      const res = makeRes();
      limiter(makeReq({ ip } as any), res, () => { nextCalled++; });
      expect(res.statusCode).toBe(200);
    }
    expect(nextCalled).toBe(2);

    const res = makeRes();
    limiter(makeReq({ ip } as any), res, () => { nextCalled++; });
    expect(res.statusCode).toBe(429);
    expect(nextCalled).toBe(2); // not incremented when blocked
  });
});
