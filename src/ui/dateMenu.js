// SPDX-License-Identifier: GPL-3.0-or-later
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Pango from 'gi://Pango';
import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import {annotation, dateText, detailsText, hourText} from '../calendar/format.js';

// The only module coupled to the Shell's private date-menu layout.
export class DateMenuView {
    constructor(dateMenu, settings, calendar, gettext) {
        if (!dateMenu?._calendar?._rebuildCalendar ||
            !Array.isArray(dateMenu._calendar._buttons) ||
            !dateMenu._clockDisplay?.get_parent() || !dateMenu._date?.get_child() ||
            typeof dateMenu._date.setDate !== 'function')
            throw new Error('Unsupported date-menu layout (supported GNOME Shell: 43, 48, 51).');
        this._menu = dateMenu;
        this._settings = settings;
        this._calendar = calendar;
        this._ = gettext;
        this._signals = [];
        this._days = new Map();
        this._injections = new InjectionManager();
    }
    start() {
        const menu = this._menu;
        this._originalClockText = menu._clockDisplay.text;
        this._originalHeader = menu._date.get_child();
        this._nativeHeaderDate = menu._date.setDate;
        this._details = new St.BoxLayout({style_class: 'system-lunar-details',
            orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        const heading = new St.BoxLayout({style_class: 'system-lunar-details-heading', x_expand: true});
        this._dateLabel = new St.Label({style_class: 'system-lunar-details-date',
            y_align: Clutter.ActorAlign.CENTER});
        this._festivalLabel = new St.Label({style_class: 'system-lunar-details-events',
            x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        // Keep short solar terms inline. Long coinciding festivals may ellipsize
        // rather than enlarging the calendar; the full text stays accessible.
        this._festivalLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._yearLabel = new St.Label({style_class: 'system-lunar-details-year',
            x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.CENTER});
        heading.add_child(this._dateLabel);
        heading.add_child(this._festivalLabel);
        heading.add_child(this._yearLabel);
        this._details.add_child(heading);
        const view = this;
        // Keep the native "return to today" button, replacing only its content.
        this._injections.overrideMethod(menu._date, 'setDate', original => function (...args) {
            const result = original.apply(this, args);
            view._refreshDetails();
            return result;
        });
        this._injections.overrideMethod(menu._calendar, '_rebuildCalendar', original => function (...args) {
            view._restoreDays();
            view._syncCalendarStyle();
            const result = original.apply(this, args);
            view._decorateDays();
            view._invalidateMenuSize();
            return result;
        });
        this._connect(menu._clock, 'notify::clock', () => this._refreshPanel());
        // The existing clock binding can write after another notify handler.
        // Reconcile its target without replacing the WallClock or its binding.
        this._connect(menu._clockDisplay, 'notify::text', () => this._refreshPanel());
        this._connect(menu._calendar, 'selected-date-changed', () => this._refreshDetails());
        this._connect(menu.menu, 'open-state-changed', (_actor, open) => { if (open) this._refreshDetails(); });
        this._connect(this._settings, 'changed', (_settings, key) => {
            // Panel-only preferences must not recreate all 42 date actors.
            if (!key || ['show-calendar', 'label-size', 'show-festivals', 'show-solar-terms'].includes(key))
                menu._calendar._rebuildCalendar();
            if (!key || ['show-date', 'show-time'].includes(key)) this._refreshPanel();
            if (!key || ['show-details', 'show-ganzhi', 'show-festivals', 'show-solar-terms'].includes(key))
                this._refreshDetails();
        });
        menu._calendar._rebuildCalendar();
        this._refreshPanel();
        this._refreshDetails();
    }
    _connect(object, signal, callback) { this._signals.push([object, object.connect(signal, callback)]); }
    _options() {
        return {festivals: this._settings.get_boolean('show-festivals'),
            solarTerms: this._settings.get_boolean('show-solar-terms')};
    }
    _refreshPanel() {
        const now = new Date();
        const info = this._calendar.forDate(now);
        const lunar = info && this._settings.get_boolean('show-date') ? `${dateText(info)}日` : '';
        const hour = this._settings.get_boolean('show-time') ? hourText(now) : '';
        const suffix = lunar + hour;
        const clock = this._menu._clock.clock ?? this._originalClockText;
        const text = clock + (suffix ? `\u2001${suffix}` : '');
        if (this._menu._clockDisplay.text !== text)
            this._menu._clockDisplay.text = text;
    }
    _refreshDetails() {
        const info = this._calendar.forDate(this._menu._calendar._selectedDate);
        const show = this._settings.get_boolean('show-details');
        this._details.visible = show;
        if (show) this._menu._date.add_style_class_name('system-lunar-today');
        else this._menu._date.remove_style_class_name('system-lunar-today');
        const content = show ? this._details : this._originalHeader;
        if (this._menu._date.get_child() !== content)
            this._menu._date.set_child(content);
        this._dateLabel.text = info ? dateText(info) :
            this._('Lunar dates are available from 1734 to 2200.');
        this._yearLabel.text = !info ? '' : this._settings.get_boolean('show-ganzhi') ?
            `${info.ganzhiYear}年 · ${info.zodiac}年` : `${info.year}年`;
        this._yearLabel.visible = Boolean(info);
        const events = detailsText(info, this._options());
        this._festivalLabel.text = events ? `· ${events}` : '';
        // Always reserve the flexible spacer so the year stays right-aligned
        // on ordinary days as well as festival days.
        if (show)
            this._menu._date.accessible_name = [this._dateLabel.text, this._yearLabel.text,
                this._festivalLabel.text].filter(Boolean).join(' ');
        else
            this._nativeHeaderDate.call(this._menu._date, new Date());
        this._invalidateMenuSize();
    }
    _invalidateMenuSize() {
        // Shell 43/48/51 freeze the popup's last allocation when leaving today.
        // A rebuilt two-line calendar/header must be measured before reusing it;
        // otherwise the frozen width can clip the week-number or Sunday column.
        // Keep the native freeze behaviour, invalidating only its size cache.
        for (let actor = this._menu._calendar.get_parent(); actor; actor = actor.get_parent()) {
            const layout = actor.layout_manager;
            if (typeof layout?._frozen === 'boolean' &&
                Array.isArray(layout._savedWidth) && Array.isArray(layout._savedHeight)) {
                layout._savedWidth = [NaN, NaN];
                layout._savedHeight = [NaN, NaN];
                layout.layout_changed();
                break;
            }
        }
    }
    _syncCalendarStyle() {
        const cal = this._menu._calendar;
        if (this._sizeClass) cal.remove_style_class_name(this._sizeClass);
        this._sizeClass = null;
        if (this._settings.get_boolean('show-calendar')) {
            cal.add_style_class_name('system-lunar-calendar');
            this._sizeClass = `system-lunar-size-${this._settings.get_string('label-size')}`;
            cal.add_style_class_name(this._sizeClass);
        } else {
            cal.remove_style_class_name('system-lunar-calendar');
        }
    }
    _decorateDays() {
        const cal = this._menu._calendar;
        if (!this._settings.get_boolean('show-calendar')) return;
        const options = this._options();
        for (const button of cal._buttons) {
            if (!button._date) continue;
            const info = this._calendar.forDate(button._date);
            if (!info) continue;
            const original = button.get_child();
            const accessible = button.accessible_name;
            const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
            box.add_child(new St.Label({text: button.label, x_align: Clutter.ActorAlign.CENTER}));
            const lunar = new St.Label({text: annotation(info, options), style_class: 'system-lunar-day',
                x_align: Clutter.ActorAlign.CENTER});
            if (detailsText(info, options)) lunar.add_style_class_name('system-lunar-special');
            box.add_child(lunar);
            this._days.set(button, {original, accessible, box});
            button.set_child(box);
            button.accessible_name = [accessible || button._date.getDate(), dateText(info),
                detailsText(info, options)].filter(Boolean).join(' ');
        }
    }
    _restoreDays() {
        for (const [button, {original, accessible, box}] of this._days) {
            button.set_child(original);
            button.accessible_name = accessible;
            box.destroy();
        }
        this._days.clear();
    }
    destroy() {
        for (const [object, signal] of this._signals) object.disconnect(signal);
        this._signals = [];
        this._injections.clear();
        this._restoreDays();
        this._menu._date.remove_style_class_name('system-lunar-today');
        this._menu._calendar.remove_style_class_name('system-lunar-calendar');
        if (this._sizeClass) this._menu._calendar.remove_style_class_name(this._sizeClass);
        this._sizeClass = null;
        if (this._originalHeader) {
            this._menu._date.set_child(this._originalHeader);
            this._menu._date.setDate(new Date());
        }
        if (this._originalClockText !== undefined)
            this._menu._clockDisplay.text = this._menu._clock.clock ?? this._originalClockText;
        this._details?.destroy();
        this._details = this._originalHeader = null;
        this._invalidateMenuSize();
    }
}
