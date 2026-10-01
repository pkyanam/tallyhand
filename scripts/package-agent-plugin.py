"""Deterministic public plugin ZIP; only reviewed plugin sources are included."""
from pathlib import Path
import hashlib, io, sys, zipfile
root = Path(__file__).resolve().parents[1]
source = root / 'plugins/tallyhand'
out = root / 'public/plugins/tallyhand-0.3.0.zip'
data = io.BytesIO()
with zipfile.ZipFile(data, 'w', zipfile.ZIP_DEFLATED) as z:
    for p in sorted(source.rglob('*')):
        if not p.is_file(): continue
        rel = p.relative_to(source).as_posix()
        if rel not in ('plugin.json','mcp.json','.mcp.json','.codex-plugin/plugin.json','assets/logo.png') and not (rel.startswith('skills/') and rel.endswith('/SKILL.md')):
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
