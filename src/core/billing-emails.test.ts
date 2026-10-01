import { describe, expect, it } from 'vitest';
import { billingEmailDisplay, parseBillingEmailsInput } from './billing-emails';
import { DEFAULT_SETTINGS } from './entities';
describe('invoice billing contact emails', () => {
  it('parses common separators and deduplicates case-insensitively', () => {
    expect(parseBillingEmailsInput('a@example.com; b@example.com\na@example.com')).toEqual(['a@example.com', 'b@example.com']);
    expect(parseBillingEmailsInput('')).toEqual([]);
    expect(() => parseBillingEmailsInput('not an address')).toThrow();
  });
  it('renders primary and extra contacts once', () => {
    expect(billingEmailDisplay({ ...DEFAULT_SETTINGS.business, email: 'one@example.com', billingEmails: ['one@example.com', 'two@example.com'] })).toBe('one@example.com, two@example.com');
    expect(billingEmailDisplay({ ...DEFAULT_SETTINGS.business, email: '' })).toBe('');
  });
});
