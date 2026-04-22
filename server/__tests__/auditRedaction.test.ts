import { describe, it, expect } from '@jest/globals';
import { redactSensitive } from '../auditRedaction';

describe('redactSensitive', () => {
  it('redacts password and password-related fields in a CRUD payload', () => {
    const reqBody = {
      username: 'jdoe',
      password: 'hunter2',
      passwordHash: 'bcrypt$abc',
      passwordResetToken: 'tok-123',
      profile: { firstName: 'J', twoFactorSecret: 'TOTP-SECRET' },
    };
    const out = redactSensitive(reqBody);
    expect(out.username).toBe('jdoe');
    expect(out.password).toBe('[REDACTED]');
    expect(out.passwordHash).toBe('[REDACTED]');
    expect(out.passwordResetToken).toBe('[REDACTED]');
    expect(out.profile.firstName).toBe('J');
    expect(out.profile.twoFactorSecret).toBe('[REDACTED]');
  });

  it('redacts API key material and tokens', () => {
    const out = redactSensitive({
      keyId: 'visible',
      keySecret: 'should-not-leak',
      apiKey: 'should-not-leak',
      authorization: 'Bearer xyz',
      meta: { secret: 'nope' },
    });
    expect(out.keyId).toBe('visible');
    expect(out.keySecret).toBe('[REDACTED]');
    expect(out.apiKey).toBe('[REDACTED]');
    expect(out.authorization).toBe('[REDACTED]');
    expect(out.meta.secret).toBe('[REDACTED]');
  });

  it('redacts a realistic /api/auth/login response shape before audit persistence', () => {
    // Simulates the response payload the CRUD audit middleware would
    // snapshot when /api/auth/login succeeds. After redactSensitive,
    // the audit row must contain no password / token / 2FA secret.
    const loginResponse = {
      user: {
        id: 'usr_1',
        username: 'jdoe',
        email: 'jdoe@example.com',
        passwordHash: '$2b$10$abcdefghijklmnopqrstuv',
        twoFactorSecret: 'JBSWY3DPEHPK3PXP',
      },
      session: {
        id: 'sess_xyz',
        token: 'st_live_abcdef',
      },
      authorization: 'Bearer eyJhbGc...',
    };
    const requestBody = { username: 'jdoe', password: 'hunter2' };

    const safeReq = redactSensitive(requestBody);
    const safeRes = redactSensitive(loginResponse);

    expect(safeReq.username).toBe('jdoe');
    expect(safeReq.password).toBe('[REDACTED]');

    expect(safeRes.user.username).toBe('jdoe');
    expect(safeRes.user.email).toBe('jdoe@example.com');
    expect(safeRes.user.passwordHash).toBe('[REDACTED]');
    expect(safeRes.user.twoFactorSecret).toBe('[REDACTED]');
    expect(safeRes.session.token).toBe('[REDACTED]');
    expect(safeRes.authorization).toBe('[REDACTED]');

    // Sanity: serialized form contains no plaintext secret material.
    const serialized = JSON.stringify({ req: safeReq, res: safeRes });
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('JBSWY3DPEHPK3PXP');
    expect(serialized).not.toContain('st_live_abcdef');
    expect(serialized).not.toContain('eyJhbGc');
  });

  it('handles arrays and nulls without throwing', () => {
    expect(redactSensitive(null)).toBeNull();
    expect(redactSensitive([{ password: 'x' }, { name: 'ok' }])).toEqual([
      { password: '[REDACTED]' },
      { name: 'ok' },
    ]);
  });
});
