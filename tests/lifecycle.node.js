// UI contract test using the native Shell 48/51 calendar rebuild methods.
// The actor fixture is simulated. This is not a real
// GNOME Shell session and does not replace the manual Wayland smoke test.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

class Actor {
    constructor(props = {}) {
        assert.ok(!('vertical' in props), 'Removed St.vertical property used');
        this.children = []; this.signals = new Map(); this.nextSignal = 1;
        this.style_class = ''; this.clutter_text = {};
        Object.assign(this, props);
        if (props.label !== undefined) this.add_child(new Actor({text: props.label}));
    }
    connect(name, callback) {const id = this.nextSignal++; this.signals.set(id, [name, callback]); return id;}
    disconnect(id) {assert.ok(this.signals.delete(id), 'Unknown or duplicate signal disconnection');}
    emit(name, ...args) {for (const [signal, callback] of [...this.signals.values()]) if (signal === name) callback(this, ...args);}
    add_child(actor) {this.children.push(actor); actor.parent = this;}
    insert_child_at_index(actor, index) {this.children.splice(index, 0, actor); actor.parent = this;}
    insert_child_above(actor, sibling) {this.insert_child_at_index(actor, this.children.indexOf(sibling) + 1);}
    get_parent() {return this.parent;}
    get_child() {return this.children[0] ?? null;}
    get_children() {return [...this.children];}
    get_text_direction() {return 0;}
    set_child(actor) {this.children.forEach(c => c.parent = null); this.children = []; if (actor) this.add_child(actor);}
    add_style_class_name(name) {if (!this.style_class.split(' ').includes(name)) this.style_class = `${this.style_class} ${name}`.trim();}
    remove_style_class_name(name) {this.style_class = this.style_class.split(' ').filter(c => c !== name).join(' ');}
    hide() {this.visible = false;}
    show() {this.visible = true;}
    destroy() {this.destroyed = true; if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null;}
}
class InjectionManager {
    constructor() {this.saved = [];}
    overrideMethod(object, name, factory) {this.saved.push([object, name, object[name]]); object[name] = factory(object[name]);}
    clear() {for (const [object, name, original] of this.saved.reverse()) object[name] = original; this.saved = [];}
}

const settings = new Actor();
const values = {'show-date': true, 'show-time': true, 'show-calendar': true,
    'show-details': true, 'show-festivals': true, 'show-solar-terms': true, 'show-ganzhi': true};
