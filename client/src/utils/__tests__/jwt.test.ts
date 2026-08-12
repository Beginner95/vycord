import { describe, it, expect } from 'vitest';
import { decodeJwtExpMs } from '@/utils/jwt';

function makeToken(payload: object): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fake-signature`;
}

describe('decodeJwtExpMs', () => {
  it('returns exp in milliseconds for a well-formed token', () => {
    const expSeconds = Math.floor(Date.now() / 1000) + 900;
    const token = makeToken({ user_id: 'abc', exp: expSeconds });
    expect(decodeJwtExpMs(token)).toBe(expSeconds * 1000);
  });

  it('returns null for a token without exp', () => {
    const token = makeToken({ user_id: 'abc' });
    expect(decodeJwtExpMs(token)).toBeNull();
  });

  it('returns null for a malformed token', () => {
    expect(decodeJwtExpMs('not-a-jwt')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(decodeJwtExpMs('')).toBeNull();
  });
});
