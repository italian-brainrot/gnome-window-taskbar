/**
 * Credits:
 *
 * This file is based on windowPreview.js from Dash to Dock
 * See https://github.com/micheleg/dash-to-dock/blob/master/windowPreview.js
 * for more details.
 *
 * Window peeking and other parts of code based on code from Dash to Panel
 * https://github.com/home-sweet-gnome/dash-to-panel/blob/master/windowPreview.js
 *
 * Some code was also adapted from the upstream Gnome Shell source code.
 *
 * New code and modifications implemented to better suit this extensions needs.
 */
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as AppIcon from './appIcon.js';
import {TaskbarManager} from './taskbarManager.js';
import * as Utils from './utils.js';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {PopupAnimation} from 'resource:///org/gnome/shell/ui/boxpointer.js';
import {Workspace} from 'resource:///org/gnome/shell/ui/workspace.js';

const PREVIEW_MAX_WIDTH = 250;
const PREVIEW_MAX_HEIGHT = 150;

const PREVIEW_ITEM_WIDTH = 255;
const PREVIEW_ITEM_HEIGHT = 190;

const PREVIEW_ANIMATION_DURATION = 250;
const MAX_PREVIEW_GENERATION_ATTEMPTS = 15;

const WindowPreviewClickAction = {
    RAISE: 0,
    RAISE_MINIMIZE: 1,
};

export const WindowPreviewMenuManager = class azTaskbarWindowPreviewMenuManager extends PopupMenu.PopupMenuManager {
    constructor(owner, grabParams) {
        super(owner, grabParams);
        this._owner = owner;
        this._changeWindowPreviewTimeoutId = 0;

        this._owner.connect('destroy', () => {
            this._removeChangeWindowPreviewTimeout();
            this._owner = null;
        });
    }

    _onMenuOpenState(menu, open) {
        if (open && this.activeMenu === menu)
            return;

        if (open) {
            const oldMenu = this.activeMenu;
            this.activeMenu = menu;
            oldMenu?.close(PopupAnimation.FADE);

            if (!this._keyFocusId) {
                this._keyFocusId =
                    global.stage.connect('notify::key-focus', () => {
                        if (!this.activeMenu)
                            return;

                        const actor = global.stage.get_key_focus();
                        const newMenu = this._findMenuForSource(actor);

                        if (newMenu)
                            this._changeMenu(newMenu);
                    });
            }
        } else if (this.activeMenu === menu) {
            this.activeMenu = null;

            if (this._keyFocusId) {
                global.stage.disconnect(this._keyFocusId);
                delete this._keyFocusId;
            }
        }
    }

    _isActorHovered(source) {
        while (source) {
            if (source.has_pointer)
                return true;
            // Stop when parent is AppIcon.BaseButton
            if (source instanceof AppIcon.BaseButton)
                return false;
            source = source.get_parent();
        }

        return false;
    }

    _removeChangeWindowPreviewTimeout() {
        if (this._changeWindowPreviewTimeoutId > 0) {
            GLib.source_remove(this._changeWindowPreviewTimeoutId);
            this._changeWindowPreviewTimeoutId = 0;
        }
    }
};

