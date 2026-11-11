// SPDX-License-Identifier: GPL-3.0-or-later
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {LunarCalendar} from './calendar/engine.js';
import {DateMenuView} from './ui/dateMenu.js';

export default class SystemLunarCalendar extends Extension {
    enable() {
        this._calendar = new LunarCalendar();
        try {
            this._view = new DateMenuView(Main.panel.statusArea.dateMenu,
                this.getSettings(), this._calendar, text => this.gettext(text));
            this._view.start();
        } catch (error) {
            this.disable();
            throw error;
        }
    }
    disable() {
        this._view?.destroy();
        this._view = null;
        this._calendar?.clear();
        this._calendar = null;
    }
}
