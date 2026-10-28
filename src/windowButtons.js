// One button per open window: no app grouping, window titles shown.
//
// Part of the "Window Taskbar" fork of App Icons Taskbar (aztaskbar). Visuals come
// from aztaskbar's own stylesheet classes (panel-button + azTaskbar-BaseIcon) and
// the indicator dash is drawn with the same geometry as aztaskbar's
// AppIconIndicator, so the panel stays visually consistent.
//
// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: azaech (aztaskbar), Window Taskbar contributors

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {PanelLocation} from './extension.js';
import {IndicatorLocation} from './appIconIndicator.js';
import {TaskbarManager} from './taskbarManager.js';
import * as Utils from './utils.js';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

// Same shape as aztaskbar's running/focused indicator: a rounded dash.
const INDICATOR_RADIUS = 1.5;
const INDICATOR_HEIGHT = 8;
const DEGREES = Math.PI / 180;

// A window title that can be ellipsized from; the width preference subtracts
// the button's own chrome (padding, border, the icon and its spacing).
const MIN_LABEL_WIDTH = 24;
const BUTTON_CHROME_WIDTH = 24;

// Clutter.button-event button numbers; St.Button itself has no get_button().
const BUTTON_PRIMARY = 1;
const BUTTON_MIDDLE = 2;
const BUTTON_SECONDARY = 3;

const MINIMIZED_OPACITY = 140;

function colorToString(color) {
    if (!color)
        return null;
    return `rgba(${color.red}, ${color.green}, ${color.blue}, ${color.alpha})`;
}

function makeColor(rgba) {
    // GNOME 46 removed Clutter.Color / Clutter.color_from_string
    if (Clutter.Color && Clutter.color_from_string)
        return Clutter.color_from_string(rgba)[1] ?? null;
    return Cogl.Color.from_string(rgba)[1] ?? null;
}

const WindowIndicator = GObject.registerClass(
class WindowTaskbarIndicator extends St.DrawingArea {
    // A strip that shares the button's width and sits beside the content box in
    // the button's vertical layout: BOTTOM puts it under the title, TOP above it
    // (same as aztaskbar's indicator-location for the favourite icons).
    _init(button) {
        super._init({
            // St has no x_fill/y_fill; in the button's vertical layout the
            // FILL alignment is what makes the strip span the button.
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_expand: false,
            height: INDICATOR_HEIGHT,
        });
        this.set_offscreen_redirect(Clutter.OffscreenRedirect.ALWAYS);
        this._button = button;
    }

    setIndicatorLocation(location) {
        this._indicatorLocation = location;
        this.queue_repaint();
    }

    _colorForState() {
        const settings = TaskbarManager.settings;
        const themeContext = St.ThemeContext.get_for_stage(global.stage);
        const [accentColor, foregroundColor] = themeContext.get_accent_color
            ? themeContext.get_accent_color()
            : [null, null];
        const useAccent = settings.get_boolean('indicator-color-use-system-accent-color');

        // same pairing as aztaskbar: accent colour for the focused window,
        // the plain one for the rest.
        const focused = this._button._focused;
        let rgba = settings.get_string(focused ? 'indicator-color-focused' : 'indicator-color-running');
        if (useAccent) {
            const theme = focused ? themeContext.get_accent_color : null;
            rgba = colorToString(accentColor) ?? rgba;
        }
        return makeColor(rgba ?? 'transparent');
    }

    vfunc_repaint() {
        const settings = TaskbarManager.settings;
        const [areaWidth, areaHeight] = this.get_surface_size();
        if (areaWidth <= 0 || areaHeight <= 0)
            return;

        const color = this._colorForState();
        if (!color)
            return;

        const cr = this.get_context();
        const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const radius = INDICATOR_RADIUS * scaleFactor;

        // The focused window gets a longer dash than the others, like aztaskbar.
        const dashWidth = this._button._focused ? areaWidth / 4 : areaWidth / 10;
        if (dashWidth <= -radius)
            return;

        const location = settings.get_enum('indicator-location');
        const y = location === IndicatorLocation.TOP ? 0 : (areaHeight - (radius * 2)) / 2;

        if (Clutter.cairo_set_source_color)
            Clutter.cairo_set_source_color(cr, color);
        else
            cr.setSourceColor(color);

        cr.translate((areaWidth - dashWidth) / 2, y);
        cr.newSubPath();
        cr.arc(0, y + radius, radius, 90 * DEGREES, -90 * DEGREES);
        cr.arc(dashWidth, y + radius, radius, -90 * DEGREES, 90 * DEGREES);
        cr.closePath();
        cr.fill();
        cr.$dispose();
    }
});