settings.get_boolean = key => values[key] ?? false;
settings.get_string = () => 'normal';
const clockParent = new Actor(), infoParent = new Actor(), events = new Actor();
infoParent.add_child(events);
const clock = new Actor({clock: '12:00'}), clockDisplay = new Actor({text: '12:00'}), menu = new Actor();
clockParent.add_child(clockDisplay);
const calendar = new Actor();
const popup = new Actor(), calendarColumn = new Actor();
popup.add_child(calendarColumn);
calendarColumn.add_child(calendar);
calendar._selectedDate = new Date(2026, 1, 17);
calendar._buttons = [];
calendar._firstDayIndex = 0;
calendar._weekStart = 1;
calendar._useWeekdate = true;
calendar._eventSource = {hasEvents: () => false, requestRange() {}};
calendar.layout_manager = {attach(actor) {calendar.add_child(actor);}};
const nativeHeader = new Actor();
nativeHeader.add_child(new Actor({text: 'Thursday'}));
nativeHeader.add_child(new Actor({text: '2026-11-12'}));
const today = new Actor();
today.set_child(nativeHeader);
today.setDate = function () { this.accessible_name = 'Native Gregorian date'; };
const originalSetDate = today.setDate;
const dm = {_date: today, _calendar: calendar, _eventsItem: events, _clock: clock, _clockDisplay: clockDisplay, menu};
const main = {panel: {statusArea: {dateMenu: dm}}};
class BinLayout {
    _init() {}
    layout_changed() {this.invalidations = (this.invalidations ?? 0) + 1;}
    vfunc_get_preferred_width(container) {return container.naturalWidth;}
    vfunc_get_preferred_height(container) {return container.naturalHeight;}
    vfunc_allocate() {}
}
const clutter = {BinLayout, Orientation: {VERTICAL: 1}, ActorAlign: {CENTER: 0, START: 1, END: 2}, TextDirection: {RTL: 1}};
const st = {Button: Actor, Bin: Actor, BoxLayout: Actor, Label: Actor};
class FixtureDate extends Date {
    toLocaleFormat(format) { return format.includes('%V') ? '07' : String(this.getDate()); }
}
const context = vm.createContext({console, Date: FixtureDate, Clutter: clutter, St: st,
    EmptyEventSource: class {},
    formatDateWithCFormatString: date => String(date.getDate()),
    C_: (_context, text) => text, N_: text => text,
    Shell: {util_translate_time_string: text => text},
    _isWorkDay: date => date.getDay() > 0 && date.getDay() < 6,
    sameDay: (a, b) => a.toDateString() === b.toDateString(),
});
const modules = new Map();
function synthetic(name, exports) {
    const module = new vm.SyntheticModule(Object.keys(exports), function () {
        for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, {context, identifier: name});
    modules.set(name, module);
}
synthetic('gi://Clutter', {default: clutter});
synthetic('gi://St', {default: st});
synthetic('resource:///org/gnome/shell/ui/main.js', main);
synthetic('resource:///org/gnome/shell/extensions/extension.js', {
    Extension: class {getSettings() {return settings;} gettext(text) {return text;}}, InjectionManager});
function moduleAt(identifier) {
    if (!modules.has(identifier)) {
        modules.set(identifier, new vm.SourceTextModule(fs.readFileSync(new URL(identifier), 'utf8'), {context, identifier}));
    }
    return modules.get(identifier);
}
const entry = moduleAt(new URL('../src/extension.js', import.meta.url).href);
await entry.link((specifier, referencing) => modules.has(specifier) ? modules.get(specifier) :
    moduleAt(new URL(specifier, referencing.identifier).href));
await entry.evaluate();
const extension = new entry.namespace.default();
const nativeCalendars = JSON.parse(fs.readFileSync(new URL('./fixtures/native-calendars.json', import.meta.url), 'utf8'));
const nativeLayouts = JSON.parse(fs.readFileSync(new URL('./fixtures/native-popup-layouts.json', import.meta.url), 'utf8'));
for (const [version, fixture] of Object.entries(nativeCalendars)) {
    const Layout = vm.runInContext(`(${nativeLayouts[version].class})`, context);
    const layout = new Layout();
    layout._init();
    popup.layout_manager = layout;
    calendar._rebuildCalendar = vm.runInContext(`({${fixture.method}})._rebuildCalendar`, context);
    const originalRebuild = calendar._rebuildCalendar;
    for (let cycle = 0; cycle < 3; cycle++) {
        extension.enable();
        const engine = extension._calendar;
        const view = extension._view;
        assert.equal(clockParent.children.length, 1, 'A second top-bar label was added');
        assert.equal(infoParent.children.length, 1, 'Details were duplicated below the month grid');
        assert.equal(dm._clock, clock, 'Shell clock replaced');
        assert.ok(clockDisplay.text.startsWith(clock.clock + '\u2001'), 'Lunar text is not inside the native clock label');
        assert.match(clockDisplay.text, /日.+时$/);
        assert.equal(today.get_child(), view._details);
        const heading = view._details.get_child();
        assert.deepEqual(heading.children, [view._dateLabel, view._yearLabel], 'Lunar date and year are not in the same row');
        assert.equal(heading.orientation, undefined, 'Header row is vertical');
        assert.equal(view._dateLabel.x_expand, true);
        assert.equal(view._yearLabel.x_align, clutter.ActorAlign.END);
        today.setDate(new Date());
        assert.match(today.accessible_name, /正月初一/, 'Native date update overwrote the lunar header');
        clock.clock = '12:01';
        clockDisplay.text = clock.clock;
        clockDisplay.emit('notify::text');
        assert.ok(clockDisplay.text.startsWith('12:01\u2001'), 'Clock binding update lost the lunar suffix');
        assert.equal(calendar._buttons.length, 42, 'Native month grid changed');
        assert.equal(view._dateLabel.text, 'Lunar calendar · 正月初一');
        assert.equal(view._festivalLabel.text, '春节');
        assert.equal(view._days.size, 42);
        // Real native freeze/cache methods; simulated actor sizes only. This
        // verifies invalidation, not CSS rendering or actual screen geometry.
        for (const weekNumbers of [false, true]) {
            calendar._useWeekdate = weekNumbers;
            for (let month = -1; month < 24; month++) {
                layout.vfunc_allocate(popup, {get_size: () => [700, 600]});
                layout.frozen = true;
                popup.naturalWidth = [720 + month, 720 + month];
                popup.naturalHeight = [640, 640];
                // Confirm the actual native layout is still returning its
                // frozen allocation before the extension changes the month.
                assert.deepEqual(Array.from(layout.vfunc_get_preferred_width(popup, -1)), [700, 700]);
                calendar._selectedDate = new Date(2026, month, 12);
                calendar._rebuildCalendar();
                calendar.emit('selected-date-changed');
                assert.equal(layout._frozen, true, 'Native freeze state was changed');
                assert.deepEqual(layout.vfunc_get_preferred_width(popup, -1), popup.naturalWidth, 'Month change reused a stale width');
                assert.deepEqual(layout.vfunc_get_preferred_height(popup, -1), popup.naturalHeight, 'Month change reused a stale height');
                assert.equal(view._days.size, 42, 'Another month lost lunar dates');
                for (const [day, state] of view._days) {
                    assert.equal(day.get_child(), state.box);
                    assert.ok(state.box.children[1].text.length > 0, 'Empty lunar annotation after month change');
                }
                if (month === 11) assert.equal(view._dateLabel.text, 'Lunar calendar · 冬月初四');
            }
        }
        calendar._selectedDate = new Date(2026, 1, 17);
        calendar._rebuildCalendar();
        calendar.emit('selected-date-changed');
        const button = calendar._buttons[0];
        const originalChild = view._days.get(button).original;
        assert.equal(button.get_child().children.length, 2, 'Missing second date line');
        values['show-date'] = values['show-time'] = false;
        settings.emit('changed');
        assert.equal(clockDisplay.text, clock.clock, 'Clock suffix switches ignored');
        values['show-date'] = values['show-time'] = true;
        values['show-calendar'] = false;
        settings.emit('changed');
        assert.equal(view._days.size, 0);
        assert.equal(calendar._buttons[0].get_child().children.length, 0, 'Original single label not restored');
        values['show-calendar'] = true;
        values['show-details'] = false;
        settings.emit('changed');
        assert.equal(view._details.visible, false);
        assert.equal(today.get_child(), nativeHeader, 'Disabling details did not restore the native header');
        assert.equal(today.accessible_name, 'Native Gregorian date', 'Hidden lunar header retained its accessible name');
        values['show-details'] = true;
        settings.emit('changed');
        calendar._selectedDate = new Date(2201, 5, 15);
        calendar._rebuildCalendar();
        calendar.emit('selected-date-changed');
        assert.equal(view._days.size, 0, 'Unsupported date decorated');
        assert.match(view._dateLabel.text, /1734 to 2200/);
        calendar._selectedDate = new Date(2026, 1, 17);
        calendar._rebuildCalendar();
        calendar.emit('selected-date-changed');
        const originals = new Map([...view._days].map(([b, state]) => [b, state.original]));
        extension.disable();
        extension.disable();
        assert.equal(engine._years.size, 0);
        assert.equal(today.get_child(), nativeHeader, 'Native date header not restored');
        assert.equal(today.setDate, originalSetDate);
        assert.equal(clockDisplay.text, clock.clock, 'Clock suffix leaked after disable');
        assert.equal(calendar._rebuildCalendar, originalRebuild, 'Calendar override leaked');
        for (const [b, original] of originals) assert.equal(b.get_child(), original, 'Original label not restored');
        assert.equal(clock.signals.size + clockDisplay.signals.size + menu.signals.size + calendar.signals.size + settings.signals.size, 0);
        assert.equal(clockParent.children.length, 1);
        assert.equal(infoParent.children.length, 1);
        assert.ok(!calendar.style_class.includes('system-lunar'));
        assert.ok(layout._savedWidth.every(Number.isNaN), 'Disable retained the enlarged popup cache');
    }
    console.log(`Shell ${version} native calendar/layout contracts: 3 cycles, 25 months with/without week numbers, frozen-size invalidation, horizontal header, options, year bounds, cleanup.`);
}
const originalSetChild = today.set_child;
today.set_child = function (child) {
    if (child !== nativeHeader) throw new Error('Fixture layout failure');
    return originalSetChild.call(this, child);
};
assert.throws(() => extension.enable(), /Fixture layout failure/);
assert.equal(clockParent.children.length, 1);
assert.equal(clock.signals.size, 0);
assert.equal(extension._calendar, null);
today.set_child = originalSetChild;
console.log('Enable failure rollback and idempotent disable passed. No actual Shell session was used.');
