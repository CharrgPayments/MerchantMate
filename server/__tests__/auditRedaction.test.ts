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

  it('handles arrays and nulls without throwing', () => {
    expect(redactSensitive(null)).toBeNull();
    expect(redactSensitive([{ password: 'x' }, { name: 'ok' }])).toEqual([
      { password: '[REDACTED]' },
      { name: 'ok' },
    ]);
  });
});