const WindowButton = GObject.registerClass(
class WindowTaskbarButton extends St.Button {
    _init(metaWindow, windowsList) {
        super._init({
            style_class: 'panel-button azTaskbar-BaseIcon azTaskbar-window-button',
            can_focus: true,
            reactive: true,
            y_align: Clutter.ActorAlign.FILL,
            y_expand: true,
        });

        this.metaWindow = metaWindow;
        this._list = windowsList;
        this._settings = TaskbarManager.settings;
        this._tracker = Shell.WindowTracker.get_default();
        this._app = null;

        // St.BoxLayout has no y_fill: vertical fill comes from the child's
        // y_align/y_expand pair only.
        this._box = new St.BoxLayout({
            y_align: Clutter.ActorAlign.CENTER,
            y_expand: true,
        });

        this._icon = new St.Icon({
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'window-button-icon',
        });
        this._box.add_child(this._icon);

        this._label = new St.Label({
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.FILL,
            x_expand: true,
            style_class: 'window-button-label',
        });
        // END rather than MIDDLE: at the short widths a squeezed panel offers,
        // middle-ellipsize leaves something like 'qq@…: ~', which is noise.
        this._label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        this._label.clutter_text.set_single_line_mode(true);
        this._box.add_child(this._label);

        this._indicator = new WindowIndicator(this);

        // Vertical layout: the icon+title box, and the indicator strip next to
        // it, so the dash lands on the button's edge (bottom panel: bottom).
        this._root = new St.Widget({
            layout_manager: new Clutter.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
            }),
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
        });
        Utils.addChildToParent(this._root, this._box);
        Utils.addChildToParent(this._root, this._indicator);
        Utils.addChildToParent(this, this._root);
        this._setIndicatorOrder();

        this._menuManager = new PopupMenu.PopupMenuManager(this);
        this._signals = new Utils.SignalHandler();

        this.connect('clicked', () => this._onClick());
        this.connect('button-press-event', (actor, event) => {
            // aztaskbar opens its AppIcon menu on the press, and St.Button's
            // 'clicked' is not guaranteed to be emitted for the secondary
            // button, so the menu lives here. Other buttons are propagated to
            // St.Button's own click handling.
            if (event.get_button() === BUTTON_SECONDARY) {
                this._popupMenu();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this.connect('scroll-event', (actor, event) => this._onScroll(event));
        this.connect('destroy', () => this._onDestroy());

        this._watchWindow();
        this.updateStyle();
        this.updateTitle();
        this.updateIcon();
        this.syncState();
    }

    _watchWindow() {
        const window = this.metaWindow;
        const refresh = () => this.syncState();

        // Signal names verified against mutter 18 (GNOME Shell 50.6):
        // Meta.Window has 'focus', 'unmanaged', 'workspace-changed' and
        // notify:: on its GObject properties.
        this._signals.connect(window, 'notify::title', () => this.updateTitle());
        this._signals.connect(window, 'notify::minimized', refresh);
        this._signals.connect(window, 'notify::demands-attention', refresh);
        this._signals.connect(window, 'focus', refresh);
        this._signals.connect(window, 'unmanaged', () => this._list.removeWindow(window));
        this._signals.connect(window, 'workspace-changed', () => this._list.queueRedisplay());
    }

    get focused() {
        return this.metaWindow.has_focus();
    }

    get minimized() {
        return this.metaWindow.minimized;
    }

    getApp() {
        return this._tracker.get_window_app(this.metaWindow);
    }

    updateTitle() {
        this._label.text = this.metaWindow.get_title() || _('Untitled window');
    }

    updateIcon() {
        const app = this.getApp();
        this._app = app;

        if (app)
            this._icon.gicon = app.get_icon();
        else
            this._icon.set({gicon: null, icon_name: 'application-x-generic-symbolic'});
    }

    syncState() {
        if (this.focused)
            this.add_style_pseudo_class('active');
        else
            this.remove_style_pseudo_class('active');

        this.opacity = this.minimized ? MINIMIZED_OPACITY : 255;
        this._indicator.queue_repaint();
    }

    /** Move the indicator strip to the edge requested by indicator-location. */
    _setIndicatorOrder() {
        const top = TaskbarManager.settings.get_enum('indicator-location') === IndicatorLocation.TOP;
        this._root.remove_child(this._indicator);
        if (top)
            this._root.insert_child_at_index(this._indicator, 0);
        else
            this._root.add_child(this._indicator);
    }

    updateStyle() {
        const settings = this._settings;

        this._icon.visible = settings.get_boolean('window-button-icons');
        this._icon.icon_size = settings.get_int('icon-size');

        this._label.visible = settings.get_boolean('window-labels');

        // The width preference is a *maximum*: the button takes the title's own
        // width, capped there, and shrinks with the panel when the taskbar is
        // full (the title is ellipsized in the middle). 0 = no cap.
        //
        // Clutter aborts the *whole shell* when a child's minimum width is
        // bigger than its natural width ("ClutterBoxLayout child ... natural
        // width: 140 < minimum 220"), so this only ever touches max_width and
        // min_width, where min <= natural is what always holds.
        const requested = settings.get_int('window-button-width');
        this._label.min_width = MIN_LABEL_WIDTH;
        this._label.max_width = -1;
        if (requested > 0) {
            const iconWidth = settings.get_boolean('window-button-icons')
                ? settings.get_int('icon-size')
                : 0;
            this._label.max_width = Math.max(MIN_LABEL_WIDTH,
                requested - BUTTON_CHROME_WIDTH - iconWidth);
        }

        const fontSize = settings.get_int('window-label-font-size');
        this._label.style = fontSize > 0 ? `font-size: ${fontSize}px;` : '';

        this._indicator.setIndicatorLocation(settings.get_enum('indicator-location'));
        this._setIndicatorOrder();

        // Clutter aborts the shell outright when a container is asked to fit a
        // child whose minimum is bigger than its natural size, so the request
        // is dropped before it can reach the layout.
        const [minWidth, naturalWidth] = this.get_preferred_width(-1);
        if (minWidth > naturalWidth) {
            this._label.min_width = -1;
            this._label.max_width = -1;
            logWarning(`windowtaskbar: window-button-width ${requested} does not` +
                `fit (min ${minWidth} > natural ${naturalWidth}), dropping it`);
        }
    }

    _onClick() {
        const event = Clutter.get_current_event();
        const button = event ? event.get_button() : 0;
        const modifiers = event ? event.get_state() : 0;
        const shiftPressed = (modifiers & Clutter.ModifierType.SHIFT_MASK) !== 0;

        // St.Button has no get_button(), so the release event carries the
        // button number; a secondary press already opened the menu.
        if (button === BUTTON_SECONDARY) {
            this._popupMenu();
            return;
        }

        // Middle click, and shift+click, close the window.
        if (button === BUTTON_MIDDLE || shiftPressed) {
            this.metaWindow.delete(global.get_current_time());
            return;
        }

        Main.overview.hide();
        this._activate();
    }

    /** Clicking the focused, unminimized window minimizes it, otherwise it raises it. */
    _activate() {
        const window = this.metaWindow;

        if (window.minimized || !window.has_focus())
            Main.activateWindow(window);
        else
            window.minimize();
    }

    _onScroll(event) {
        let backwards = false;

        switch (event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP:
        case Clutter.ScrollDirection.LEFT:
            backwards = true;
            break;
        case Clutter.ScrollDirection.DOWN:
        case Clutter.ScrollDirection.RIGHT:
            backwards = false;
            break;
        default:
            return;
        }

        this._list.cycleWindows(backwards);
    }

    _menuSide() {
        const location = TaskbarManager.settings.get_enum('panel-location');
        return location === PanelLocation.BOTTOM ? St.Side.BOTTOM : St.Side.TOP;
    }

    _popupMenu() {
        if (this._menu) {
            this._menu.toggle();
            return;
        }

        const window = this.metaWindow;
        this._menu = new PopupMenu.PopupMenu(this, 0.5, this._menuSide());

        const minimizeItem = new PopupMenu.PopupMenuItem(_('Minimize'));
        minimizeItem.connect('activate', () => window.minimize());
        this._menu.addMenuItem(minimizeItem);

        const maximizeItem = new PopupMenu.PopupMenuItem(_('Maximize'));
        maximizeItem.connect('activate', () => {
            const flags = Meta.MaximizeFlags.HORIZONTAL | Meta.MaximizeFlags.VERTICAL;
            if (window.is_maximized())
                window.unmaximize(flags);
            else
                window.maximize(flags);
        });
        this._menu.addMenuItem(maximizeItem);

        const keepAboveItem = new PopupMenu.PopupMenuItem(_('Keep above other windows'));
        keepAboveItem.connect('activate', () => {
            if (window.is_above())
                window.unmake_above();
            else
                window.make_above();
        });
        this._menu.addMenuItem(keepAboveItem);

        const toWorkspaceItem = new PopupMenu.PopupMenuItem(_('Move to this workspace'));
        toWorkspaceItem.connect('activate', () => {
            window.change_workspace(global.workspace_manager.get_active_workspace());
        });
        this._menu.addMenuItem(toWorkspaceItem);

        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const closeItem = new PopupMenu.PopupMenuItem(_('Close'));
        closeItem.connect('activate', () => window.delete(global.get_current_time()));
        this._menu.addMenuItem(closeItem);

        this._menuManager.addMenu(this._menu);
        this._menu.open(global.get_current_time());
        this._menuManager.ignoreRelease?.();
    }

    _onDestroy() {
        this._signals.destroy();
        this._menu?.destroy();
        this._menu = null;
    }
});

/**
 * The ungrouped window list. It is inserted into aztaskbar's mainBox right after
 * the favourite AppIcons: favourites stay aztaskbar's own AppIcons (look, drag &
 * drop, hover previews), while every window gets its own button.
 */
export const WindowsList = GObject.registerClass(
class WindowTaskbarWindowsList extends St.BoxLayout {
    _init(monitor) {
        super._init({
            style_class: 'azTaskbar-window-list',
            y_align: Clutter.ActorAlign.FILL,
            y_expand: true,
        });

        this._monitor = monitor;
        this._settings = TaskbarManager.settings;
        this._buttons = new Map();

        // (refreshes are queued by queueRedisplay, on the fork's own timer)

        this.connect('destroy', () => this._destroy());

        this._setSettingsConnections();
        this._setShellSignals();
        this.updateStyle();

        this.visible = this._settings.get_boolean('show-running-apps');

        // ... and the windows that were already open before this list existed
        this.queueRedisplay();
    }

    _setSettingsConnections() {
        const styleKeys = ['window-labels', 'window-button-icons', 'window-button-width',
            'window-label-font-size', 'icon-size', 'taskbar-spacing', 'panel-location'];
        const layoutKeys = ['isolate-workspaces', 'isolate-monitors', 'panel-on-all-monitors'];

        this._settings.connectObject('changed::show-running-apps', () => {
            this.visible = this._settings.get_boolean('show-running-apps');
        }, this);

        [...styleKeys, ...layoutKeys].forEach(key => {
            this._settings.connectObject(`changed::${key}`, () => {
                if (styleKeys.includes(key))
                    this._buttons.forEach(button => button.updateStyle());
                this.queueRedisplay();
            }, this);
        });
    }

    _setShellSignals() {
        // 'window-created' can fire before the window actor exists, so the
        // rebuild is deferred and 'restacked' catches the rest.
        global.display.connectObject('window-created', () => this.queueRedisplay(), this);
        global.display.connectObject('restacked', () => this.queueRedisplay(), this);
        global.display.connectObject('notify::focus-window', () => this._syncStates(), this);
        global.display.connectObject('window-entered-monitor', () => this.queueRedisplay(), this);
        global.display.connectObject('window-left-monitor', () => this.queueRedisplay(), this);
        global.window_manager.connectObject('switch-workspace', () => this.queueRedisplay(), this);
        Shell.AppSystem.get_default().connectObject('app-state-changed', () => {
            this._buttons.forEach(button => {
                if (button._app !== button.getApp())
                    button.updateIcon();
            });
            this.queueRedisplay();
        }, this);
    }

    updateStyle() {
        this.style = `spacing: ${this._settings.get_int('taskbar-spacing')}px;`;
    }

    queueRedisplay() {
        Utils.queueRefresh(this, '_refreshId', () => this.redisplay());
    }

    /** Windows belonging on this monitor's taskbar, in creation order. */
    getWindows() {
        const windows = global.get_window_actors().map(actor => actor.metaWindow);

        return Utils.getInterestingWindows(this._settings, windows, this._monitor.index)
            .sort((a, b) => a.get_stable_sequence() - b.get_stable_sequence());
    }

    _syncStates() {
        this._buttons.forEach(button => button.syncState());
    }

    removeWindow(metaWindow) {
        const button = this._buttons.get(metaWindow);
        if (!button)
            return;

        this._buttons.delete(metaWindow);
        button.destroy();
    }

    redisplay() {
        const windows = this.getWindows();
        const visible = new Set(windows);

        for (const window of this._buttons.keys()) {
            if (!visible.has(window))
                this.removeWindow(window);
        }

        windows.forEach((window, index) => {
            let button = this._buttons.get(window);

            if (!button) {
                button = new WindowButton(window, this);
                this._buttons.set(window, button);
            }

            if (button.get_parent() !== this) {
                this.add_child(button);
            } else if (this.get_children().indexOf(button) !== index) {
                // insert_child_at_index will not re-parent an attached child
                this.remove_child(button);
                this.insert_child_at_index(button, index);
            }
        });

        this._syncStates();
    }

    /** Scroll wheel over a window button cycles through the windows. */
    cycleWindows(backwards) {
        const windows = this.getWindows();
        if (windows.length < 2)
            return;

        const focused = global.display.get_focus_window();
        const index = windows.indexOf(focused);

        if (index < 0) {
            Main.activateWindow(windows[0]);
            return;
        }

        const step = backwards ? -1 : 1;
        Main.activateWindow(windows[(index + step + windows.length) % windows.length]);
    }

    _destroy() {
        Utils.cancelRefresh(this, '_refreshId');
        this._settings.disconnectObject(this);
        global.display.disconnectObject(this);
        global.window_manager.disconnectObject(this);
        Shell.AppSystem.get_default().disconnectObject(this);

        for (const button of this._buttons.values())
            button.destroy();
        this._buttons.clear();
    }
});
