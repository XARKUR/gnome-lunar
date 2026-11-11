#!/usr/bin/env python3
"""Local, offline extension project tools. Default action is a read-only plan."""
import argparse
import ast
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import zipfile
from install_utils import extension_update

ROOT = Path(__file__).resolve().parent


def run(args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, **kwargs)


def metadata():
    return json.loads((ROOT / 'src/metadata.json').read_text())


def profile_path():
    local = ROOT / 'profiles/current.json'
    return local if local.is_file() else ROOT / 'profiles/example.json'


def compile_po(source, target):
    """Compile the bundled singular-only PO catalog; reject unsupported syntax."""
    entries, fields, active, fuzzy = {}, {}, None, False

    def flush():
        if 'msgid' in fields and 'msgstr' in fields and not fuzzy:
            key, value = fields['msgid'], fields['msgstr']
            if key == '' or value:
                entries[key] = value

    for line in source.read_text(encoding='utf-8').splitlines() + ['']:
        s = line.strip()
        if not s:
            flush()
            fields, active, fuzzy = {}, None, False
        elif s.startswith('#'):
            fuzzy |= s.startswith('#,') and 'fuzzy' in s
        elif s.startswith(('msgid ', 'msgstr ')):
            active, value = s.split(' ', 1)
            fields[active] = ast.literal_eval(value)
        elif s.startswith('"') and active:
            fields[active] += ast.literal_eval(s)
        else:
            raise ValueError(f'Unsupported PO syntax in {source.name}: {s}')
    keys = sorted(entries)
    originals = [k.encode() for k in keys]
    translations = [entries[k].encode() for k in keys]
    n = len(keys)
    offset = 28 + n * 16
    original_index, translated_index = [], []
    for value in originals:
        original_index.extend((len(value), offset))
        offset += len(value) + 1
    for value in translations:
        translated_index.extend((len(value), offset))
        offset += len(value) + 1
    data = struct.pack('<7I', 0x950412de, 0, n, 28, 28 + n * 8, 0, 0)
    data += struct.pack(f'<{n * 4}I', *(original_index + translated_index))
    data += b''.join(s + b'\0' for s in originals + translations)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)


def stage(destination, shell_major=None):
    shutil.copytree(ROOT / 'src', destination)
    for compiled in destination.rglob('gschemas.compiled'):
        compiled.unlink()
    for name in ['LICENSE', 'NOTICE', 'upstream.lock.json', 'compatibility.json']:
        shutil.copyfile(ROOT / name, destination / name)
    for po in (ROOT / 'po').glob('*.po'):
        compile_po(po, destination / 'locale' / po.stem / 'LC_MESSAGES' /
                   (metadata()['gettext-domain'] + '.mo'))
    if shell_major == '43':
        spec = importlib.util.spec_from_file_location('lunar_legacy43', ROOT / 'legacy43.py')
        legacy = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(legacy)
        legacy.generate(destination)


def check():
    meta = metadata()
    supported = json.loads((ROOT / 'compatibility.json').read_text())['package_shell_versions']['modern']
    if meta['shell-version'] != supported:
        raise ValueError('Metadata and reviewed compatibility matrix disagree.')
    with tempfile.TemporaryDirectory(prefix='gnome-project-check-') as tmp:
        staged = Path(tmp) / 'extension'
        stage(staged)
        run(['glib-compile-schemas', '--strict', staged / 'schemas'])
        # Validate preset values against the new schema in memory, never dconf.
        env = dict(os.environ, GSETTINGS_BACKEND='memory')
        for key, value in json.loads(profile_path().read_text()).items():
            run(['gsettings', '--schemadir', staged / 'schemas', 'set',
                 meta['settings-schema'], key, value], env=env)
    node = shutil.which('node')
    if not node:
        versions = sorted((Path.home() / '.local/share/fnm/node-versions').glob('*/installation/bin/node'))
        node = str(versions[-1]) if versions else None
    if not node:
        raise RuntimeError('Full syntax check requires Node.js (development tool only).')
    with tempfile.TemporaryDirectory(prefix='gnome-43-check-') as tmp:
        staged = Path(tmp) / 'extension'
        stage(staged, '43')
        run(['glib-compile-schemas', '--strict', staged / 'schemas'])
        for name in ['extension.js', 'prefs.js', 'dateMenu43.js', 'calendarBundle.js']:
            run([node, '--check', staged / name])
        env = dict(os.environ, GSETTINGS_BACKEND='memory', LUNAR_LEGACY_DIR=str(staged))
        run(['gjs', ROOT / 'tests/legacy43.js'], env=env)
    scripts = list((ROOT / 'src').rglob('*.js'))
    for script in scripts:
        run([node, '--input-type=module', '--check'], input=script.read_bytes())
    # GJS tests run with isolated config/data directories and no persistent settings backend.
    with tempfile.TemporaryDirectory(prefix='gnome-project-test-') as tmp:
        env = dict(os.environ, GSETTINGS_BACKEND='memory', XDG_CONFIG_HOME=tmp,
                   XDG_DATA_HOME=tmp, XDG_CACHE_HOME=tmp)
        for script in sorted((ROOT / 'tests').glob('*.js')):
            if script.name == 'legacy43.js':
                continue  # Already tested against the temporary generated package.
            if script.name.endswith('.node.js'):
                run([node, '--experimental-vm-modules', script], env=env)
            else:
                run(['gjs', '-m', script], env=env)
    run([sys.executable, '-m', 'unittest', 'discover', '-s', ROOT / 'tests', '-p', 'test_*.py'])
    print(f'CHECK OK: {len(scripts)} JavaScript files; schema/preset and tests passed.')


