/**
 * @jest-environment node
 *
 * Task #78 — Regression tests for the request-body validation that was
 * added in Task #69 to the high-traffic endpoints (campaigns, prospect
 * messages/file-requests, signature endpoints, portal messages/uploads).
 *
 * These tests import the SAME `safeParse`-able Zod schemas that
 * `server/routes.ts` uses at runtime (re-exported from
 * `server/lib/validators.ts`). Each test then mounts the schema on a
 * tiny Express handler that mirrors the production 400 envelope, so the
 * assertions cover both the schema itself and the agreed-upon response
 * shape:
 *
 *   { error|message: string, errors|details: { formErrors, fieldErrors } }
 *
 * Because the schema instance is shared with production, any change in
 * `server/routes.ts`'s validation contract — loosening a field, dropping
 * a `min(1)`, accepting wrong types — automatically flips these tests
 * red without requiring any test edits.
 */
import { describe, it, expect } from '@jest/globals';
import request from 'supertest';
import express, { type Request, type Response } from 'express';
import type { ZodTypeAny } from 'zod';
import {
  messageBodySchema,
  fileRequestBodySchema,
  portalUploadBodySchema,
  signatureRequestBodySchema,
  signatureSubmitBodySchema,
  inlineSignatureBodySchema,
  campaignCreateBodySchema,
  campaignUpdateBodySchema,
} from '../lib/validators';

// Build a single-route Express app whose handler exactly matches the
// production 400 envelope used in `server/routes.ts`. The schema is
// passed in by reference so production and tests share the same Zod
// instance.
function mountValidatedRoute(
  schema: ZodTypeAny,
  errorMessage: string,
  errorKey: 'errors' | 'details',
  topKey: 'error' | 'message' = errorKey === 'details' ? 'error' : 'message',
) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.post('/test', (req: Request, res: Response) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        [topKey]: errorMessage,
        [errorKey]: parsed.error.flatten(),
      });
    }
    res.status(200).json({ ok: true, data: parsed.data });
  });
  return app;
}

// Asserting the flattened shape protects against anyone "fixing" a
// failing test by switching to `format()` (deeply nested) or by stripping
// the structured errors entirely.
function expectFlattenedZodError(body: unknown, errorKey: 'errors' | 'details') {
  expect(body).toEqual(
    expect.objectContaining({
      [errorKey]: expect.objectContaining({
        formErrors: expect.any(Array),
        fieldErrors: expect.any(Object),
      }),
    }),
  );
}

// ── POST /api/campaigns ───────────────────────────────────────────────────
describe('POST /api/campaigns body validation', () => {
  const app = mountValidatedRoute(campaignCreateBodySchema, 'Invalid campaign payload', 'details');

  it('accepts a valid payload', async () => {
    const res = await request(app)
      .post('/test')
      .send({ name: 'Spring Promo', acquirer: 'Wells Fargo', acquirerId: 1 })
      .expect(200);
    expect(res.body.data).toEqual(expect.objectContaining({ name: 'Spring Promo' }));
  });

  it('rejects missing required fields with 400 + flattened Zod errors', async () => {
    const res = await request(app).post('/test').send({}).expect(400);
    expect(res.body.error).toMatch(/invalid campaign payload/i);
    expectFlattenedZodError(res.body, 'details');
    // `name` is required by insertCampaignSchema (drizzle-zod NOT NULL).
    expect(res.body.details.fieldErrors.name).toBeDefined();
  });

  it('rejects wrong types in extended fields (equipmentIds must be number[])', async () => {
    const res = await request(app)
      .post('/test')
      .send({ name: 'X', acquirer: 'Y', acquirerId: 1, equipmentIds: ['nope'] })
      .expect(400);
    expectFlattenedZodError(res.body, 'details');
    expect(res.body.details.fieldErrors.equipmentIds).toBeDefined();
  });
});