export const WindowPreviewMenu = class azTaskbarWindowPreviewMenu extends PopupMenu.PopupMenu {
    constructor(source, menuManager) {
        super(source, 0.5, St.Side.TOP);
        this.actor.track_hover = true;
        this.actor.reactive = true;
        this._source = source;
        this._app = this._source.app;
        const {monitorIndex} = this._source;
        this.appIconsTaskbar = source.appIconsTaskbar;
        this.menuManager = menuManager;
        this.actor.set_style(`max-width: ${Main.layoutManager.monitors[monitorIndex].width - 100}px;` +
            `max-height: ${Main.layoutManager.monitors[monitorIndex].height - 100}px;`);
        this.actor.hide();

        // Chain our visibility and lifecycle to that of the source
        this._mappedId = this._source.connect('notify::mapped', () => {
            if (!this._source.mapped)
                this.close();
        });

        Main.uiGroup.add_child(this.actor);

        this.connect('destroy', this._onDestroy.bind(this));
    }

    display() {
        this._previewBox?.destroy();

        this._previewBox = new WindowPreviewList(this._source);
        this.addMenuItem(this._previewBox);
        this._previewBox.display();
    }

    popup() {
        this.open(PopupAnimation.FULL);
    }

    open(animate) {
        if (this.shouldOpen) {
            this.display();
            super.open(animate);
            this.appIconsTaskbar.startPointerWatch();
            this._previewBox?.maybeShowScrollBar();
        }
    }

    close(animate) {
        this.appIconsTaskbar.endPointerWatch();
        super.close(animate);
    }

    get shouldOpen() {
        const windows = this._source.getInterestingWindows();
        if (windows.length > 0)
            return true;
        else
            return false;
    }

    _findBaseButton(targetActor) {
        while (targetActor) {
            if (targetActor instanceof AppIcon.BaseButton)
                return targetActor;
            targetActor = targetActor.get_parent();
        }

        return null;
    }

    _onDestroy() {
        if (this._mappedId > 0)
            this._source.disconnect(this._mappedId);

        this._source = null;
        this._app = null;
        this.appIconsTaskbar = null;
        this.menuManager = null;
    }
};

const WindowPreviewList = class azTaskbarWindowPreviewList extends PopupMenu.PopupMenuSection {
    constructor(source) {
        super();

        this.actor = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.NEVER,
            enable_mouse_scrolling: true,
        });
        this.actor.connect('scroll-event', this._onScrollEvent.bind(this));
        Utils.addChildToParent(this.actor, this.box);
        this.box.set({
            ...Utils.getOrientationProp(false),
        });
        this.actor._delegate = this;
        this._source = source;
        this.app = source.app;

        this.grid = new St.Widget({
            x_expand: true,
            y_expand: true,
            layout_manager: new Clutter.GridLayout({
                row_spacing: 8,
                column_spacing: 8,
            }),
        });
        Utils.addChildToParent(this.box, this.grid);
    }

    destroy() {
        this._source = null;
        this.app = null;
        super.destroy();
    }

    _onScrollEvent(actor, event) {
        // Skip to avoid double events mouse
        if (event.is_pointer_emulated())
            return Clutter.EVENT_STOP;

        let delta;
        const {vadjustment, hadjustment} = Utils.getScrollViewAdjustments(this.actor);

        const adjustment = this.actor.vscrollbar_visible ? vadjustment : hadjustment;
        const increment = adjustment.step_increment;

        switch (event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP:
            delta = -increment;
            break;
        case Clutter.ScrollDirection.DOWN:
            delta = increment;
            break;
        case Clutter.ScrollDirection.SMOOTH: {
            const [dx, dy] = event.get_scroll_delta();
            const vscroll = this.actor.vscrollbar_visible;
            delta = vscroll ? dy * increment : dx * increment;
            break;
        }
        default:
            return Clutter.EVENT_PROPAGATE;
        }

        adjustment.set_value(adjustment.get_value() + delta);

        return Clutter.EVENT_STOP;
    }

    maybeShowScrollBar() {
        const {vScroll, hScroll} = this._needsScrollbar();
        const hScrollbarPolicy = hScroll ? St.PolicyType.AUTOMATIC : St.PolicyType.NEVER;
        const vScrollbarPolicy = vScroll ? St.PolicyType.AUTOMATIC : St.PolicyType.NEVER;
        this.actor.hscrollbar_policy = hScrollbarPolicy;
        this.actor.vscrollbar_policy = vScrollbarPolicy;
        if (vScroll || hScroll)
            this.actor.add_style_pseudo_class('scrolled');
        else
            this.actor.remove_style_pseudo_class('scrolled');
    }

    display() {
        const openWindows = this._source.getInterestingWindows().sort((a, b) => {
            return a.get_stable_sequence() > b.get_stable_sequence();
        });

        const gridEnabled = TaskbarManager.settings.get_boolean('window-preview-grid-enabled');
        const columns = TaskbarManager.settings.get_int('window-preview-grid-columns');
        const gridLayout = this.grid.layout_manager;

        openWindows.forEach((window, index) => {
            const previewMenuItem = new WindowPreviewMenuItem(this, this._source, window, this.app);
            const row = gridEnabled ? Math.floor(index / columns) : 0;
            const col = gridEnabled ? index % columns : index;
            gridLayout.attach(previewMenuItem, col, row, 1, 1);
        });
    }

    redisplay() {
        const topMenu = this._getTopMenu();
        if (!topMenu.isOpen)
            return;

        const children = this.grid.get_children();
        this.grid.remove_all_children();

        const gridEnabled = TaskbarManager.settings.get_boolean('window-preview-grid-enabled');
        const columns = TaskbarManager.settings.get_int('window-preview-grid-columns');
        const gridLayout = this.grid.layout_manager;

        children.forEach((child, index) => {
            const row = gridEnabled ? Math.floor(index / columns) : 0;
            const col = gridEnabled ? index % columns : index;
            gridLayout.attach(child, col, row, 1, 1);
        });

        this.maybeShowScrollBar();
    }

    _needsScrollbar() {
        const topMenu = this._getTopMenu();
        const topThemeNode = topMenu.actor.get_theme_node();
        const [topMinWidth_, topNaturalWidth] = topMenu.actor.get_preferred_width(-1);
        const topMaxWidth = topThemeNode.get_max_width();
        const [topMinHeight_, topNaturalHeight] = topMenu.actor.get_preferred_height(-1);
        const topMaxHeight = topThemeNode.get_max_height();

        const hScroll = topMaxWidth >= 0 && topNaturalWidth >= topMaxWidth;
        const vScroll = topMaxHeight >= 0 && topNaturalHeight >= topMaxHeight;
        return {hScroll, vScroll};
    }
};

