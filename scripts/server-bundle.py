"""Build an immutable headless server bundle, with only its two runtime packages."""
import hashlib
import io
import json
import tarfile
from pathlib import Path

project = Path(__file__).resolve().parents[1]
metadata = json.loads((project / 'package.json').read_text(encoding='utf-8'))
destination = project.parent / f"dead-frequency-server-{metadata['version']}.tar.gz"
packages = ['ws', '@dimforge/rapier3d-compat']
dependencies = {name: json.loads((project / 'node_modules' / name / 'package.json').read_text(encoding='utf-8'))['version'] for name in packages}
manifest = {'name': 'dead-frequency-server', 'private': True, 'version': metadata['version'], 'type': 'module',
            'scripts': {'start': 'node server/start.js'}, 'dependencies': dependencies}
with tarfile.open(destination, 'w:gz', dereference=True) as archive:
    content = json.dumps(manifest, indent=2).encode()
    info = tarfile.TarInfo('package.json'); info.size = len(content); info.mode = 0o644
    archive.addfile(info, io.BytesIO(content))
    for folder in ['server', 'src', 'deploy']:
        for source in sorted((project / folder).rglob('*')):
            if source.is_file() and source.suffix in {'.js', '.cjs', '.json', '.conf', '.service', '.timer', '.sh', '.example', '.md'}:
                archive.add(source, arcname=source.relative_to(project).as_posix())
    for name in packages:
        archive.add(project / 'node_modules' / name, arcname=f'node_modules/{name}')
print(json.dumps({'path': str(destination), 'bytes': destination.stat().st_size,
                  'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(), 'dependencies': dependencies}))
