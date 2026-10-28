/*
* Code in this file is borrowed from Dash To Panel
* https://github.com/home-sweet-gnome/dash-to-panel
* Modified slightly to suit this extensions needs.
*/

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// timeout intervals
const MIN_UPDATE_MS = 200;

export const Mode = {
    ALL_WINDOWS: 0,
    FOCUSED_WINDOWS: 1,
    MAXIMIZED_WINDOWS: 2,
};

export class ProximityWatch {
    constructor(actor, monitorIndex, mode, xThreshold, yThreshold, handler) {
        this.actor = actor;
        this.monitorIndex = monitorIndex;
        this.overlap = false;
        this.mode = mode;
        this.threshold = [xThreshold, yThreshold];
        this.handler = handler;

        this._allocationChangedId = actor.connect('notify::allocation', () =>
            this._updateWatchRect()
        );

        this._updateWatchRect();
    }

    destroy() {
        this.actor.disconnect(this._allocationChangedId);
    }

    _updateWatchRect() {
        const [actorX, actorY] = this.actor.get_position();

        this.rect = new Mtk.Rectangle({
            x: actorX - this.threshold[0],
            y: actorY - this.threshold[1],
            width: this.actor.width + this.threshold[0] * 2,
            height: this.actor.height + this.threshold[1] * 2,
        });
    }
}

export const ProximityManager = class {
    constructor() {
        this._counter = 1;
        this._watches = {};
        this._focusedWindowInfo = null;

        this._bindSignals();
        this._setFocusedWindow();
    }

    createWatch(actor, monitorIndex, mode, xThreshold, yThreshold, handler) {
        const watch = new ProximityWatch(
            actor,
            monitorIndex,
            mode,
            xThreshold,
            yThreshold,
            handler
        );

        this._watches[this._counter] = watch;
        this.update();

        return this._counter++;
    }

    removeWatch(id) {
        if (this._watches[id]) {
            this._watches[id].destroy();
            delete this._watches[id];
        }
    }

    update() {
        this._queueUpdate(true);
    }

    destroy() {
        global.window_manager.disconnectObject(this);
        Main.overview.disconnectObject(this);
        global.display.disconnectObject(this);

        if (this._queueUpdateId)
            GLib.source_remove(this._queueUpdateId);
        this._queueUpdateId = null;

        this._disconnectFocusedWindow();
        Object.keys(this._watches).forEach(id => this.removeWatch(id));
    }

    _bindSignals() {
        global.window_manager.connectObject('switch-workspace', () => this._queueUpdate(), this);
        Main.overview.connectObject('hidden', () => this._queueUpdate(), this);
        global.display.connectObject('notify::focus-window', () => {
            this._setFocusedWindow();
            this._queueUpdate();
        }, this);
        global.display.connectObject('restacked', () => this._queueUpdate(), this);
    }

    _setFocusedWindow() {
        this._disconnectFocusedWindow();

        const focusedWindow = global.display.focus_window;

        if (focusedWindow) {
            const focusedWindowInfo = this._getFocusedWindowInfo(focusedWindow);

            if (focusedWindowInfo && this._checkIfHandledWindowType(focusedWindowInfo.metaWindow)) {
                focusedWindowInfo.allocationId = focusedWindowInfo.window.connect(
                    'notify::allocation',
                    () => this._queueUpdate()
                );
                focusedWindowInfo.destroyId = focusedWindowInfo.window.connect(
                    'destroy',
                    () => this._disconnectFocusedWindow(true)
                );

                this._focusedWindowInfo = focusedWindowInfo;
            }
        }
    }

    _getFocusedWindowInfo(focusedWindow) {
        const window = focusedWindow.get_compositor_private();
        let focusedWindowInfo;

        if (window) {
            focusedWindowInfo = {window};
            focusedWindowInfo.metaWindow = focusedWindow;

            if (focusedWindow.is_attached_dialog()) {
                const mainMetaWindow = focusedWindow.get_transient_for();

                if (focusedWindowInfo.metaWindow.get_frame_rect().height < mainMetaWindow.get_frame_rect().height) {
                    focusedWindowInfo.window = mainMetaWindow.get_compositor_private();
                    focusedWindowInfo.metaWindow = mainMetaWindow;
                }
            }
        }

        return focusedWindowInfo;
    }

    _disconnectFocusedWindow(destroy) {
        if (this._focusedWindowInfo && !destroy) {
            this._focusedWindowInfo.window.disconnect(this._focusedWindowInfo.allocationId);
            this._focusedWindowInfo.window.disconnect(this._focusedWindowInfo.destroyId);
        }

        this._focusedWindowInfo = null;
    }

    _getHandledWindows() {
        return global.workspace_manager.get_active_workspace().list_windows().filter(mw => this._checkIfHandledWindow(mw));
    }

    _checkIfHandledWindow(metaWindow) {
        return metaWindow && !metaWindow.minimized && !metaWindow.customJS_ding && this._checkIfHandledWindowType(metaWindow);
    }

    _checkIfHandledWindowType(metaWindow) {
        const metaWindowType = metaWindow.get_window_type();

        // https://www.roojs.org/seed/gir-1.2-gtk-3.0/seed/Meta.WindowType.html
        return metaWindowType <= Meta.WindowType.SPLASHSCREEN && metaWindowType !== Meta.WindowType.DESKTOP;
    }

    _queueUpdate(noDelay) {
        if (!noDelay && this._queueUpdateId) {
            // limit the number of updates
            this._pendingUpdate = true;
            return;
        }

        if (this._queueUpdateId)
            GLib.source_remove(this._queueUpdateId);
        this._queueUpdateId = 0;

        this._queueUpdateId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, MIN_UPDATE_MS, () => {
            this._queueUpdateId = 0;
            this._endLimitUpdate();

            return GLib.SOURCE_REMOVE;
        });

        const metaWindows = this._getHandledWindows();

        Object.keys(this._watches).forEach(id => {
            const watch = this._watches[id];
            const overlap = !!this._update(watch, metaWindows);

            if (overlap !== watch.overlap) {
                watch.handler(overlap);
                watch.overlap = overlap;
            }
        });
    }

    _endLimitUpdate() {
        if (this._pendingUpdate) {
            this._pendingUpdate = false;
            this._queueUpdate();
        }
    }

    _update(watch, metaWindows) {
        if (watch.mode === Mode.FOCUSED_WINDOWS) {
            return this._focusedWindowInfo && this._checkIfHandledWindow(this._focusedWindowInfo.metaWindow) &&
                this._checkProximity(this._focusedWindowInfo.metaWindow, watch);
        }

        if (watch.mode === Mode.MAXIMIZED_WINDOWS) {
            return metaWindows.some(mw =>
                mw.maximized_vertically &&
                mw.maximized_horizontally &&
                mw.get_monitor() === watch.monitorIndex
            );
        }

        // Mode.ALL_WINDOWS
        return metaWindows.some(mw => this._checkProximity(mw, watch));
    }

    _checkProximity(metaWindow, watch) {
        const windowRect = metaWindow.get_frame_rect();

        return windowRect.overlap(watch.rect) && ((!watch.threshold[0] && !watch.threshold[1]) ||
            metaWindow.get_monitor() === watch.monitorIndex ||
            windowRect.overlap(global.display.get_monitor_geometry(watch.monitorIndex)));
    }
};
