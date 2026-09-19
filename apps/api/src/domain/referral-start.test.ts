import { describe, expect, it } from 'vitest';
import { referralCodeFromStartCommand } from './referral-start.js';

describe('Telegram referral start payloads', () => {
  it('accepts a normal bot deep link', () => expect(referralCodeFromStartCommand('/start ref_GEN-123')).toBe('GEN-123'));
  it('accepts group-style bot commands', () => expect(referralCodeFromStartCommand('/start@smartgenyx_bot ref_GEN_123')).toBe('GEN_123'));
  it('rejects unrelated and malformed commands', () => {
    expect(referralCodeFromStartCommand('/start profile_GEN-123')).toBeUndefined();
    expect(referralCodeFromStartCommand('/start ref_<script>')).toBeUndefined();
  });
});
