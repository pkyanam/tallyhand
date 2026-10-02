import { describe, expect, it, vi } from 'vitest';
import { containsRestrictedFields, omitRestrictedFields, mcpSettingsPatchSchema, withMcpPrivacy } from '../src/mcp-privacy.js';
import type { Api } from '../src/commands.js';
describe('MCP-only restricted field minimization', () => {
  it('omits nested restricted fields but preserves bookkeeping data and sharing tokens', () => {
    expect(omitRestrictedFields({ business: { name: 'Example', taxId: 'synthetic-id' }, invoice: { taxIdLabel: 'Tax ID', publicToken: 'share-example' }, records: [{ api_key: 'fixture', amount: 45 }] })).toEqual({ business: { name: 'Example' }, invoice: { taxIdLabel: 'Tax ID', publicToken: 'share-example' }, records: [{ amount: 45 }] });
  });
  it('does not advertise tax-ID writes in the MCP settings schema', () => {
    expect(mcpSettingsPatchSchema.safeParse({ business: { taxId: 'synthetic' } }).success).toBe(false);
    expect(mcpSettingsPatchSchema.safeParse({ business: { name: 'Example', billingEmails: ['demo@example.com'] }, invoice: { paymentTermsDays: 30 } }).success).toBe(true);
  });
  it('blocks restricted writes before calling the API', async () => {
    const updateSettings = vi.fn(); const api = withMcpPrivacy({ updateSettings } as unknown as Api);
    await expect(api.updateSettings({ business: { taxId: 'synthetic' } })).rejects.toThrow('Restricted');
    expect(updateSettings).not.toHaveBeenCalled();
  });
  it('sanitizes reads without mutating the API result or direct API behavior', async () => {
    const original = { business: { name: 'Example', taxId: 'synthetic' } }; const getSettings = vi.fn().mockResolvedValue(original);
    expect(await withMcpPrivacy({ getSettings } as unknown as Api).getSettings()).toEqual({ business: { name: 'Example' } });
    expect(original.business.taxId).toBe('synthetic');
    expect(await getSettings()).toBe(original);
  });
  it('never creates a lossy backup', async () => {
    const api = withMcpPrivacy({ backup: vi.fn().mockResolvedValue({ settings: { business: { taxId: 'synthetic' } } }) } as unknown as Api);
    await expect(api.backup!()).rejects.toThrow('no partial backup');
  });
  it('preserves ordinary backup contents and permits blank legacy sensitive fields', async () => {
    expect(containsRestrictedFields({ taxId: '' })).toBe(false);
    const value = { settings: { business: { name: 'Example', taxId: '' } }, tasks: [] };
    const api = withMcpPrivacy({ backup: vi.fn().mockResolvedValue(value) } as unknown as Api);
    expect(await api.backup!()).toEqual(value);
  });
});
