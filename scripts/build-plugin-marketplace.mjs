/** Generate host adapters from the portable plugin manifest; never copy secrets. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('plugins/tallyhand/plugin.json', root), 'utf8'));
if (manifest.name !== 'tallyhand' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Invalid plugin identity/version');
const archivePath = `public/plugins/tallyhand-${manifest.version}.zip`;
const sha256 = createHash('sha256').update(readFileSync(new URL(archivePath, root))).digest('hex');
const marketplace = {
  name: 'tallyhand',
  interface: { displayName: 'Tallyhand' },
  plugins: [{
    name: manifest.name,
    source: { source: 'local', path: './plugins/tallyhand' },
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
    category: 'Productivity',
  }],
};
// This is Tallyhand's own distribution index, not a claimed cross-vendor standard.
const catalog = {
  format: 'tallyhand.plugin-catalog.v1',
  repository: 'https://github.com/pkyanam/tallyhand',
  packages: [{
    name: manifest.name, version: manifest.version,
    format: 'agent-plugins-1.0',
    sourcePath: 'plugins/tallyhand',
    archive: `https://tallyhand.xyz/plugins/tallyhand-${manifest.version}.zip`,
    sha256,
    mcpEndpoint: 'https://tallyhand.xyz/api/mcp',
    installTargets: [{
      harness: 'codex', marketplace: 'tallyhand', source: 'pkyanam/tallyhand',
      marketplacePath: '.agents/plugins/marketplace.json', selector: 'tallyhand@tallyhand',
    }],
  }],
};
for (const [path, value] of [['.agents/plugins/marketplace.json', marketplace], ['public/plugins/catalog.json', catalog]]) {
  const url = new URL(path, root); const text = JSON.stringify(value, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (readFileSync(url, 'utf8') !== text) throw new Error(`Regenerate ${path}`);
  } else { mkdirSync(new URL('./', url), { recursive: true }); writeFileSync(url, text); }
}
console.log(`Verified marketplace and distribution catalog for ${manifest.name} ${manifest.version}`);
