"""Publish deterministic, self-contained discovery archives from plugin sources."""
from pathlib import Path
import hashlib, io, json, re, sys, zipfile

root = Path(__file__).resolve().parents[1]
source = root / 'plugins/tallyhand/skills'
target = root / 'public/.well-known/agent-skills'
outputs = {}
skills = []
for directory in sorted(source.iterdir()):
    if not directory.is_dir():
        continue
    text = (directory / 'SKILL.md').read_text()
    match = re.match(r'^---\nname: ([a-z0-9-]+)\ndescription: ("[^\n]+")\n---\n', text)
    if not match or match[1] != directory.name:
        raise ValueError(f'Invalid skill frontmatter: {directory.name}')
    data = io.BytesIO()
    with zipfile.ZipFile(data, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(directory.rglob('*')):
            if path.is_symlink():
                raise ValueError('Skill archives cannot contain symlinks')
            if not path.is_file():
                continue
            info = zipfile.ZipInfo(path.relative_to(directory).as_posix(), (2026, 10, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes())
    blob = data.getvalue()
    filename = f'{directory.name}.zip'
    outputs[filename] = blob
    skills.append({
        'name': directory.name, 'description': json.loads(match[2]), 'type': 'archive',
        'url': f'/.well-known/agent-skills/{filename}',
        'digest': 'sha256:' + hashlib.sha256(blob).hexdigest(),
    })
outputs['index.json'] = (json.dumps({
    '$schema': 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
    'skills': skills,
}, indent=2) + '\n').encode()
if '--check' in sys.argv:
    if not target.exists() or {p.name for p in target.iterdir()} != set(outputs):
        raise ValueError('Regenerate the agent skills discovery files')
    for name, blob in outputs.items():
        if (target / name).read_bytes() != blob:
            raise ValueError(f'Stale skill discovery artifact: {name}')
else:
    target.mkdir(parents=True, exist_ok=True)
    for path in target.iterdir():
        if path.name not in outputs:
            raise ValueError(f'Remove obsolete skill artifact: {path}')
    for name, blob in outputs.items():
        (target / name).write_bytes(blob)
print(f'Verified discovery index and {len(skills)} skill archives')
