import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {PopupAnimation} from 'resource:///org/gnome/shell/ui/boxpointer.js';

import {AppIcon, ShowAppsIcon} from './appIcon.js';
import {WindowsList} from './windowButtons.js';
import * as Utils from './utils.js';
import {TaskbarManager} from './taskbarManager.js';
import {WindowPreviewMenuManager} from './windowPreview.js';

const [ShellVersion] = Config.PACKAGE_VERSION.split('.').map(s => Number(s));

async function getPointerWatcher() {
    if (ShellVersion < 51) {
        const PointerWatcher = await import('resource:///org/gnome/shell/ui/pointerWatcher.js');
        return PointerWatcher;
    }
    return null;
};
const PointerWatcher = await getPointerWatcher();

const ShowAppsButtonPosition = {
    LEFT: 0,
    RIGHT: 1,
};

function getDropTarget(box, x) {
    const visibleItems = box.get_children();
    for (const item of visibleItems) {
        const childBox = item.allocation.copy();
        childBox.set_origin(childBox.x1 % box.width, childBox.y1);
        if (x < childBox.x1 || x > childBox.x2)
            continue;

        return {item, index: visibleItems.indexOf(item)};
    }

    return {item: null, index: -1};
}

export const AppIconsTaskbar = GObject.registerClass(
class azTaskbarAppIconsTaskbar extends St.ScrollView {
    _init(monitor) {
        super._init({
            style_class: 'hfade',
            enable_mouse_scrolling: false,
        });
        this.set_policy(St.PolicyType.EXTERNAL, St.PolicyType.NEVER);
        this.set_offscreen_redirect(Clutter.OffscreenRedirect.ALWAYS);
        this.clip_to_allocation = true;
        this._shownInitially = false;

        this._monitor = monitor;
        this.showAppsIcon = new ShowAppsIcon();
        // (the refresh itself is queued by _queueRedisplay, not by the shell)

        this.menuManager = new WindowPreviewMenuManager(this);

        this._appSystem = Shell.AppSystem.get_default();
        this.appIconsCache = new Map();
        this.peekInitialWorkspaceIndex = -1;

        this.mainBox = new St.BoxLayout({
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
        });
        this.mainBox._delegate = this;
        this.mainBox.set_offscreen_redirect(Clutter.OffscreenRedirect.ALWAYS);

        Utils.addChildToParent(this, this.mainBox);

        // Fork addition: one button per window, ungrouped, right after the
        // favourite AppIcons. The grouped running-apps list is not used.
        this.windowsList = new WindowsList(monitor);
        Utils.addChildToParent(this.mainBox, this.windowsList);

        this._setConnections();
        // If AppIconsTaskbar position is moved in the main panel, updateIconGeometry
        this.connect('notify::position', () => this._updateIconGeometry());
        this.connect('destroy', () => this._destroy());
        this._connectWorkspaceSignals();
        this._updateStyle();

        // aztaskbar fills the taskbar only from signals, and the one that does
        // it at session start ('startup-complete') has already come and gone
        // when the extension is enabled later: fill the taskbar right away.
        this._queueRedisplay();
    }

    _setConnections() {
        this._disconnectWorkspaceSignals();
        this._clearConnections();

        TaskbarManager.settings.connectObject('changed::isolate-workspaces', () => this._queueRedisplay(), this);
        TaskbarManager.settings.connectObject('changed::show-running-apps', () => this._queueRedisplay(), this);
        TaskbarManager.settings.connectObject('changed::favorites', () => this._queueRedisplay(), this);
        TaskbarManager.settings.connectObject('changed::show-apps-button', () => this._queueRedisplay(), this);
        TaskbarManager.settings.connectObject('changed::favorites-on-all-monitors', () => this._queueRedisplay(), this);
        TaskbarManager.settings.connectObject('changed::taskbar-spacing', () => this._updateStyle(), this);

        AppFavorites.getAppFavorites().connectObject('changed', () => this._queueRedisplay(), this);

        this._appSystem.connectObject('app-state-changed', () => this._queueRedisplay(), this);
        this._appSystem.connectObject('installed-changed', () => {
            AppFavorites.getAppFavorites().reload();
            this._queueRedisplay();
        }, this);

        global.window_manager.connectObject('switch-workspace', () => {
            this._connectWorkspaceSignals();
            this._queueRedisplay();
        }, this);

        global.display.connectObject('window-entered-monitor', this._queueRedisplay.bind(this), this);
        global.display.connectObject('window-left-monitor', this._queueRedisplay.bind(this), this);
        global.display.connectObject('restacked', this._queueRedisplay.bind(this), this);

        Main.layoutManager.connectObject('startup-complete', this._queueRedisplay.bind(this), this);
    }

    _updateStyle() {
        const spacing = TaskbarManager.settings.get_int('taskbar-spacing');
        this.mainBox.style = `spacing: ${spacing}px;`;
    }

    _clearConnections() {
        TaskbarManager.settings.disconnectObject(this);
        AppFavorites.getAppFavorites().disconnectObject(this);
        this._appSystem.disconnectObject(this);
        global.window_manager.disconnectObject(this);
        global.display.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
    }

    _createAppItem(newApp, monitorIndex) {
        const {app, isFavorite, needsDestroy} = newApp;
        const appID = `${app.get_id()} - ${monitorIndex}`;

        const item = this.appIconsCache.get(appID);

        // If a favorited app is running when extension starts,
        // the corresponding AppIcon may initially be created with isFavorite = false.
        // Check if isFavorite changed, and create new AppIcon if true.
        const favoriteChanged = item && item.isFavorite !== isFavorite;

        if (item && !favoriteChanged) {
            item.isSet = !needsDestroy;
            return item;
        } else if (item && favoriteChanged) {
            this.appIconsCache.delete(appID);
            item.destroy();
        }

        const appIcon = new AppIcon(this, app, monitorIndex, isFavorite);
        appIcon.isSet = true;
        this.appIconsCache.set(appID, appIcon);
        return appIcon;
    }

    handleDragOver(source, actor, x, _y, _time) {
        const dropTarget = getDropTarget(this.mainBox, x);
        const dropTargetItem = dropTarget.item;
        const {index} = dropTarget;

        if (!dropTargetItem || !source)
            return DND.DragMotionResult.NO_DROP;

        source.dragMonitorIndex = dropTargetItem.monitorIndex ?? -1;
        source.dragPos = index;
        const inFavoriteRange = source.dragPos >= (source.firstFavIndex - 1) &&
                                source.dragPos <= source.lastFavIndex &&
                                dropTargetItem.monitorIndex === source.monitorIndex;

        const id = source.app.get_id();
        const favorites = AppFavorites.getAppFavorites().getFavoriteMap();
        let noDrop = id in favorites;

        if (source.app.is_window_backed() || !global.settings.is_writable('favorite-apps'))
            noDrop = true;

        if (dropTargetItem instanceof AppIcon && dropTargetItem !== source) {
            if (inFavoriteRange && noDrop && !source.isFavorite)
                return DND.DragMotionResult.NO_DROP;

            // 1. If drop target location not on same monitor as source, but in fav range.
            // 2. else if source has been moved to favorite range from different monitor,
            // return to last location.
            if (!source.isFavorite && inFavoriteRange) {
                if (!source.lastPositionIndex)
                    source.lastPositionIndex = this.mainBox.get_children().indexOf(source);
                this.mainBox.remove_child(source);
                this.mainBox.insert_child_at_index(source, index);
            } else if (dropTargetItem.monitorIndex !== source.monitorIndex &&
                    !inFavoriteRange && source.lastPositionIndex) {
                this.mainBox.remove_child(source);
                this.mainBox.insert_child_at_index(source, source.lastPositionIndex);
                source.lastPositionIndex = null;
            } else if (dropTargetItem.monitorIndex === source.monitorIndex) {
                this.mainBox.remove_child(source);
                this.mainBox.insert_child_at_index(source, index);
            }
        }

        if (inFavoriteRange)
            source.add_style_class_name('azTaskbar-favorite');
        else
            source.remove_style_class_name('azTaskbar-favorite');

        if (source.isFavorite || !inFavoriteRange)
            return DND.DragMotionResult.NO_DROP;

        return DND.DragMotionResult.COPY_DROP;
    }

    acceptDrop(source, _actor, x, _y, _time) {
        if (!(source instanceof AppIcon))
            return false;

        const dropTarget = getDropTarget(this.mainBox, x);
        const dropTargetItem = dropTarget.item;

        const id = source.app.get_id();
        const appFavorites = AppFavorites.getAppFavorites();
        const favorites = appFavorites.getFavoriteMap();
        const srcIsFavorite = id in favorites;
        const favPos = source.dragPos - source.firstFavIndex;
        const inFavoriteRange = source.dragPos >= (source.firstFavIndex - 1) &&
                                source.dragPos <= source.lastFavIndex;

        if (!srcIsFavorite && dropTargetItem.monitorIndex !== source.monitorIndex && !inFavoriteRange)
            return false;

        const appIcons = this.mainBox.get_children().filter(actor => {
            if (actor instanceof AppIcon)
                return true;
            return false;
        });

        let position = 0;
        for (let i = 0, l = appIcons.length; i < l; ++i) {
            const appIcon = appIcons[i];
            const windows = appIcon.getInterestingWindows();

            for (let j = 0; j < windows.length; j++)
                windows[j]._azTaskbarPosition = position++;
        }

        if (source.isFavorite) {
            if (source.dragPos > source.lastFavIndex || source.dragPos < source.firstFavIndex - 1)
                appFavorites.removeFavorite(id);
            else
                appFavorites.moveFavoriteToPos(id, favPos);
        } else if (inFavoriteRange) {
            if (srcIsFavorite)
                appFavorites.moveFavoriteToPos(id, favPos);
            else
                appFavorites.addFavoriteAtPos(id, favPos);
        }

        this._queueRedisplay();

        return true;
    }

    /**
     * _getAppStableSequence(), _sortWindowsCompareFunction(), _getWindowStableSequence(),
     * _sortAppsCompareFunction(), _getRunningApps(), _getAppInfos(), _createAppInfos()
     * methods borrowed from Dash to Panel extension
     */

    _getAppStableSequence(app, monitor) {
        const windows = Utils.getInterestingWindows(TaskbarManager.settings, app.get_windows(), monitor);

        return windows.reduce((prevWindow, window) => {
            return Math.min(prevWindow, this._getWindowStableSequence(window));
        }, Infinity);
    }

    _sortWindowsCompareFunction(windowA, windowB) {
        return this._getWindowStableSequence(windowA) - this._getWindowStableSequence(windowB);
    }

    _getWindowStableSequence(window) {
        return '_azTaskbarPosition' in window ? window._azTaskbarPosition : window.get_stable_sequence();
    }

    _sortAppsCompareFunction(appA, appB, monitor) {
        return this._getAppStableSequence(appA, monitor) -
               this._getAppStableSequence(appB, monitor);
    }

    _getRunningApps() {
        const tracker = Shell.WindowTracker.get_default();
        const windows = global.get_window_actors();
        const apps = [];

        for (let i = 0, l = windows.length; i < l; ++i) {
            const app = tracker.get_window_app(windows[i].metaWindow);

            if (app && apps.indexOf(app) < 0)
                apps.push(app);
        }

        return apps;
    }

    _getAppInfos(showFavorites, showRunningApps, monitorIndex) {
        // get the user's favorite apps
        const favoriteApps = showFavorites ? AppFavorites.getAppFavorites().getFavorites() : [];

        // find the apps that should be in the taskbar: the favorites first, then add the running apps
        const runningApps = showRunningApps ? this._getRunningApps().sort((a, b) => this._sortAppsCompareFunction(a, b, monitorIndex)) : [];

        return this._createAppInfos(favoriteApps.concat(runningApps.filter(app => favoriteApps.indexOf(app) < 0)), monitorIndex)
                    .filter(appInfo => appInfo.windows.length || favoriteApps.indexOf(appInfo.app) >= 0);
    }

    _createAppInfos(apps, monitorIndex) {
        const isPrimaryMonitor = monitorIndex === Main.layoutManager.primaryIndex;
        const showFavorites = TaskbarManager.settings.get_boolean('favorites');
        const favsOnAllMonitors = TaskbarManager.settings.get_boolean('favorites-on-all-monitors');
        const shouldFavorite = showFavorites && (isPrimaryMonitor || favsOnAllMonitors);

        const favoriteApps = AppFavorites.getAppFavorites().getFavorites();
        return apps.map(app => ({
            app,
            isFavorite: favoriteApps.indexOf(app) >= 0 && shouldFavorite,
            windows: Utils.getInterestingWindows(TaskbarManager.settings, app.get_windows(), monitorIndex).sort(this._sortWindowsCompareFunction.bind(this)),
        }));
    }

    _queueRedisplay() {
        Utils.queueRefresh(this, '_refreshId', () => this._redisplay());
    }

    _redisplay() {
        const appIconsOnTaskbar = [];

        this.mainBox.get_children().forEach(actor => {
            if (actor instanceof AppIcon) {
                actor.isSet = false;
                appIconsOnTaskbar.push({
                    app: actor.app,
                    isFavorite: actor.isFavorite,
                });
            } else if (actor instanceof ShowAppsIcon) {
                this.mainBox.remove_child(actor);
            } else if (actor === this.windowsList) {
                // the window list is permanent, it only moves position below
            } else {
                this.mainBox.remove_child(actor);
                actor.destroy();
            }
        });

        const monitorIndex = this._monitor.index;
        const favsOnAllMonitors = TaskbarManager.settings.get_boolean('favorites-on-all-monitors');
        const isPrimaryMonitor = monitorIndex === Main.layoutManager.primaryIndex;
        const panelsOnAllMonitors = TaskbarManager.settings.get_boolean('panel-on-all-monitors');
        // Fork: the grouped running-app list is replaced by WindowsList, so the
        // AppIcons are favourites only. 'show-running-apps' now shows/hides the
        // window list itself.
        const showRunningApps = false;
        let showFavorites = TaskbarManager.settings.get_boolean('favorites');
        if (panelsOnAllMonitors && showFavorites)
            showFavorites = favsOnAllMonitors ? true : isPrimaryMonitor;

        const animate = this._shownInitially;
        if (!this._shownInitially)
            this._shownInitially = true;

        const expectedAppsInfo = this._getAppInfos(showFavorites, showRunningApps, monitorIndex);
        const expectedApps = expectedAppsInfo.map(appInfo => appInfo.app);

        appIconsOnTaskbar.forEach(appIcon => {
            const {app} = appIcon;
            const index = expectedApps.indexOf(app);
            if (index < 0) {
                const appID = `${app.get_id()} - ${monitorIndex}`;
                const item = this.appIconsCache.get(appID);
                if (item && !item.animatingOut) {
                    this.appIconsCache.delete(appID);
                    item.animateOutAndDestroy();
                }
            }
        });

        for (let j = 0; j < expectedAppsInfo.length; j++) {
            const appIconInfo = expectedAppsInfo[j];
            const item = this._createAppItem(appIconInfo, monitorIndex);
            const parent = item.get_parent();

            if (parent) {
                if (item.opacity !== 255)
                    item.animateIn(animate);
            } else if (!parent) {
                item.opacity = 0;
                this.mainBox.insert_child_at_index(item, j);
                item.animateIn(animate);
            }

            if (item.isSet)
                item.updateAppIcon();
        }

        // insert_child_at_index does not re-parent an attached child (Clutter
        // warns and silently ignores the request), so the permanent window list
        // is unparented before it is put back at its position.
        if (this.windowsList.get_parent() === this.mainBox)
            this.mainBox.remove_child(this.windowsList);
        this.mainBox.insert_child_at_index(this.windowsList, expectedAppsInfo.length);

        const [showAppsButton, showAppsButtonPosition] = TaskbarManager.settings.get_value('show-apps-button').deep_unpack();
        if (showAppsButton) {
            if (showAppsButtonPosition === ShowAppsButtonPosition.LEFT)
                this.mainBox.insert_child_at_index(this.showAppsIcon, 0);
            else
                this.mainBox.add_child(this.showAppsIcon);
            this.showAppsIcon.updateIcon();
            this.showAppsIcon.animateIn(animate);
        }

        this.mainBox.queue_relayout();
    }

    _connectWorkspaceSignals() {
        const currentWorkspace = global.workspace_manager.get_active_workspace();

        if (this._lastWorkspace === currentWorkspace)
            return;

        this._disconnectWorkspaceSignals();

        this._lastWorkspace = currentWorkspace;

        this._workspaceWindowAddedId = this._lastWorkspace.connect('window-added',
            () => this._queueRedisplay());
        this._workspaceWindowRemovedId = this._lastWorkspace.connect('window-removed',
            () => this._queueRedisplay());
    }

    _disconnectWorkspaceSignals() {
        if (this._lastWorkspace) {
            this._lastWorkspace.disconnect(this._workspaceWindowAddedId);
            this._lastWorkspace.disconnect(this._workspaceWindowRemovedId);

            this._lastWorkspace = null;
        }
    }

    updateIcon() {
        this.appIconsCache.forEach((appIcon, _appID) => {
            if (appIcon.isSet)
                appIcon.updateIcon();
        });
    }

    _updateIconGeometry() {
        this.appIconsCache.forEach((appIcon, _appID) => {
            if (appIcon.isSet)
                appIcon.updateIconGeometry();
        });
    }

    startPointerWatch() {
        if (this._cursorTrackerId)
            return;

        this.removeWindowPreviewCloseTimeout();

        const onPointerWatch = (x, y) => {
            if (!this._appIconHasMousePointer(x, y))
                this.setWindowPreviewCloseTimeout();
            else
                this.removeWindowPreviewCloseTimeout();
        };

        if (ShellVersion >= 51) {
            const cursorTracker = global.backend.get_cursor_tracker();
            this._cursorTrackerId = cursorTracker.connect('position-invalidated', () => {
                const [coords] = cursorTracker.get_pointer();
                onPointerWatch(coords.x, coords.y);
            });
        } else {
            const interval = 1000 / 60;
            this._cursorTrackerId = PointerWatcher.getPointerWatcher().addWatch(interval, (x, y) => {
                onPointerWatch(x, y);
            });
        }
    }

    endPointerWatch() {
        if (!this._cursorTrackerId)
            return;

        if (ShellVersion >= 51) {
            const cursorTracker = global.backend.get_cursor_tracker();
            cursorTracker.disconnect(this._cursorTrackerId);
            this._cursorTrackerId = null;
        } else {
            PointerWatcher.getPointerWatcher()._removeWatch(this._cursorTrackerId);
            this._cursorTrackerId = null;
        }
    }

    _appIconHasMousePointer(x, y) {
        const activePreview = this.menuManager.activeMenu;

        const cursorLocation = new Graphene.Point({x, y});

        const windowPreviewRect = activePreview?.actor.get_transformed_extents() ?? false;
        const appIconRect = activePreview._source.get_transformed_extents();

        const windowPreviewHasMouse = windowPreviewRect?.contains_point(cursorLocation);

        return windowPreviewHasMouse || appIconRect.contains_point(cursorLocation);
    }

    removeWindowPreviewCloseTimeout() {
        if (this._windowPreviewCloseTimeoutId > 0) {
            GLib.source_remove(this._windowPreviewCloseTimeoutId);
            this._windowPreviewCloseTimeoutId = 0;
        }
    }

    setWindowPreviewCloseTimeout() {
        if (this._windowPreviewCloseTimeoutId > 0)
            return;

        this._windowPreviewCloseTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
            TaskbarManager.settings.get_int('window-previews-hide-timeout'), () => {
                const activePreview = this.menuManager.activeMenu;
                if (activePreview)
                    activePreview.close(PopupAnimation.FULL);

                this._windowPreviewCloseTimeoutId = 0;
                this.endPointerWatch();
                return GLib.SOURCE_REMOVE;
            });
    }

    _destroy() {
        Utils.cancelRefresh(this, '_refreshId');
        this._disconnectWorkspaceSignals();
        this.removeWindowPreviewCloseTimeout();
        this.endPointerWatch();

        this._clearConnections();
        this.windowsList.destroy();
        this.windowsList = null;
        this.showAppsIcon.destroy();
        this.appIconsCache.forEach((appIcon, appID) => {
            appIcon.stopAllAnimations();
            appIcon.destroy();
            this.appIconsCache.delete(appID);
        });
        this.appIconsCache = null;
        this.showAppsIcon = null;
        this.menuManager = null;
        this._appSystem = null;
    }
});
