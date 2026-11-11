// SPDX-License-Identifier: GPL-3.0-or-later
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class LunarCalendarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const _ = text => this.gettext(text);
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({title: _('Lunar calendar'), icon_name: 'x-office-calendar-symbolic'});
        const panel = new Adw.PreferencesGroup({title: _('Top bar')});
        const calendar = new Adw.PreferencesGroup({title: _('Calendar')});
        const details = new Adw.PreferencesGroup({title: _('Date details'),
            description: _('Traditional festivals are not official holiday or adjusted workday schedules.')});
        for (const group of [panel, calendar, details]) page.add(group);
        const toggle = (group, key, title) => {
            const row = new Adw.ActionRow({title: _(title)});
            const control = new Gtk.Switch({valign: Gtk.Align.CENTER});
            row.add_suffix(control);
            row.activatable_widget = control;
            settings.bind(key, control, 'active', Gio.SettingsBindFlags.DEFAULT);
            group.add(row);
        };
        toggle(panel, 'show-date', 'Show lunar date');
        toggle(panel, 'show-time', 'Show traditional two-hour period');
        toggle(calendar, 'show-calendar', 'Annotate calendar days');
        const size = new Adw.ComboRow({title: _('Lunar label size'),
            model: Gtk.StringList.new([_('Small'), _('Normal'), _('Large')])});
        const sizes = ['small', 'normal', 'large'];
        const syncSize = () => { size.selected = Math.max(0, sizes.indexOf(settings.get_string('label-size'))); };
        syncSize();
        size.connect('notify::selected', () => {
            const value = sizes[size.selected];
            if (value && settings.get_string('label-size') !== value) settings.set_string('label-size', value);
        });
        let changed = settings.connect('changed::label-size', syncSize);
        window.connect('close-request', () => {
            if (changed) settings.disconnect(changed);
            changed = 0;
            return false;
        });
        settings.bind('show-calendar', size, 'sensitive', Gio.SettingsBindFlags.GET);
        calendar.add(size);
        toggle(details, 'show-details', 'Show selected date details');
        toggle(details, 'show-ganzhi', 'Show cyclical year and zodiac');
        toggle(details, 'show-festivals', 'Show traditional festivals');
        toggle(details, 'show-solar-terms', 'Show the 24 solar terms');
        window._settings = settings;
        window.add(page);
    }
}
