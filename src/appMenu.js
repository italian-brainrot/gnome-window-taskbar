// The application menu of aztaskbar's favourite icons, shared with the window
// buttons: the two are the same question about the same application, so they get
// the same menu (whoever right-clicks the button of a window wants the second
// window of that application, its actions, its pin, its quit - the same list the
// favourite of that application offers).
//
// It lives in its own module rather than in appIcon.js so that windowButtons.js
// can have it without importing the favourites' actor.
//
// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: azaech (aztaskbar), Window Taskbar contributors

import {AppMenu} from 'resource:///org/gnome/shell/ui/appMenu.js';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {TaskbarManager} from './taskbarManager.js';
import * as Utils from './utils.js';

/**
 * The shell's app menu, with this fork's window list in its "Open Windows"
 * section.
 *
 * The shell's own `_updateWindowsSection()` lists `app.get_windows()` with
 * `!skip_taskbar` as its only filter. That is not the set this taskbar shows:
 * the row filters by workspace and by monitor as the settings ask for
 * (`Utils.getInterestingWindows`), and a menu that lists a window the row does
 * not is a menu that activates a window on another workspace or another monitor
 * than the person clicking thinks they are pointing at. So the same filter the
 * row uses is what the menu's list uses, with the same monitor index.
 */
export class AzTaskbarAppMenu extends AppMenu {
    constructor(monitorIndex, sourceActor, side, params) {
        super(sourceActor, side, params);
        this._monitorIndex = monitorIndex;
    }

    // see Utils.menuParams(): the shape of this argument changed in GNOME 51, so
    // the caller builds it and this only passes it on.
    open(params) {
        this._updateWindowsSection();
        super.open(params);
    }

    _updateWindowsSection() {
        if (this._updateWindowsLaterId) {
            const laters = global.compositor.get_laters();
            laters.remove(this._updateWindowsLaterId);
        }
        this._updateWindowsLaterId = 0;

        this._windowSection.removeAll();
        this._openWindowsHeader.hide();

        if (!this._app)
            return;

        const minWindows = this._showSingleWindows ? 1 : 2;
        const appWindows = this._app.get_windows();
        const windows = Utils.getInterestingWindows(TaskbarManager.settings, appWindows, this._monitorIndex);
        if (windows.length < minWindows)
            return;

        this._openWindowsHeader.show();

        windows.forEach(window => {
            const title = window.title || this._app.get_name();
            const item = this._windowSection.addAction(title, event => {
                Main.activateWindow(window, event.get_time());
            });
            window.connectObject('notify::title', () => {
                item.label.text = window.title || this._app.get_name();
            }, item);
        });
    }
}
