/*
* Code in this file is borrowed from Dash To Panel
* https://github.com/home-sweet-gnome/dash-to-panel
* Modified slightly to suit this extensions needs.
*/

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {PanelLocation} from './extension.js';
import {TaskbarManager} from './taskbarManager.js';

const [ShellVersion] = Config.PACKAGE_VERSION.split('.').map(s => Number(s));

async function getPointerWatcher() {
    if (ShellVersion < 51) {
        const PointerWatcher = await import('resource:///org/gnome/shell/ui/pointerWatcher.js');
        return PointerWatcher;
    }
    return null;
};
const PointerWatcher = await getPointerWatcher();


// timeout intervals
const CHECK_POINTER_MS = 200;
const CHECK_GRAB_MS = 400;
const POST_ANIMATE_MS = 50;
const MIN_UPDATE_MS = 250;

const SIDE_CONTROLS_ANIMATION_TIME = 250;

export const Hold = {
    NONE: 0,
    TEMPORARY: 1,
    PERMANENT: 2,
    NOTIFY: 4,
};

export const Intellihide = class {
    constructor(panelManager) {
        this._unredirectEnabled = false;
        this._panel = panelManager.panel;
        this._panelBox = panelManager.panelBox;
        this._panelManager = panelManager;
        this._proximityManager = this._panelManager.proximityManager;
        this._holdStatus = Hold.NONE;

        this._intellihideChangedId = TaskbarManager.settings.connect('changed::intellihide', () => this._changeEnabledStatus());
        this._intellihideOnlySecondaryChangedId = TaskbarManager.settings.connect('changed::intellihide-only-secondary', () => this._changeEnabledStatus());

        this.enabled = false;
        this._changeEnabledStatus();
    }

    enable() {
        this.enabled = true;
        this._monitor = this._panelManager.monitor;
        this._animationDestination = -1;
        this._pendingUpdate = false;
        this._hover = false;
        this._hoveredOut = false;
        this._windowOverlap = false;

        this._panelBox.translation_y = 0;
        this._panelBox.translation_x = 0;

        this._setTrackPanel(true);
        this._bindGeneralSignals();

        if (TaskbarManager.settings.get_boolean('intellihide-hide-from-windows')) {
            this._proximityWatchId = this._proximityManager.createWatch(
                this._panelBox,
                this._monitor.index,
                TaskbarManager.settings.get_enum('intellihide-behaviour'),
                0,
                0,
                overlap => {
                    this._windowOverlap = overlap;
                    this._queueUpdatePanelPosition();
                }
            );
        }

        this._setRevealMechanism();

        const lastState = TaskbarManager.settings.get_int('intellihide-persisted-state');

        if (lastState > -1) {
            this._holdStatus = lastState;

            if (lastState === Hold.NONE && Main.layoutManager._startingUp)
                this._panelBox.connectObject('notify::mapped', () => this._hidePanel(true), this);
            else
                this._queueUpdatePanelPosition();
        } else { // -1 means that the option to persist hold isn't activated, so normal start
            const delay = TaskbarManager.settings.get_int('intellihide-enable-start-delay');
            this._createTimeout('_enableStartTimeoutId', delay, () => this._queueUpdatePanelPosition());
        }
    }

    disable(reset) {
        this.enabled = false;
        this._hover = false;

        if (this._proximityWatchId)
            this._proximityManager.removeWatch(this._proximityWatchId);

        this._setTrackPanel(false);

        this._removeRevealMechanism();

        this._revealPanel(!reset);

        TaskbarManager.settings.disconnectObject(this);
        this._panelBox.disconnectObject(this);
        Main.overview.disconnectObject(this);
        this._pressureBarrier?.disconnectObject(this);

        this._removeTimeout('_checkGrabTimeoutId');
        this._removeTimeout('_limitUpdateTimeoutId');
        this._removeTimeout('_postAnimateTimeoutId');
        this._removeTimeout('_enableStartTimeoutId');
    }

    destroy() {
        TaskbarManager.settings.disconnect(this._intellihideChangedId);
        TaskbarManager.settings.disconnect(this._intellihideOnlySecondaryChangedId);

        if (this.enabled)
            this.disable();
    }

    toggle() {
        this[this._holdStatus & Hold.PERMANENT ? 'release' : 'revealAndHold'](
            Hold.PERMANENT
        );
    }

    revealAndHold(holdStatus, immediate) {
        if (!this.enabled || (holdStatus === Hold.NOTIFY && !TaskbarManager.settings.get_boolean('intellihide-show-on-notification')))
            return;

        if (!this._holdStatus)
            this._revealPanel(immediate);

        this._holdStatus |= holdStatus;

        this._maybePersistHoldStatus();
    }

    release(holdStatus) {
        if (!this.enabled)
            return;

        if (this._holdStatus & holdStatus)
            this._holdStatus -= holdStatus;

        if (!this._holdStatus) {
            this._maybePersistHoldStatus();
            this._queueUpdatePanelPosition();
        }
    }

    reset() {
        this.disable(true);
        this.enable();
    }

    _changeEnabledStatus() {
        const intellihide = TaskbarManager.settings.get_boolean('intellihide');
        const onlySecondary = TaskbarManager.settings.get_boolean('intellihide-only-secondary');
        const enabled = intellihide && !(this._panelManager.isMainPanel && onlySecondary);

        if (this.enabled !== enabled)
            this[enabled ? 'enable' : 'disable']();
    }

    _maybePersistHoldStatus() {
        if (TaskbarManager.settings.get_int('intellihide-persisted-state') > -1) {
            TaskbarManager.settings.set_int(
                'intellihide-persisted-state',
                this._holdStatus & Hold.PERMANENT ? Hold.PERMANENT : Hold.NONE
            );
        }
    }

    _bindGeneralSignals() {
        TaskbarManager.settings.connectObject('changed::intellihide-use-pressure', () => this.reset(), this);
        TaskbarManager.settings.connectObject('changed::intellihide-hide-from-windows', () => this.reset(), this);
        TaskbarManager.settings.connectObject('changed::intellihide-behaviour', () => this.reset(), this);
        TaskbarManager.settings.connectObject('changed::intellihide-pressure-threshold', () => this.reset(), this);
        TaskbarManager.settings.connectObject('changed::intellihide-pressure-time', () => this.reset(), this);

        Main.overview.connectObject('showing', () => this._queueUpdatePanelPosition(), this);
        Main.overview.connectObject('hiding', () => this._queueUpdatePanelPosition(), this);

        if (!Meta.is_wayland_compositor || Meta.is_wayland_compositor())
            this._panelBox.connectObject('notify::visible', () => this._setDisplayUnredirect(!this._panelBox.visible), this);
    }

    _setTrackPanel(enable) {
        let actorData;
        const trackedIndex = Main.layoutManager._findActor(this._panelBox);

        if (trackedIndex >= 0)
            actorData = Main.layoutManager._trackedActors[trackedIndex];

        actorData.affectsStruts = !enable;
        actorData.trackFullscreen = !enable;

        this._panelBox.visible = enable ? enable : this._panelBox.visible;

        Main.layoutManager._queueUpdateRegions();
    }

    _setRevealMechanism() {
        const barriers = Meta.BackendCapabilities.BARRIERS;

        if ((global.backend.capabilities & barriers) === barriers &&
            TaskbarManager.settings.get_boolean('intellihide-use-pressure')) {
            this._edgeBarrier = this._createBarrier();
            this._pressureBarrier = new Layout.PressureBarrier(
                TaskbarManager.settings.get_int('intellihide-pressure-threshold'),
                TaskbarManager.settings.get_int('intellihide-pressure-time'),
                Shell.ActionMode.NORMAL
            );
            this._pressureBarrier.addBarrier(this._edgeBarrier);
            this._pressureBarrier.connectObject('trigger', () => {
                this._queueUpdatePanelPosition(true);
            }, this);
        }

        if (ShellVersion >= 51) {
            const cursorTracker = global.backend.get_cursor_tracker();
            this._cursorTrackerId = cursorTracker.connect('position-invalidated', () => {
                const [coords] = cursorTracker.get_pointer();
                this._checkMousePointer(coords.x, coords.y);
            });
        } else {
            this._cursorTrackerId = PointerWatcher.getPointerWatcher().addWatch(CHECK_POINTER_MS, (x, y) => {
                this._checkMousePointer(x, y);
            });
        }
    }

    _removeRevealMechanism() {
        if (ShellVersion >= 51) {
            const cursorTracker = global.backend.get_cursor_tracker();
            cursorTracker.disconnect(this._cursorTrackerId);
            this._cursorTrackerId = null;
        } else {
            PointerWatcher.getPointerWatcher()._removeWatch(this._cursorTrackerId);
            this._cursorTrackerId = null;
        }

        if (this._pressureBarrier) {
            this._pressureBarrier.destroy();
            this._edgeBarrier.destroy();
            this._pressureBarrier = null;
            this._edgeBarrier = null;
        }
    }

    _createBarrier() {
        const position = TaskbarManager.settings.get_enum('panel-location');
        const opts = {backend: global.backend};

        opts.x1 = this._monitor.x;
        opts.x2 = this._monitor.x + this._monitor.width;
        opts.y1 = opts.y2 = this._monitor.y;

        if (position === PanelLocation.TOP) {
            opts.directions = Meta.BarrierDirection.POSITIVE_Y;
        } else if (position === PanelLocation.BOTTOM) {
            opts.y1 = opts.y2 = opts.y1 + this._monitor.height;
            opts.directions = Meta.BarrierDirection.NEGATIVE_Y;
        }

        return new Meta.Barrier(opts);
    }

    _checkMousePointer(x, y) {
        const mouseBtnIsPressed = global.get_pointer()[2] & Clutter.ModifierType.BUTTON1_MASK;
        if (mouseBtnIsPressed)
            return;

        const showInFullscreen = TaskbarManager.settings.get_boolean('intellihide-show-in-fullscreen');
        if (this._monitor.inFullscreen && !showInFullscreen && !this._panelBox.visible)
            return;

        if (!this._edgeBarrier && !this._hover && !Main.overview.visible && this._isPointerInBounds(x, y, 1)) {
            this._hover = true;
            this._queueUpdatePanelPosition(true);
        } else if (this._panelBox.visible) {
            const hover = this._isPointerInBounds(x, y, this._panelBox.height);

            if (hover === this._hover)
                return;

            this._hoveredOut = !hover;
            this._hover = hover;
            this._queueUpdatePanelPosition();
        }
    }

    _isPointerInBounds(x, y, offset) {
        const position = TaskbarManager.settings.get_enum('panel-location');

        return ((position === PanelLocation.TOP && y <= this._monitor.y + offset) ||
            (position === PanelLocation.BOTTOM && y >= this._monitor.y + this._monitor.height - offset)) &&
            x >= this._monitor.x && x < this._monitor.x + this._monitor.width &&
            y >= this._monitor.y && y < this._monitor.y + this._monitor.height;
    }

    _queueUpdatePanelPosition(fromRevealMechanism) {
        if (!fromRevealMechanism && this['_limitUpdateTimeoutId'] && !Main.overview.visible) {
            // unless this is a mouse interaction or entering/leaving the overview, limit the number
            // of updates, but remember to update again when the limit timeout is reached
            this._pendingUpdate = true;
        } else if (!this._holdStatus) {
            const shouldBeVisible = this._checkIfShouldBeVisible(fromRevealMechanism);
            if (shouldBeVisible)
                this._revealPanel();
            else
                this._hidePanel();

            this._createTimeout('_limitUpdateTimeoutId', MIN_UPDATE_MS, () => this._endLimitUpdate());
        }
    }

    _endLimitUpdate() {
        if (this._pendingUpdate) {
            this._pendingUpdate = false;
            this._queueUpdatePanelPosition();
        }
    }

    _checkIfShouldBeVisible(fromRevealMechanism) {
        if (Main.overview.visibleTarget || this._hover || this._checkIfGrab())
            return true;

        if (fromRevealMechanism) {
            const mouseBtnIsPressed = global.get_pointer()[2] & Clutter.ModifierType.BUTTON1_MASK;
            const showInFullscreen = TaskbarManager.settings.get_boolean('intellihide-show-in-fullscreen');
            if (this._monitor.inFullscreen && !mouseBtnIsPressed)
                return showInFullscreen;

            return !mouseBtnIsPressed;
        }

        if (!TaskbarManager.settings.get_boolean('intellihide-hide-from-windows'))
            return this._hover;

        return !this._windowOverlap;
    }

    _checkIfGrab() {
        const grabActor = global.stage.get_grab_actor();
        const sourceActor = grabActor?._sourceActor || grabActor;

        const isGrab = sourceActor && (sourceActor === Main.layoutManager.dummyCursor ||
          this._panel.statusArea.quickSettings?.menu.actor.contains(sourceActor) ||
          this._panel.contains(sourceActor));

        if (isGrab)
            this._createTimeout('_checkGrabTimeoutId', CHECK_GRAB_MS, () => this._queueUpdatePanelPosition());

        return isGrab;
    }

    _revealPanel(immediate) {
        if (!this._panelBox.visible)
            this._panelBox.visible = true;

        this._animatePanel(0, immediate);
    }

    _hidePanel(immediate) {
        const panelLocation = TaskbarManager.settings.get_enum('panel-location');
        const size = this._panelBox.height;
        const coefficient = panelLocation === PanelLocation.TOP ? -1 : 1;

        this._animatePanel(size * coefficient, immediate);
    }

    _animatePanel(destination, immediate) {
        if (destination === this._animationDestination)
            return;

        this._panelBox.remove_all_transitions();
        this._animationDestination = destination;
        if (immediate) {
            this._panelBox.translation_y = destination;
            this._panelBox.visible = !destination;
            this._createTimeout('_postAnimateTimeoutId', POST_ANIMATE_MS, () => {
                this._queueUpdatePanelPosition();
                Main.layoutManager._queueUpdateRegions();
            });
        } else if (destination !== this._panelBox.translation_y) {
            this._panelBox.ease({
                duration: Main.overview.visible ? SIDE_CONTROLS_ANIMATION_TIME : TaskbarManager.settings.get_int('intellihide-animation-time'),
                delay: destination !== 0 && this._hoveredOut ? TaskbarManager.settings.get_int('intellihide-close-delay') : 0,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                translation_y: destination,
                onComplete: () => {
                    this._panelBox.visible = !destination;
                    this._createTimeout('_postAnimateTimeoutId', POST_ANIMATE_MS, () => {
                        this._queueUpdatePanelPosition();
                        Main.layoutManager._queueUpdateRegions();
                    });
                },
            });
        }

        this._hoveredOut = false;
    }

    _removeTimeout(idName) {
        if (this[idName]) {
            GLib.source_remove(this[idName]);
            this[idName] = null;
        }
    }

    _createTimeout(idName, delay, callback) {
        this._removeTimeout(idName);
        this[idName] = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this[idName] = null;
            callback();
            return GLib.SOURCE_REMOVE;
        });
    }

    _setDisplayUnredirect(enable) {
        if (enable && !this._unredirectEnabled) {
            if (ShellVersion >= 48)
                global.compositor.enable_unredirect();
            else
                Meta.enable_unredirect_for_display(global.display);
        } else if (!enable && this._unredirectEnabled) {
            if (ShellVersion >= 48)
                global.compositor.disable_unredirect();
            else
                Meta.disable_unredirect_for_display(global.display);
        }

        this._unredirectEnabled = enable;
    }
};
