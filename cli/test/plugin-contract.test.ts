import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { inspectMcpCatalog } from '../src/mcp-catalog.js';
import { AGENT_SKILLS } from '../src/agent-skills.generated.js';
import { settingsPatchSchema, settingsPatchJsonSchema } from '../src/settings-schema.js';
import { readFileSync } from 'node:fs';

describe('published plugin contract', () => {
  it('keeps marketplace identity and portable distribution metadata synchronized', () => {
    const root = new URL('../../', import.meta.url);
    const read = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
    const manifest = read('plugins/tallyhand/plugin.json');
    const marketplace = read('.agents/plugins/marketplace.json');
    const distribution = read('public/plugins/catalog.json');
    expect(marketplace.name).toBe('tallyhand');
    expect(marketplace.plugins).toEqual([{
      name: manifest.name, source: { source: 'local', path: './plugins/tallyhand' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity',
    }]);
    const pkg = distribution.packages[0];
    expect(pkg.version).toBe(manifest.version);
    expect(pkg.installTargets[0].selector).toBe('tallyhand@tallyhand');
    const zip = readFileSync(new URL(`public/plugins/tallyhand-${manifest.version}.zip`, root));
    expect(pkg.sha256).toBe(createHash('sha256').update(zip).digest('hex'));
    expect(manifest.extensions['com.openai'].interface.logo).toBe('./assets/logo.png');
    expect(readFileSync(new URL('plugins/tallyhand/assets/logo.png', root)).length).toBeGreaterThan(0);
    for (const skill of AGENT_SKILLS) {
      const agent = skill.files.find(file => file.uri.endsWith('/agents/openai.yaml'))!;
      expect(agent.text).toMatch(/^interface:\n/);
      expect(agent.text).toMatch(/\n  display_name: "[^"]+"/);
      expect(agent.text).toMatch(/\n  short_description: "[^"]+"/);
      expect(agent.text).toContain('value: "tallyhand"');
    }
  });
  it('advertises typed settings writes and all skill tool references', async () => {
    const catalog = await inspectMcpCatalog();
    const names = new Set(catalog.tools.map(tool => tool.name));
    const tool = catalog.tools.find(tool => tool.name === 'update_settings')!;
    expect(tool).toBeDefined();
    const props = tool.inputSchema.properties as Record<string, any>;
    expect(props.dryRun.type).toBe('boolean');
    expect(props.patch.properties.business.properties.email).toBeDefined();
    expect(props.patch.properties.business.properties.billingEmails).toBeDefined();
    expect(props.patch.properties.invoice.properties.paymentTermsDays).toBeDefined();
    expect(props.patch.properties.invoice.properties.defaultPaymentMethod).toBeDefined();
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: false });
    for (const skill of AGENT_SKILLS) {
      for (const match of skill.text.matchAll(/\b((?:get|list|create|update|delete|run|export|import|reset|send|mark|log|bulk|timer|revenue|preview|revoke)_[a-z_]+)\b/g)) {
        // Domain values and field names are not tool references.
        if (/^(get|list|create|update|delete|run|export|import|reset|send|mark|log|bulk|timer|revenue|preview|revoke)_/.test(match[1]))
          expect(names.has(match[1]), `${skill.frontmatter.name}: ${match[1]}`).toBe(true);
      }
      expect(skill.files.some(file => file.uri.endsWith('/agents/openai.yaml') && file.text.includes('value: "tallyhand"'))).toBe(true);
      for (const resource of skill.resources) {
        const file = skill.files.find(file => file.uri === resource.uri)!;
        expect(resource.digest).toBe(`sha256:${createHash('sha256').update(file.text).digest('hex')}`);
      }
    }
  });
  it('accepts multiple billing contacts explicitly and rejects concatenated primary email', () => {
    expect(settingsPatchSchema.safeParse({ business: { email: 'one@example.com', billingEmails: ['two@example.com'] }, invoice: { paymentTermsDays: 30, defaultPaymentMethod: 'Direct Deposit' } }).success).toBe(true);
    expect(settingsPatchSchema.safeParse({ business: { email: 'one@example.com,two@example.com' } }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ business: { billingEmails: Array(11).fill('one@example.com') } }).success).toBe(false);
    expect(settingsPatchJsonSchema.properties).toHaveProperty('invoice');
    expect(settingsPatchJsonSchema.properties).not.toHaveProperty('invoiceDefaults');
  });
});