def package(shell_major='modern'):
    meta = metadata()
    suffix = '-gnome43' if shell_major == '43' else ''
    output = ROOT / 'dist' / (meta['uuid'] + suffix + '.zip')
    output.parent.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='gnome-project-package-') as tmp:
        staged = Path(tmp) / 'extension'
        stage(staged, shell_major)
        run(['glib-compile-schemas', '--strict', '--dry-run', staged / 'schemas'])
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(staged.rglob('*')):
                if path.is_file():
                    info = zipfile.ZipInfo(path.relative_to(staged).as_posix(), (2026, 1, 1, 0, 0, 0))
                    info.external_attr = 0o100644 << 16
                    info.compress_type = zipfile.ZIP_DEFLATED
                    archive.writestr(info, path.read_bytes())
    print(output)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix(output.suffix + '.sha256').write_text(digest + '  ' + output.name + '\n')


def assert_target():
    if os.geteuid() == 0:
        raise RuntimeError('Run as your desktop user, without sudo.')
    version = subprocess.check_output(['gnome-shell', '--version'], text=True)
    match = re.search(r'GNOME Shell\s+(\d+)(?:\.|\s|$)', version)
    supported = json.loads((ROOT / 'compatibility.json').read_text())['supported_shell']
    if not match or match.group(1) not in supported:
        raise RuntimeError('Supported GNOME Shell majors: ' + ', '.join(supported) +
                           '. Current system: ' + version.strip())
    return match.group(1)


def install():
    shell_major = assert_target()
    meta = metadata()
    enabled = ast.literal_eval(subprocess.check_output(
        ['gsettings', 'get', 'org.gnome.shell', 'enabled-extensions'], text=True).replace('@as ', ''))
    upstream = json.loads((ROOT / 'upstream.lock.json').read_text())['upstream_uuid']
    if upstream in enabled or meta['uuid'] in enabled:
        raise RuntimeError('Disable this extension and its upstream version before installation/update.')
    data = Path(os.environ.get('XDG_DATA_HOME', Path.home() / '.local/share'))
    parent = data / 'gnome-shell/extensions'
    parent.mkdir(parents=True, exist_ok=True)
    target = parent / meta['uuid']
    if target.is_symlink():
        raise RuntimeError('Refusing to overwrite an extension symlink: ' + str(target))
    with tempfile.TemporaryDirectory(prefix='.stage-', dir=parent) as tmp:
        staged = Path(tmp) / meta['uuid']
        stage(staged, shell_major)
        run(['glib-compile-schemas', '--strict', staged / 'schemas'])
        backup = None
        if target.exists():
            if json.loads((target / 'metadata.json').read_text())['uuid'] != meta['uuid']:
                raise RuntimeError('Existing directory has a different extension identity.')
            backups = data / 'gnome-extension-project-backups' / meta['uuid']
            backups.mkdir(parents=True, exist_ok=True)
            backup = backups / datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
            target.rename(backup)
        try:
            staged.rename(target)
        except BaseException:
            if backup:
                backup.rename(target)
            raise
    print('Installed, not enabled:', target)


def setup():
    """Install or update and enable using the current desktop user's settings."""
    assert_target()
    for command in ['glib-compile-schemas', 'gsettings']:
        if not shutil.which(command):
            raise RuntimeError('Missing GNOME dependency: ' + command)
    upstream = json.loads((ROOT / 'upstream.lock.json').read_text())['upstream_uuid']
    with extension_update(metadata()['uuid'], [upstream]):
        install()
    print('gnome-lunar 已安装。请注销并重新登录，以加载新扩展。')


def preset():
    assert_target()
    meta = metadata()
    data = Path(os.environ.get('XDG_DATA_HOME', Path.home() / '.local/share'))
    schema_dir = data / 'gnome-shell/extensions' / meta['uuid'] / 'schemas'
    if not (schema_dir / 'gschemas.compiled').is_file():
        raise RuntimeError('Install this project first.')
    values = json.loads(profile_path().read_text())
    # Validate all values before changing any persistent settings.
    env = dict(os.environ, GSETTINGS_BACKEND='memory')
    for key, value in values.items():
        args = ['gsettings', '--schemadir', schema_dir, 'set', meta['settings-schema'], key, value]
        run(args, env=env)
    for key, value in values.items():
        run(['gsettings', '--schemadir', schema_dir, 'set', meta['settings-schema'], key, value])
    print('Applied preset to this project only:', meta['settings-schema'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', nargs='?', default='plan',
                        choices=['plan', 'check', 'package', 'install', 'preset', 'setup'])
    parser.add_argument('--apply', action='store_true', help='Required for install/preset')
    parser.add_argument('--shell', default='modern', choices=['modern', '43'], help='Package loader target')
    args = parser.parse_args()
    if args.command in ['install', 'preset'] and not args.apply:
        parser.error('No changes made; this action requires --apply.')
    if args.command == 'plan':
        meta = metadata()
        print(meta['name'], '\nUUID:', meta['uuid'], '\nTargets: GNOME 43 (legacy package); GNOME 48 / 51 (modern package)')
        print('Installation selects the actual Shell loader; packaging defaults to modern. Check VALIDATION.json for real-session results.')
        print('Preset (GVariant values):')
        print(profile_path().read_text())
    else:
        if args.command == 'package':
            package(args.shell)
        else:
            {'check': check, 'install': install, 'preset': preset, 'setup': setup}[args.command]()


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, OSError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
