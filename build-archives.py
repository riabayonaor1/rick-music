#!/usr/bin/env python3
"""Package source and the self-contained browser edition, without dependencies."""
from pathlib import Path
import os
import zipfile

root = Path(__file__).resolve().parent
output = root.parent
excluded = {'node_modules', '.git', '.DS_Store', '__pycache__', '.swiftpm', 'work'}

def write_archive(name, entries):
    target = output / name
    temporary = target.with_name('.' + name + '.new.' + str(os.getpid()))
    try:
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for source, destination in entries:
                archive.write(source, destination)
        with zipfile.ZipFile(temporary) as archive:
            damaged = archive.testzip()
            if damaged:
                raise RuntimeError('Miembro ZIP dañado: ' + damaged)
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    print(f'Creado y CRC verificado: {target} ({target.stat().st_size} bytes)')

sources = []
for path in sorted(root.rglob('*')):
    relative = path.relative_to(root)
    if any(part in excluded for part in relative.parts) or not path.is_file():
        continue
    sources.append((path, str(Path('RickMusic') / relative)))

portable = [(output / 'RickMusicWeb.html', 'Rick Music Portable/RickMusicWeb.html'),
            (root / 'PORTABLE.txt', 'Rick Music Portable/LEEME.txt'),
            (root / 'LEEME.txt', 'Rick Music Portable/MANUAL.txt'),
            (root / 'FUNCIONES.txt', 'Rick Music Portable/FUNCIONES.txt'),
            (root / 'TERCEROS.txt', 'Rick Music Portable/TERCEROS.txt')]
for path in sorted((root / 'LICENSES').glob('*')):
    if path.is_file():
        portable.append((path, str(Path('Rick Music Portable/LICENSES') / path.name)))
for path in sorted((root / 'Ejemplos').rglob('*')):
    if path.is_file() and path.name != '.DS_Store':
        portable.append((path, str(Path('Rick Music Portable/Ejemplos') / path.relative_to(root / 'Ejemplos'))))
for path, _ in sources + portable:
    if not path.is_file():
        raise FileNotFoundError(path)
# A copy travels with each distributed ZIP, so the preferred LGPL library
# source and editable application/build code remain available to recipients.
write_archive('Rick-Music-fuentes.zip', sources)
source_archive = output / 'Rick-Music-fuentes.zip'
portable.append((source_archive, 'Rick Music Portable/Fuentes-Rick-Music.zip'))
write_archive('Rick-Music-Portable.zip', portable)
native = output / 'Rick-Music-macOS.zip'
if not native.is_file():
    raise FileNotFoundError('Primero ejecuta build-macos.sh: ' + str(native))
temporary = native.with_name('.' + native.name + '.sources.new.' + str(os.getpid()))
try:
    with zipfile.ZipFile(native) as original, zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for info in original.infolist():
            if info.filename != 'Fuentes-Rick-Music.zip':
                archive.writestr(info, original.read(info.filename))
        archive.write(source_archive, 'Fuentes-Rick-Music.zip')
    with zipfile.ZipFile(temporary) as archive:
        damaged = archive.testzip()
        if damaged:
            raise RuntimeError('Miembro ZIP nativo dañado: ' + damaged)
    temporary.replace(native)
finally:
    temporary.unlink(missing_ok=True)
print('Fuentes recompilables adjuntas al ZIP nativo; el bundle firmado no se modifica.')