const WindowPreviewMenuItem = GObject.registerClass(
class azTaskbarWindowPreviewMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(section, source, window, app) {
        super._init();
        this.add_style_class_name('azTaskbar-window-preview-menu-item');
        this.x_align = Clutter.ActorAlign.FILL;
        this.x_expand = true;
        this.y_align = Clutter.ActorAlign.FILL;
        this.y_expand = true;
        this._window = window;
        this._app = app;
        this._destroyId = 0;
        this._windowAddedId = 0;

        this._source = source.appIconsTaskbar;
        this._section = section;

        // hard set the width and height for consistancy across all window previews
        const scaleFactor = TaskbarManager.settings.get_double('window-previews-size-scale');
        this.style = `width: ${scaleFactor * PREVIEW_ITEM_WIDTH}px; height: ${scaleFactor * PREVIEW_ITEM_HEIGHT}px;`;

        // We don't want this: it adds spacing on the left of the item.
        this.remove_child(this._ornamentIcon);

        this._cloneBin = new St.Bin({
            style_class: 'azTaskbar-window-preview',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.END,
            y_expand: true,
            x_expand: true,
        });

        this._updateWindowPreviewSize();

        const buttonSize = TaskbarManager.settings.get_int('window-preview-button-size');
        const buttonIconSize = TaskbarManager.settings.get_int('window-preview-button-icon-size');
        this.closeButton = new St.Button({
            style_class: 'window-close azTaskbar-window-preview-button',
            x_expand: false,
            x_align: Clutter.ActorAlign.END,
            y_expand: true,
            y_align: Clutter.ActorAlign.START,
            opacity: 0,
            style: `width: ${buttonSize}px; height: ${buttonSize}px;`,
        });
        this.closeButton.connect('clicked', this._closeWindow.bind(this));

        const closeIcon = new St.Icon({
            icon_name: 'window-close-symbolic',
            icon_size: buttonIconSize,
        });
        Utils.addChildToParent(this.closeButton, closeIcon);

        this.minimizeButton = new St.Button({
            style_class: 'window-close azTaskbar-window-preview-button',
            x_expand: false,
            x_align: Clutter.ActorAlign.END,
            y_expand: true,
            y_align: Clutter.ActorAlign.START,
            opacity: 0,
            style: `width: ${buttonSize}px; height: ${buttonSize}px;`,
        });
        this.minimizeButton.connect('clicked', this._minimizeWindow.bind(this));

        const minimizeIcon = new St.Icon({
            icon_name: 'window-minimize-symbolic',
            icon_size: buttonIconSize,
        });
        Utils.addChildToParent(this.minimizeButton, minimizeIcon);

        const buttonSpacing = TaskbarManager.settings.get_int('window-preview-button-spacing');
        const buttonsBox = new St.BoxLayout({
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            style: `spacing: ${buttonSpacing}px;`,
        });
        buttonsBox.add_child(this.minimizeButton);
        buttonsBox.add_child(this.closeButton);

        const titleBox = new St.BoxLayout({
            x_expand: true,
            style_class: 'azTaskbar-window-preview-header-box',
        });

        const appIconSize = TaskbarManager.settings.get_int('window-preview-app-icon-size');
        const appIcon = this._app.create_icon_texture(appIconSize);
        appIcon.set({
            y_align: Clutter.ActorAlign.START,
            y_expand: true,
        });

        titleBox.add_child(appIcon);

        let workSpaceIndexText = '';
        if (!TaskbarManager.settings.get_boolean('isolate-workspaces'))
            workSpaceIndexText = `${this._window.get_workspace().index() + 1}  `;

        const titleFontSize = TaskbarManager.settings.get_int('window-preview-title-font-size');
        const label = new St.Label({
            text: workSpaceIndexText + window.get_title(),
            style: `font-size: ${titleFontSize}pt; font-weight: bolder;`,
        });
        label.clutter_text.set({
            line_wrap: true,
            ellipsize: Pango.EllipsizeMode.END,
            line_wrap_mode: Pango.WrapMode.WORD_CHAR,
        });
        const labelBin = new St.Bin({
            child: label,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
            y_expand: true,
        });
        titleBox.add_child(labelBin);

        this._windowTitleId = this._window.connect('notify::title', () => {
            label.set_text(workSpaceIndexText + this._window.get_title());
        });

        const overlayGroup = new Clutter.Actor({
            layout_manager: new Clutter.BinLayout(),
            y_expand: false,
        });
        Utils.addChildToParent(overlayGroup, titleBox);
        Utils.addChildToParent(overlayGroup, buttonsBox);

        this._box = new St.BoxLayout({
            ...Utils.getOrientationProp(true),
            x_expand: true,
            y_expand: true,
        });
        this._box.add_child(overlayGroup);
        this._box.add_child(this._cloneBin);
        this.add_child(this._box);

        this._cloneTexture(window);

        this.connect('destroy', this._onDestroy.bind(this));
        this._section.connectObject('menu-closed', () => this._endPeek(), this);
    }

    _getWindowPreviewSize() {
        const emptySize = [0, 0];

        const mutterWindow = this._window.get_compositor_private();

        if (!mutterWindow?.get_texture())
            return emptySize;

        const [width, height] = mutterWindow.get_size();

        if (!width || !height)
            return emptySize;

        const scaleFactor = TaskbarManager.settings.get_double('window-previews-size-scale');
        const maxWidth = scaleFactor * PREVIEW_MAX_WIDTH;
        const maxHeight = scaleFactor * PREVIEW_MAX_HEIGHT;

        const scale = Math.min(1.0, maxWidth / width, maxHeight / height);

        // width and height that we wanna multiply by scale
        return [width * scale, height * scale];
    }

    _updateWindowPreviewSize() {
        // This gets the actual windows size for the preview
        [this._width, this._height] = this._getWindowPreviewSize();
        this._cloneBin.style = `width: ${this._width}px; height: ${this._height}px;`;
    }

    _cloneTexture(metaWin) {
        if (!this._width || !this._height) {
            this._cloneTextureLater = Utils.laterAdd(Meta.LaterType.BEFORE_REDRAW, () => {
                // Check if there's still a point in getting the texture,
                // otherwise this could go on indefinitely
                this._updateWindowPreviewSize();

                if (this._width && this._height) {
                    this._cloneTexture(metaWin);
                } else {
                    this._cloneAttempt = (this._cloneAttempt || 0) + 1;
                    if (this._cloneAttempt < MAX_PREVIEW_GENERATION_ATTEMPTS)
                        return GLib.SOURCE_CONTINUE;
                }
                delete this._cloneTextureLater;
                return GLib.SOURCE_REMOVE;
            });
            return;
        }

        const mutterWindow = metaWin.get_compositor_private();
        const clone = new Clutter.Clone({
            source: mutterWindow,
            reactive: true,
        });

        // when the source actor is destroyed, i.e. the window closed, first destroy the clone
        // and then destroy the menu item (do this animating out)
        this._destroyId = mutterWindow.connect('destroy', () => {
            clone.destroy();
            this._destroyId = 0; // avoid to try to disconnect this signal from mutterWindow in _onDestroy(),
            // as the object was just destroyed
            this._animateOutAndDestroy();
        });

        this._clone = clone;
        this._mutterWindow = mutterWindow;
        this._cloneBin.set_child(this._clone);

        this._clone.connect('destroy', () => {
            if (this._destroyId) {
                mutterWindow.disconnect(this._destroyId);
                this._destroyId = 0;
            }
            this._clone = null;
        });
    }

    _windowCanClose() {
        return this._window.can_close() &&
            !this._hasAttachedDialogs();
    }

    _closeWindow() {
        this._endPeek();

        // If we are closing the last window preview, also close the popup menu
        const lastItem = this._section.grid.get_children().length === 1;
        if (this._section._getTopMenu().isOpen && lastItem)
            this._section._getTopMenu().close();

        this._workspace = this._window.get_workspace();

        // This mechanism is copied from the workspace.js upstream code
        // It forces window activation if the windows don't get closed,
        // for instance because asking user confirmation, by monitoring the opening of
        // such additional confirmation window
        this._windowAddedId = this._workspace.connect('window-added',
            this._onWindowAdded.bind(this));

        this.deleteAllWindows();
    }

    _minimizeWindow() {
        this._endPeek();
        this.minimizeButton.remove_all_transitions();
        this.minimizeButton.ease({
            opacity: 0,
            duration: Workspace.WINDOW_OVERLAY_FADE_TIME,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
        });
        this._window.minimize();
    }

    deleteAllWindows() {
        // Delete all windows, starting from the bottom-most (most-modal) one
        const windows = this._clone.get_children();
        for (let i = windows.length - 1; i >= 1; i--) {
            const realWindow = windows[i].source;
            const metaWindow = realWindow.meta_window;

            metaWindow.delete(global.get_current_time());
        }

        this._window.delete(global.get_current_time());
    }

    _onWindowAdded(workspace, win) {
        const metaWindow = this._window;

        if (win.get_transient_for() === metaWindow) {
            workspace.disconnect(this._windowAddedId);
            this._windowAddedId = 0;

            // use an idle handler to avoid mapping problems -
            // see comment in Workspace._windowAdded
            const activationEvent = Clutter.get_current_event();
            this._windowAddedLater = Utils.laterAdd(Meta.LaterType.BEFORE_REDRAW, () => {
                delete this._windowAddedLater;
                this.emit('activate', activationEvent);
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _hasAttachedDialogs() {
        // count trasient windows
        let n = 0;
        this._window.foreach_transient(() => {
            n++;
        });
        return n > 0;
    }

    _containsPointer(x, y) {
        const boxRect = this._box.get_transformed_extents();
        const cursorLocation = new Graphene.Point({x, y});

        if (boxRect.contains_point(cursorLocation))
            return true;
        else
            return false;
    }

    vfunc_enter_event(crossingEvent) {
        this._hasPointer = true;
        if (TaskbarManager.settings.get_boolean('peek-windows'))
            this._startPeek();
        this._showCloseButton();
        return super.vfunc_enter_event(crossingEvent);
    }

    vfunc_leave_event(crossingEvent) {
        const [x, y] = global.get_pointer();
        const hasPointer = this._containsPointer(x, y);
        this._hasPointer = hasPointer;
        if (!hasPointer)
            this._hideCloseButton();

        if (TaskbarManager.settings.get_boolean('peek-windows') && !hasPointer)
            this._endPeekWithDelay();

        return super.vfunc_leave_event(crossingEvent);
    }

    _startPeek() {
        this._removeEndPeekDelay();
        if (this._source.peekTimeoutId > 0) {
            GLib.source_remove(this._source.peekTimeoutId);
            this._source.peekTimeoutId = 0;
        }

        if (this._source.peekInitialWorkspaceIndex < 0) {
            this._source.peekTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
                TaskbarManager.settings.get_int('peek-windows-timeout'), () => {
                    this._peek();
                    this._source.peekTimeoutId = 0;
                    return GLib.SOURCE_REMOVE;
                });
        } else {
            this._peek();
        }
    }

    _peek() {
        if (this.workspaceSwitchId > 0) {
            GLib.source_remove(this.workspaceSwitchId);
            this.workspaceSwitchId = 0;
        }

        const activeWorkspace = global.workspace_manager.get_active_workspace();
        const windowWorkspace = this._window.get_workspace();

        this._restorePeekedWindowStack();

        if (this._source.peekedWindow && windowWorkspace !== activeWorkspace)
            activeWorkspace.list_windows().forEach(mw => this.animateWindowOpacity(mw, null, 255));

        this._source.peekedWindow = this._window;

        if (activeWorkspace !== windowWorkspace)
            this._switchToWorkspaceImmediate(windowWorkspace.index());

        this._focusMetaWindow(TaskbarManager.settings.get_int('peek-windows-opacity'), this._window);

        if (this._source.peekInitialWorkspaceIndex < 0)
            this._source.peekInitialWorkspaceIndex = activeWorkspace.index();
    }

    _focusMetaWindow(dimOpacity, window, immediate, ignoreFocus) {
        window.get_workspace().list_windows().forEach(mw => {
            const wa = mw.get_compositor_private();
            const isFocused = !ignoreFocus && mw === window;

            if (wa) {
                if (isFocused) {
                    mw['azTaskbarFocus'] = wa.get_parent().get_children().indexOf(wa);
                    wa.get_parent().set_child_above_sibling(wa, null);
                }

                if (isFocused && mw.minimized)
                    wa.show();


                this.animateWindowOpacity(mw, wa, isFocused ? 255 : dimOpacity, immediate);
            }
        });
    }

    _removeEndPeekDelay() {
        if (this._source.endPeekTimeoutId) {
            GLib.source_remove(this._source.endPeekTimeoutId);
            this._source.endPeekTimeoutId = null;
        }
    }

    _endPeekWithDelay() {
        this._removeEndPeekDelay();
        this._source.endPeekTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            this._endPeek();
            this._source.endPeekTimeoutId = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    _endPeek(stayHere) {
        if (this.workspaceSwitchId > 0) {
            GLib.source_remove(this.workspaceSwitchId);
            this.workspaceSwitchId = 0;
        }
        if (this._source.peekTimeoutId > 0) {
            GLib.source_remove(this._source.peekTimeoutId);
            this._source.peekTimeoutId = 0;
        }

        if (this._source.peekedWindow) {
            const immediate = !stayHere && this._source.peekInitialWorkspaceIndex !==
                              global.workspace_manager.get_active_workspace_index();

            this._restorePeekedWindowStack();
            this._focusMetaWindow(255, this._source.peekedWindow, immediate, true);
            this._source.peekedWindow = null;

            if (!stayHere)
                this._switchToWorkspaceImmediate(this._source.peekInitialWorkspaceIndex);

            this._source.peekInitialWorkspaceIndex = -1;
        }
    }

    _switchToWorkspaceImmediate(workspaceIndex) {
        let workspace = global.workspace_manager.get_workspace_by_index(workspaceIndex);
        const shouldAnimate = Main.wm._shouldAnimate;

        if (!workspace || (!workspace.list_windows().length &&
            workspaceIndex < global.workspace_manager.n_workspaces - 1))
            workspace = global.workspace_manager.get_active_workspace();


        Main.wm._shouldAnimate = () => false;
        workspace.activate(global.display.get_current_time_roundtrip());
        Main.wm._shouldAnimate = shouldAnimate;
    }

    _restorePeekedWindowStack() {
        const windowActor = this._source.peekedWindow
            ? this._source.peekedWindow.get_compositor_private() : null;

        if (windowActor) {
            if (this._source.peekedWindow.hasOwnProperty('azTaskbarFocus')) {
                windowActor.get_parent().set_child_at_index(windowActor,
                    this._source.peekedWindow['azTaskbarFocus']);
                delete this._source.peekedWindow['azTaskbarFocus'];
            }

            if (this._source.peekedWindow.minimized)
                windowActor.hide();
        }
    }

    animateWindowOpacity(metaWindow, windowActor, opacity, immediate) {
        windowActor = windowActor || metaWindow.get_compositor_private();

        if (windowActor) {
            let duration = 255;

            if (immediate && !metaWindow.is_on_all_workspaces())
                duration = 0;

            windowActor = windowActor.get_first_child() || windowActor;

            windowActor.ease({
                opacity,
                duration,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    _showCloseButton() {
        const easeParams = {
            opacity: 255,
            duration: Workspace.WINDOW_OVERLAY_FADE_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        };

        if (this._windowCanClose()) {
            this.closeButton.show();
            this.closeButton.remove_all_transitions();
            this.closeButton.ease(easeParams);
        } else {
            this.closeButton.hide();
        }

        const showMinimizeButton = TaskbarManager.settings.get_boolean('window-preview-show-minimize-button');
        if (showMinimizeButton && this._window.can_minimize() && !this._window.minimized) {
            this.minimizeButton.show();
            this.minimizeButton.remove_all_transitions();
            this.minimizeButton.ease(easeParams);
        } else {
            this.minimizeButton.hide();
        }
    }

    _hideCloseButton() {
        const easeParams = {
            opacity: 0,
            duration: Workspace.WINDOW_OVERLAY_FADE_TIME,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
        };

        this.closeButton.remove_all_transitions();
        this.closeButton.ease(easeParams);
        this.minimizeButton.remove_all_transitions();
        this.minimizeButton.ease(easeParams);
    }

    show(animate) {
        this.opacity = 0;

        const time = animate ? PREVIEW_ANIMATION_DURATION : 0;
        this.remove_all_transitions();
        this.ease({
            opacity: 255,
            duration: time,
            mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
        });
    }

    _animateOutAndDestroy() {
        this.remove_all_transitions();

        this.ease({
            opacity: 0,
            width: 0,
            height: 0,
            duration: PREVIEW_ANIMATION_DURATION,
            onComplete: () => {
                const section = this._section;
                this.destroy();
                section.redisplay();
            },
        });
    }

    activate() {
        const clickAction = TaskbarManager.settings.get_enum('window-preview-click-action');
        switch (clickAction) {
        case WindowPreviewClickAction.RAISE:
            Main.activateWindow(this._window);
            break;
        case WindowPreviewClickAction.RAISE_MINIMIZE: {
            if (this._window.minimized || !this._window.has_focus())
                Main.activateWindow(this._window);
            else
                this._window.minimize();
            break;
        }
        }

        this._section._getTopMenu().close();
    }

    _onDestroy() {
        this._removeEndPeekDelay();

        if (this._cloneTextureLater) {
            Utils.laterRemove(this._cloneTextureLater);
            delete this._cloneTextureLater;
        }

        if (this._windowAddedLater) {
            Utils.laterRemove(this._windowAddedLater);
            delete this._windowAddedLater;
        }

        if (this._windowAddedId > 0) {
            this._workspace.disconnect(this._windowAddedId);
            this._windowAddedId = 0;
        }

        if (this._destroyId > 0) {
            this._mutterWindow.disconnect(this._destroyId);
            this._destroyId = 0;
        }

        if (this._windowTitleId > 0) {
            this._window.disconnect(this._windowTitleId);
            this._windowTitleId = 0;
        }

        if (this.workspaceSwitchId > 0) {
            GLib.source_remove(this.workspaceSwitchId);
            this.workspaceSwitchId = 0;
        }

        this._window = null;
        this._app = null;
        this._source = null;
        this._section = null;
    }
});
