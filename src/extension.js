import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';
import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {DesktopIconsUsableAreaClass} from './desktopIconsIntegration.js';
import {NotificationsMonitor} from './notificationsMonitor.js';
import {PanelManager} from './panelManager.js';
import {TaskbarManager} from './taskbarManager.js';
import * as Theming from './theming.js';
import * as UnityLauncherAPI from './unityLauncherAPI.js';

export const PanelLocation = {
    TOP: 0,
    BOTTOM: 1,
};

export default class AzTaskbar extends Extension {
    constructor(metaData) {
        super(metaData);
        this.persistentStorage = {};
    }

    enable() {
        this._desktopIconsUsableArea = new DesktopIconsUsableAreaClass(this.uuid);
        this._taskbarManager = new TaskbarManager(this);
        this._injectionManager = new InjectionManager();
        this.settings = this.getSettings();

        this._dashHidden = false;
        this._hotkeySet = false;

        this.remoteModel = new UnityLauncherAPI.LauncherEntryRemoteModel();
        this.notificationsMonitor = new NotificationsMonitor(this.settings);

        global.azTaskbar = new EventEmitter();

        this.customStylesheet = null;
        Theming.createStylesheet();

        this.settings.connectObject('changed::position-in-panel', () => this._setAppsPosition(), this);
        this.settings.connectObject('changed::position-offset', () => this._setAppsPosition(), this);
        this.settings.connectObject('changed::panel-on-all-monitors', () => this._resetPanels(), this);
        this.settings.connectObject('changed::panel-location', () => {
            Theming.updateStylesheet().then(() => {
                this._setPanelsLocation();
            });
        }, this);
        this.settings.connectObject('changed::isolate-monitors', () => this._resetPanels(), this);
        this.settings.connectObject('changed::show-panel-activities-button', () => this._setActivitiesVisibility(), this);
        this.settings.connectObject('changed::main-panel-height', () => {
            if (this._writeTimeoutId) {
                GLib.source_remove(this._writeTimeoutId);
                this._writeTimeoutId = null;
            }

            this._writeTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                this._writeTimeoutId = null;
                Theming.updateStylesheet().then(() => {
                    this._setPanelsLocation();
                });
                return GLib.SOURCE_REMOVE;
            });
        }, this);
        this.settings.connectObject('changed::hide-dash', () => this._updateDashVisibility(), this);
        this.settings.connectObject('changed::intellihide-key-toggle', () => this._updatePanelToggleHotkey(), this);

        Main.layoutManager.connectObject('monitors-changed', () => this._resetPanels(), this);

        Main.panel.add_style_class_name('azTaskbar-panel');

        global.connectObject('shutdown', () => Theming.deleteStylesheet(), this);

        this._createPanels();
        this._setActivitiesVisibility();
        this._updateDashVisibility();
        this._updatePanelToggleHotkey();
        this._setDesktopIconsMargins();
        this._overrideOverviewControlsAlloc();
    }

    disable() {
        if (this._writeTimeoutId) {
            GLib.source_remove(this._writeTimeoutId);
            this._writeTimeoutId = null;
        }

        if (this._hotkeySet)
            Main.wm.removeKeybinding('intellihide-key-toggle');

        Main.layoutManager.disconnectObject(this);
        this.settings.disconnectObject(this);
        global.disconnectObject(this);

        this._showDash();
        this._injectionManager.clear();

        Theming.deleteStylesheet();
        delete this.customStylesheet;

        this.remoteModel.destroy();
        delete this.remoteModel;

        this.notificationsMonitor.destroy();
        delete this.notificationsMonitor;

        this._deletePanels();
        delete global.azTaskbar;

        this._taskbarManager.destroy();
        this._taskbarManager = null;
        this.settings = null;
        this._dashHidden = null;
        this._desktopIconsUsableArea.destroy();
        this._desktopIconsUsableArea = null;
        this._injectionManager = null;

        Main.layoutManager._updateBoxes();
        Main.layoutManager.uiGroup.remove_style_class_name('azTaskbar-bottom-panel');

        if (!Main.sessionMode.isLocked)
            Main.panel.statusArea.activities.container.show();

        Main.panel.remove_style_class_name('azTaskbar-panel');
    }

    _setDesktopIconsMargins() {
        this._desktopIconsUsableArea?.resetMargins();
        const panelLocation = TaskbarManager.settings.get_enum('panel-location');
        const [overridePanelHeight, customPanelHeight] = TaskbarManager.settings.get_value('main-panel-height').deep_unpack();
        this._panelManagers.forEach(pm => {
            const panelHeight = overridePanelHeight ? customPanelHeight : pm.panelBox.height;
            switch (panelLocation) {
            case PanelLocation.TOP:
                this._desktopIconsUsableArea?.setMargins(pm.monitor.index, panelHeight, 0, 0, 0);
                break;
            case PanelLocation.BOTTOM:
                this._desktopIconsUsableArea?.setMargins(pm.monitor.index, 0, panelHeight, 0, 0);
                break;
            }
        });
    }

    _updatePanelToggleHotkey() {
        if (this._hotkeySet) {
            Main.wm.removeKeybinding('intellihide-key-toggle');
            this._hotkeySet = false;
        }

        // check if hotkey not assigned
        const hotkey = this.settings.get_strv('intellihide-key-toggle');
        if (hotkey.length === 0)
            return;

        Main.wm.addKeybinding('intellihide-key-toggle', this.settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
            () => this._togglePanels());

        this._hotkeySet = true;
    }

    _togglePanels() {
        this._panelManagers.forEach(panelManager => {
            panelManager.intellihide?.toggle();
        });
    }

    _isIntellihideEnabled() {
        for (const panelManager of this._panelManagers) {
            if (panelManager.intellihide?.enabled)
                return true;
        }
        return false;
    }

    _overrideOverviewControlsAlloc() {
        const overviewControls = Main.overview._overview._controls;
        this._injectionManager.overrideMethod(
            Object.getPrototypeOf(overviewControls), 'vfunc_allocate', originalAllocate => box => {
                const position = TaskbarManager.settings.get_enum('panel-location');
                const isBottom = position === PanelLocation.BOTTOM;

                const {transitioning, finalState, progress} = overviewControls._stateAdjustment.getStateTransitionParams();
                const size = Main.panel.height * (transitioning ? Math.abs((finalState !== 0 ? 0 : 1) - progress) : 1);

                if (this._isIntellihideEnabled()) {
                    if (isBottom)
                        box.y2 -= size;
                    else
                        box.y1 += size;
                } else if (isBottom) {
                    box.y2 -= size;
                }

                originalAllocate.call(overviewControls, box);
            }
        );
    }

    _updateDashVisibility() {
        const hideDash = this.settings.get_boolean('hide-dash');
        if (hideDash)
            this._hideDash();
        else
            this._showDash();
    }

    _hideDash() {
        this._dashHidden = true;
        Main.overview.dash.hide();
        const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor || 1;
        Main.overview.dash.height = 100 * scaleFactor;
    }

    _showDash() {
        if (!this._dashHidden)
            return;

        Main.overview.dash.show();
        Main.overview.dash.height = -1;
        Main.overview.dash.setMaxSize(-1, -1);
        this._dashHidden = false;
    }

    _setActivitiesVisibility() {
        const showActivitiesButton = this.settings.get_boolean('show-panel-activities-button');

        this._panelManagers.forEach(panelManager => {
            const activities = panelManager.panel.statusArea.activities;
            if (!activities)
                return;

            activities.container.visible = showActivitiesButton;

            // The shell re-shows panel items whenever it relayouts them, so the
            // hidden state has to be pushed back every time it happens.
            if (!activities._windowTaskbarShowId) {
                activities._windowTaskbarShowId = activities.container.connect('show', () => {
                    if (!this.settings.get_boolean('show-panel-activities-button'))
                        activities.container.hide();
                });
            }
        });
    }

    _resetPanels() {
        this._deletePanels();
        this._createPanels();
        this._setPanelsLocation();
        this._setActivitiesVisibility();
    }

    _createPanels() {
        this._panelManagers = [];
        const panelsOnAllMonitors = this.settings.get_boolean('panel-on-all-monitors');

        if (panelsOnAllMonitors) {
            Main.layoutManager.monitors.forEach(monitor => {
                const panelManager = this._createPanelManager(monitor);
                this._panelManagers.push(panelManager);
            });
        } else {
            const primaryMonitor = Main.layoutManager.primaryMonitor;
            if (!primaryMonitor)
                return;
            const panelManager = this._createPanelManager(primaryMonitor);
            this._panelManagers.push(panelManager);
        }

        global.azTaskbar.panels = this._panelManagers.map(pb => pb.panelBox);
        global.azTaskbar.emit('panels-created');

        this._setPanelsLocation();
    }

    _createPanelManager(monitor) {
        const panelManager = new PanelManager(monitor);
        const {panelBox} = panelManager;

        panelBox.visible = true;
        if (monitor.inFullscreen)
            panelBox.hide();

        panelManager.enable();
        return panelManager;
    }

    _deletePanels() {
        this._panelManagers.forEach(panelManager => {
            panelManager.destroy();
        });
        this._panelManagers = null;
        global.azTaskbar.panels = null;
    }

    _setPanelsLocation() {
        this._panelManagers.forEach(panelManager => panelManager.setSizeAndPosition());
        this._setDesktopIconsMargins();
    }

    _setAppsPosition() {
        this._panelManagers.forEach(panelManager => panelManager.setAppsPosition());
    }

    openPreferences() {
        // Find if an extension preferences window is already open
        const prefsWindow = global.get_window_actors().map(wa => wa.meta_window).find(w => w.wm_class === 'org.gnome.Shell.Extensions');

        if (!prefsWindow) {
            super.openPreferences();
            return;
        }

        // The current prefsWindow belongs to this extension, activate it
        if (prefsWindow.title === this.metadata.name) {
            Main.activateWindow(prefsWindow);
            return;
        }

        // If another extension's preferences are open, close it and open this extension's preferences
        prefsWindow.connectObject('unmanaged', () => {
            super.openPreferences();
            prefsWindow.disconnectObject(this);
        }, this);
        prefsWindow.delete(global.get_current_time());
    }
}
