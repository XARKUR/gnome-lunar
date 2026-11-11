"""Generate a legacy GJS loader from our explicitly supported ESM source forms."""
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent
SRC = ROOT / 'src'
IMPORT = re.compile(r"^import\s+\{([^}]+)\}\s+from\s+['\"]([^'\"]+)['\"];\s*$", re.M)
EXPORTS = re.compile(r'^export\s+\{([^}]+)\};\s*$', re.M)
DECL = re.compile(r'^export\s+(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)', re.M)


def calendar_bundle():
    modules = {}
    chunks = []

    def visit(file):
        name = file.relative_to(SRC).as_posix()
        if name in modules:
            return
        source = file.read_text()
        imports = []
        for match in IMPORT.finditer(source):
            dependency = (file.parent / match[2]).resolve()
            if not dependency.is_relative_to(SRC):
                raise ValueError('Legacy bundle import outside src')
            visit(dependency)
            imports.append('const {' + match[1] + '} = modules[' + json.dumps(dependency.relative_to(SRC).as_posix()) + '];')
        exported = [m[2] for m in DECL.finditer(source)]
        for match in EXPORTS.finditer(source):
            exported.extend(x.strip() for x in match[1].split(','))
        source = IMPORT.sub('', source)
        source = EXPORTS.sub('', source)
        source = DECL.sub(lambda m: m[1] + ' ' + m[2], source)
        if re.search(r'^\s*(import|export)\s', source, re.M):
            raise ValueError('Unsupported legacy source syntax in ' + name)
        chunks.append('modules[' + json.dumps(name) + '] = (() => {\n' + '\n'.join(imports) +
                      '\n' + source + '\nreturn {' + ', '.join(exported) + '};\n})();\n')
        modules[name] = True

    visit(SRC / 'calendar/engine.js')
    visit(SRC / 'calendar/format.js')
    return ('// Generated from the credited ESM sources; edit src/, not this file.\n'
            'var LunarCalendar;\nvar format;\n(() => {\nconst modules = Object.create(null);\n' +
            '\n'.join(chunks) + '\nLunarCalendar = modules["calendar/engine.js"].LunarCalendar;\n'
            'format = modules["calendar/format.js"];\n})();\n')


def generate(destination):
    meta = json.loads((destination / 'metadata.json').read_text())
    meta['shell-version'] = ['43']
    (destination / 'metadata.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n')
    (destination / 'calendarBundle.js').write_text(calendar_bundle())
    view = (SRC / 'ui/dateMenu.js').read_text()
    view = re.sub(r'^import .*?;\n', '', view, flags=re.M)
    view = view.replace('export class DateMenuView', 'var DateMenuView = class DateMenuView')
    view = view.replace('orientation: Clutter.Orientation.VERTICAL', 'vertical: true')
    injections = '''
class InjectionManager {
    constructor() { this._saved = []; }
    overrideMethod(object, name, factory) {
        this._saved.push({object, name, original: object[name], own: Object.prototype.hasOwnProperty.call(object, name)});
        object[name] = factory(object[name]);
    }
    clear() {
        for (const {object, name, original, own} of this._saved.reverse()) {
            if (own) object[name] = original;
            else delete object[name];
        }
        this._saved = [];
    }
}
'''
    (destination / 'dateMenu43.js').write_text(
        '// Generated GNOME 43 adapter; shared implementation: src/ui/dateMenu.js.\n'
        'const {Clutter, St, Pango} = imports.gi;\n'
        'const Me = imports.misc.extensionUtils.getCurrentExtension();\n'
        'const {annotation, dateText, detailsText, hourText} = Me.imports.calendarBundle.format;\n' +
        injections + view)
    entry = (SRC / 'extension.js').read_text()
    entry = re.sub(r'^import .*?;\n', '', entry, flags=re.M)
    entry = entry.replace('export default class SystemLunarCalendar extends Extension',
                          'var SystemLunarCalendar = class SystemLunarCalendar')
    entry = entry.replace('this.getSettings()', 'ExtensionUtils.getSettings()')
    entry = entry.replace('this.gettext(text)', 'Gettext.gettext(text)')
    (destination / 'extension.js').write_text(
        '// Generated legacy entry; shared implementation: src/extension.js.\n'
        'const Main = imports.ui.main;\nconst ExtensionUtils = imports.misc.extensionUtils;\n'
        'const Me = ExtensionUtils.getCurrentExtension();\n'
        'const Gettext = imports.gettext.domain(Me.metadata["gettext-domain"]);\n'
        'const {LunarCalendar} = Me.imports.calendarBundle;\n'
        'const {DateMenuView} = Me.imports.dateMenu43;\n' + entry +
        '\nfunction init() { ExtensionUtils.initTranslations(); return new SystemLunarCalendar(); }\n')
    prefs = (SRC / 'prefs.js').read_text()
    prefs = re.sub(r'^import .*?;\n', '', prefs, flags=re.M)
    prefs = prefs.replace('export default class LunarCalendarPreferences extends ExtensionPreferences',
                           'var LunarCalendarPreferences = class LunarCalendarPreferences')
    prefs = prefs.replace('this.getSettings()', 'ExtensionUtils.getSettings()')
    prefs = prefs.replace('this.gettext(text)', 'Gettext.gettext(text)')
    (destination / 'prefs.js').write_text(
        '// Generated legacy preferences; shared implementation: src/prefs.js.\n'
        'const {Adw, Gio, Gtk} = imports.gi;\nconst ExtensionUtils = imports.misc.extensionUtils;\n'
        'const Me = ExtensionUtils.getCurrentExtension();\n'
        'const Gettext = imports.gettext.domain(Me.metadata["gettext-domain"]);\n' + prefs +
        '\nfunction init() { ExtensionUtils.initTranslations(); }\n'
        'function fillPreferencesWindow(window) { new LunarCalendarPreferences().fillPreferencesWindow(window); }\n')
