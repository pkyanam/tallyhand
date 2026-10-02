"""Deterministic public plugin ZIP; only reviewed plugin sources are included."""
from pathlib import Path
import hashlib, io, sys, zipfile, json
root = Path(__file__).resolve().parents[1]
source = root / 'plugins/tallyhand'
manifest = json.loads((source / 'plugin.json').read_text())
version = manifest['version']
interface = manifest['extensions']['com.openai']['interface']
cases = manifest['extensions']['com.openai']['review']['test_cases']
if len(cases['positive']) != 5 or len(cases['negative']) != 3: raise ValueError('OpenAI review requires exactly 5 positive and 3 negative cases')
if len(interface['shortDescription']) > 30: raise ValueError('Listing subtitle exceeds 30 characters')
if len(interface['displayName']) > 30: raise ValueError('Listing name exceeds 30 characters')
if len(interface['longDescription']) > 4000: raise ValueError('Listing description exceeds 4000 characters')
if 'apps' in manifest or 'apps' in manifest['extensions']['com.openai']: raise ValueError('Public upload cannot contain app bindings')
if version != json.loads((source / '.codex-plugin/plugin.json').read_text())['version']: raise ValueError('Manifest version mismatch')
out = root / f'public/plugins/tallyhand-{version}.zip'
data = io.BytesIO()
with zipfile.ZipFile(data, 'w', zipfile.ZIP_DEFLATED) as z:
    for p in sorted(source.rglob('*')):
        if not p.is_file(): continue
        rel = p.relative_to(source).as_posix()
        if rel not in ('plugin.json','mcp.json','.mcp.json','.codex-plugin/plugin.json','assets/logo.png') and not (rel.startswith('skills/') and (rel.endswith('/SKILL.md') or rel.endswith('/agents/openai.yaml') or rel.endswith('/assets/icon.png'))):
            raise ValueError(f'Unreviewed plugin file: {rel}')
        info = zipfile.ZipInfo(rel, (2026,10,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
        info.external_attr=0o100644 << 16
        z.writestr(info,p.read_bytes())
blob=data.getvalue()
if len(blob)>8*1024*1024: raise ValueError('Plugin exceeds import size limit')
if '--check' in sys.argv:
    if out.read_bytes()!=blob: raise ValueError('Regenerate plugin ZIP')
else:
    out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(blob)
    out.with_suffix('.zip.sha256').write_text(hashlib.sha256(blob).hexdigest()+'  '+out.name+'\n')
print(f'Plugin package verified: {len(blob)} bytes')
