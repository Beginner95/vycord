import { describe, it, expect } from 'vitest';
import { inviteExpiry } from './inviteExpiry';

const NOW = new Date('2026-08-25T12:00:00Z');
const daysFromNow = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

describe('inviteExpiry', () => {
  it('no expires_at → never', () => {
    expect(inviteExpiry(undefined, NOW)).toEqual({ kind: 'never' });
  });

  it('unparseable expires_at degrades to never', () => {
    expect(inviteExpiry('not-a-date', NOW)).toEqual({ kind: 'never' });
  });

  it('exactly 7 days → 7', () => {
    expect(inviteExpiry(daysFromNow(7), NOW)).toEqual({ kind: 'days', days: 7 });
  });

  it('partial days round up', () => {
    expect(inviteExpiry(daysFromNow(6.5), NOW)).toEqual({ kind: 'days', days: 7 });
  });

  it('less than a day clamps to 1', () => {
    expect(inviteExpiry(daysFromNow(0.02), NOW)).toEqual({ kind: 'days', days: 1 });
  });

  it('already expired clamps to 1 (freshly-created invites only reach the card)', () => {
    expect(inviteExpiry(daysFromNow(-1), NOW)).toEqual({ kind: 'days', days: 1 });
  });
});