// ── PUT /api/campaigns/:id ────────────────────────────────────────────────
describe('PUT /api/campaigns/:id body validation', () => {
  const app = mountValidatedRoute(campaignUpdateBodySchema, 'Invalid campaign payload', 'details');

  it('accepts an empty patch (all fields are optional via .partial())', async () => {
    await request(app).post('/test').send({}).expect(200);
  });

  it('rejects pricingTypeIds when not number[]', async () => {
    const res = await request(app)
      .post('/test')
      .send({ pricingTypeIds: ['1', '2'] })
      .expect(400);
    expectFlattenedZodError(res.body, 'details');
    expect(res.body.details.fieldErrors.pricingTypeIds).toBeDefined();
  });
});

// ── POST /api/prospects/:id/messages ──────────────────────────────────────
// ── POST /api/portal/messages ─────────────────────────────────────────────
// (Both endpoints share the same `messageBodySchema` in production.)
describe('POST /api/{prospects/:id|portal}/messages body validation', () => {
  const app = mountValidatedRoute(messageBodySchema, 'Invalid message payload', 'errors');

  it('accepts a valid message body', async () => {
    await request(app).post('/test').send({ subject: 'Hi', message: 'Hello' }).expect(200);
  });

  it('rejects an empty message with 400 + flattened Zod errors', async () => {
    const res = await request(app).post('/test').send({ message: '' }).expect(400);
    expect(res.body.message).toMatch(/invalid message payload/i);
    expectFlattenedZodError(res.body, 'errors');
    expect(res.body.errors.fieldErrors.message).toBeDefined();
  });

  it('rejects a non-string message with 400', async () => {
    const res = await request(app).post('/test').send({ message: 12345 }).expect(400);
    expectFlattenedZodError(res.body, 'errors');
    expect(res.body.errors.fieldErrors.message).toBeDefined();
  });
});

// ── POST /api/prospects/:id/file-requests ─────────────────────────────────
describe('POST /api/prospects/:id/file-requests body validation', () => {
  const app = mountValidatedRoute(fileRequestBodySchema, 'Invalid file request payload', 'errors');

  it('accepts a valid payload', async () => {
    await request(app)
      .post('/test')
      .send({ label: 'Drivers License', required: true })
      .expect(200);
  });

  it('rejects empty label with 400 + flattened Zod errors', async () => {
    const res = await request(app).post('/test').send({ label: '' }).expect(400);
    expect(res.body.message).toMatch(/invalid file request payload/i);
    expectFlattenedZodError(res.body, 'errors');
    expect(res.body.errors.fieldErrors.label).toBeDefined();
  });

  it('rejects non-boolean `required` with 400', async () => {
    const res = await request(app)
      .post('/test')
      .send({ label: 'X', required: 'yes' })
      .expect(400);
    expectFlattenedZodError(res.body, 'errors');
    expect(res.body.errors.fieldErrors.required).toBeDefined();
  });
});

// ── POST /api/portal/file-requests/:id/upload ─────────────────────────────
describe('POST /api/portal/file-requests/:id/upload body validation', () => {
  const app = mountValidatedRoute(portalUploadBodySchema, 'Invalid upload payload', 'errors');

  it('accepts a valid payload', async () => {
    await request(app)
      .post('/test')
      .send({ fileName: 'doc.pdf', mimeType: 'application/pdf', fileData: 'aGVsbG8=' })
      .expect(200);
  });

  it('rejects missing fileData with 400 + flattened Zod errors', async () => {
    const res = await request(app)
      .post('/test')
      .send({ fileName: 'doc.pdf', mimeType: 'application/pdf' })
      .expect(400);
    expect(res.body.message).toMatch(/invalid upload payload/i);
    expectFlattenedZodError(res.body, 'errors');
    expect(res.body.errors.fieldErrors.fileData).toBeDefined();
  });

  it('rejects empty strings on every required field with 400', async () => {
    const res = await request(app)
      .post('/test')
      .send({ fileName: '', mimeType: '', fileData: '' })
      .expect(400);
    expectFlattenedZodError(res.body, 'errors');
    expect(res.body.errors.fieldErrors.fileName).toBeDefined();
    expect(res.body.errors.fieldErrors.mimeType).toBeDefined();
    expect(res.body.errors.fieldErrors.fileData).toBeDefined();
  });
});

