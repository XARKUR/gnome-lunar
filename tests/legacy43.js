// Run the generated classic GJS bundle, not an ESM copy of the engine.
const GLib = imports.gi.GLib;
imports.searchPath.unshift(GLib.getenv('LUNAR_LEGACY_DIR'));
const {LunarCalendar, format} = imports.calendarBundle;
const engine = new LunarCalendar();
const info = engine.forDate(new Date(2026, 1, 17));
if (format.dateText(info) !== '正月初一' || format.annotation(info) !== '春节')
    throw new Error('Generated GNOME 43 calendar bundle is incorrect');
engine.clear();
print('GNOME 43 classic GJS bundle: lunar date and festival passed.');
