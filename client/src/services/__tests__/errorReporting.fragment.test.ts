import { describe, expect, it } from 'vitest';
import { stripToken } from '../errorReporting';

describe('stripToken', () => {
  it('drops the guest secret carried in the fragment', () => {
    expect(stripToken('https://app.example/guest#s3cr3t')).toBe('https://app.example/guest');
  });

  it('still drops a token in the query', () => {
    expect(stripToken('https://app.example/ws?token=abc&x=1')).not.toContain('abc');
  });

  it('leaves an ordinary URL alone', () => {
    expect(stripToken('https://app.example/app')).toBe('https://app.example/app');
  });
});