// ── POST /api/signature-request ───────────────────────────────────────────
describe('POST /api/signature-request body validation', () => {
  const app = mountValidatedRoute(
    signatureRequestBodySchema,
    'Invalid signature request payload',
    'errors',
  );

  it('accepts a valid payload', async () => {
    await request(app)
      .post('/test')
      .send({
        ownerName: 'Jane',
        ownerEmail: 'jane@example.com',
        companyName: 'Acme',
        ownershipPercentage: 100,
        prospectId: 42,
      })
      .expect(200);
  });

  it('rejects an invalid email with 400 + flattened Zod errors', async () => {
    const res = await request(app)
      .post('/test')
      .send({
        ownerName: 'Jane',
        ownerEmail: 'not-an-email',
        companyName: 'Acme',
        ownershipPercentage: 100,
        prospectId: 42,
      })
      .expect(400);
    expect(res.body.message).toMatch(/invalid signature request payload/i);
    expectFlattenedZodError(res.body, 'errors');
    expect(res.body.errors.fieldErrors.ownerEmail).toBeDefined();
  });

  it('rejects missing required fields with 400', async () => {
    const res = await request(app)
      .post('/test')
      .send({ ownerEmail: 'jane@example.com' })
      .expect(400);
    expectFlattenedZodError(res.body, 'errors');
    expect(res.body.errors.fieldErrors.ownerName).toBeDefined();
    expect(res.body.errors.fieldErrors.companyName).toBeDefined();
    expect(res.body.errors.fieldErrors.prospectId).toBeDefined();
  });
});

// ── POST /api/signature-submit ────────────────────────────────────────────
describe('POST /api/signature-submit body validation', () => {
  const app = mountValidatedRoute(
    signatureSubmitBodySchema,
    'Invalid signature payload',
    'errors',
  );

  it('accepts a valid payload', async () => {
    await request(app)
      .post('/test')
      .send({ signatureToken: 'sig_abc', signature: 'Jane', signatureType: 'type' })
      .expect(200);
  });

  it('rejects an empty signatureToken with 400', async () => {
    const res = await request(app)
      .post('/test')
      .send({ signatureToken: '', signature: 'Jane' })
      .expect(400);
    expectFlattenedZodError(res.body, 'errors');
    expect(res.body.errors.fieldErrors.signatureToken).toBeDefined();
  });

  it('rejects an empty signature with 400', async () => {
    const res = await request(app)
      .post('/test')
      .send({ signatureToken: 'sig_abc', signature: '' })
      .expect(400);
    expectFlattenedZodError(res.body, 'errors');
    expect(res.body.errors.fieldErrors.signature).toBeDefined();
  });
});

// ── POST /api/prospects/:id/save-inline-signature ─────────────────────────
describe('POST /api/prospects/:id/save-inline-signature body validation', () => {
  const app = mountValidatedRoute(
    inlineSignatureBodySchema,
    'Invalid inline signature payload',
    'errors',
  );

  it('accepts a valid payload', async () => {
    await request(app)
      .post('/test')
      .send({
        ownerEmail: 'jane@example.com',
        ownerName: 'Jane',
        signature: 'Jane',
        signatureType: 'type',
      })
      .expect(200);
  });

  it('rejects malformed email + missing signatureType with 400', async () => {
    const res = await request(app)
      .post('/test')
      .send({ ownerEmail: 'nope', ownerName: 'Jane', signature: 'Jane' })
      .expect(400);
    expect(res.body.message).toMatch(/invalid inline signature payload/i);
    expectFlattenedZodError(res.body, 'errors');
    expect(res.body.errors.fieldErrors.ownerEmail).toBeDefined();
    expect(res.body.errors.fieldErrors.signatureType).toBeDefined();
  });
});
