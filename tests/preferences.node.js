// Project preference wiring; no GTK window or persistent settings are opened.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
class Widget {
    constructor(props = {}) {this.children = []; this.handlers = new Map(); this.next = 1; Object.assign(this, props);}
    add(widget) {this.children.push(widget);}
    add_suffix(widget) {this.children.push(widget);}
    connect(signal, callback) {const id = this.next++; this.handlers.set(id, [signal, callback]); return id;}
    disconnect(id) {assert.ok(this.handlers.delete(id));}
    emit(signal) {for (const [name, callback] of [...this.handlers.values()]) if (name === signal) callback(this);}
    set selected(value) {this._selected = value; this.emit('notify::selected');}
    get selected() {return this._selected;}
}
const settings = new Widget();
const values = {'label-size': 'normal'};
const bindings = [];
settings.get_string = key => values[key];
settings.set_string = (key, value) => {values[key] = value; settings.emit(`changed::${key}`);};
settings.bind = (key, widget, prop, flag) => bindings.push({key, widget, prop, flag});
const context = vm.createContext({});
const exports = new Map([
    ['gi://Adw', {default: {PreferencesPage: Widget, PreferencesGroup: Widget, ActionRow: Widget, ComboRow: Widget}}],
    ['gi://Gtk', {default: {Switch: Widget, Align: {CENTER: 0}, StringList: {new: strings => strings}}}],
    ['gi://Gio', {default: {SettingsBindFlags: {DEFAULT: 0, GET: 1}}}],
    ['resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js', {
        ExtensionPreferences: class {getSettings() {return settings;} gettext(text) {return text;}},
    }],
]);
const modules = new Map([...exports].map(([name, values]) => [name,
    new vm.SyntheticModule(Object.keys(values), function () {
        for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, {context})]));
const source = new vm.SourceTextModule(fs.readFileSync(new URL('../src/prefs.js', import.meta.url), 'utf8'), {context});
await source.link(name => modules.get(name));
await source.evaluate();
const window = new Widget();
new source.namespace.default().fillPreferencesWindow(window);
assert.equal(window.children[0].children.length, 3, 'Expected top bar, calendar, date-details groups');
const size = window.children[0].children[1].children[1];
assert.equal(size.selected, 1);
size.selected = 2;
assert.equal(values['label-size'], 'large');
settings.set_string('label-size', 'small');
assert.equal(size.selected, 0, 'External size change not reflected');
assert.equal(bindings.filter(b => b.prop === 'active').length, 7);
assert.ok(bindings.some(b => b.key === 'show-calendar' && b.prop === 'sensitive' && b.flag === 1));
assert.equal(settings.handlers.size, 1);
window.emit('close-request');
window.emit('close-request');
assert.equal(settings.handlers.size, 0, 'Settings handler retained after window close');
console.log('Preferences: seven switches, label size in both directions, close cleanup passed.');
