"""Assemble the already-built and tested Windows release without touching older versions."""
import hashlib
import json
import argparse
from pathlib import Path
import shutil
import zipfile

project = Path(__file__).resolve().parents[1]
version = json.loads((project / 'package.json').read_text(encoding='utf-8'))['version']
release = project.parents[1] / 'outputs' / f'v{version}'
app = release / 'DEAD FREQUENCY-win32-x64'
work = project.parent
assert (app / 'DEAD FREQUENCY.exe').is_file(), 'Run pnpm build and pnpm package first'
parser = argparse.ArgumentParser()
parser.add_argument('--qa-report', type=Path, default=work / f'qa-coop-native-{version}' / 'result.json')
args = parser.parse_args()
report = json.loads(args.qa_report.read_text(encoding='utf-8'))
assert not report.get('errors') and not report.get('failure') and report.get('native'), 'Native QA must pass before release'
assert Path(report['exe']).resolve() == (app / 'DEAD FREQUENCY.exe').resolve(), 'QA must use the current release'
with (app / 'resources/app.asar').open('rb') as stream:
    assert report.get('appAsarSha256') == hashlib.file_digest(stream, 'sha256').hexdigest(), 'Application changed after native QA'
for destination in [release, app]:
    shutil.copy2(project / 'README.md', destination / 'ANLEITUNG.md')
    shutil.copy2(project / 'public/audio/CREDITS.md', destination / 'AUDIO-QUELLEN.md')

for filename, directory in [('DEAD-FREQUENCY-Windows.zip', app), ('DEAD-FREQUENCY-Quellcode.zip', project)]:
    with zipfile.ZipFile(release / filename, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for source in sorted(directory.rglob('*')):
            if not source.is_file():
                continue
            relative = source.relative_to(directory)
            if directory == project:
                allowed_roots = {'src', 'public', 'scripts', 'tests', 'server', 'launcher', 'vendor', 'deploy', '.github'}
                allowed_files = {'electron.cjs', 'preload.cjs', 'platform.cjs', 'online-platform.cjs', 'index.html', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'README.md', 'vite.config.js', '.gitignore', 'CONTRACT.md', 'CLOUDFLARED-LICENSE.txt', 'CLOUDFLARED-NOTICE.txt', 'RELEASING.md'}
                if (len(relative.parts) > 1 and relative.parts[0] not in allowed_roots) or (len(relative.parts) == 1 and relative.name not in allowed_files):
                    continue
                if relative.suffix.lower() in {'.exe', '.partial', '.log'}:
                    continue
                archive.write(source, relative.as_posix())
            else:
                archive.write(source, (Path(directory.name) / relative).as_posix())

proof = {}
for filename in ['DEAD-FREQUENCY-Windows.zip', 'DEAD-FREQUENCY-Quellcode.zip']:
    with zipfile.ZipFile(release / filename) as archive:
        error = archive.testzip()
        assert error is None, error
        proof[filename] = {'entries': len(archive.infolist()), 'crcVerified': True}

hashes = []
for relative in ['DEAD FREQUENCY-win32-x64/DEAD FREQUENCY.exe', 'DEAD FREQUENCY-win32-x64/resources/app.asar', 'DEAD-FREQUENCY-Windows.zip', 'DEAD-FREQUENCY-Quellcode.zip']:
    source = release / relative
    with source.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    hashes.append(f'{digest}  {relative}')
(release / 'SHA256SUMS.txt').write_text('\n'.join(hashes) + '\n', encoding='utf-8')
(release / 'Paketpruefung.json').write_text(json.dumps(proof, indent=2), encoding='utf-8')
print(json.dumps({'release': str(release), 'archives': proof, 'nativeChecks': len(report['checks'])}, indent=2))
