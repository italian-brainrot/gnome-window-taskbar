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

// 'no limit' for Clutter's min-/max-width properties, which refuse a negative value
// (and are a gfloat, so anything beyond 3.4e38 overflows and lands as Infinity)
const NO_LIMIT = 1e30;
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
        const title = this.metaWindow.get_title() || _('Untitled window');

        // The title is cut to length before the layout ever sees it: an unlimited
        // title makes the button enormous, and Clutter does not forgive a child
        // that asks for more than it can get - the whole shell goes down with it.
        // The preference is in characters, which is what a person counts.
        const max = this._settings.get_int('window-title-max-chars');
        if (max > 0) {
            const chars = [...title];
            if (chars.length > max) {
                this._label.text = `${chars.slice(0, max).join('')}…`;
                return;
            }
        }

        this._label.text = title;
    }

    /** The width the app icon asks for, or 0 when the icons are off. */
    _iconWidth() {
        const settings = this._settings;
        return settings.get_boolean('window-button-icons') ? settings.get_int('icon-size') : 0;
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

    /**
     * The width preference is a *maximum*: the button takes the title's own
     * width, capped there, and shrinks with the panel when the taskbar is full
     * (the title is then ellipsized at the end). 0 means no cap.
     *
     * What the label never gets is a minimum. Clutter aborts the whole shell when
     * a box child asks for more than it can get, and a title that has ellipsized
     * down to just the ellipsis has a natural width of some 17px, smaller than any
     * sensible minimum - the abort line was "natural width: 17 < minimum 24", and
     * it cost the session its login. So only max_width is set here, never < 0.
     *
     * @param {number=} widthCap - room per button, see WindowsList._shareRoom
     */
    updateStyle(widthCap = null, showLabels = null) {
        const settings = this._settings;

        this._icon.visible = settings.get_boolean('window-button-icons');
        this._icon.icon_size = settings.get_int('icon-size');

        // the list works out whether titles fit the room it shares out (see
        // _shareRoom), so that decision is handed down here
        this._label.visible = showLabels ?? settings.get_boolean('window-labels');

        const requested = widthCap ?? settings.get_int('window-button-width');
        // Clutter's min-/max-width properties take no negative value (setting -1
        // gets a GObject warning and nothing at all happens), so "no limit" is
        // done with the biggest float the property accepts.
        this._label.min_width = 0;
        this._label.max_width = NO_LIMIT;
        if (requested > 0) {
            // the floor is only ever a maximum (max_width), so it is safe
            this._label.max_width = Math.max(MIN_LABEL_WIDTH,
                requested - BUTTON_CHROME_WIDTH - this._iconWidth());
        }

        // the font size comes as a style; the width cap is the max_width property,
        // which is what keeps the button's width to the title's own (a CSS
        // max-width would fix the label's natural size, and uniform buttons are
        // not what was asked for)
        const fontSize = settings.get_int('window-label-font-size');
        this._label.style = fontSize > 0 ? `font-size: ${fontSize}px;` : '';

        this._indicator.setIndicatorLocation(settings.get_enum('indicator-location'));
        this._setIndicatorOrder();
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

        // Blank tail that eats whatever room the buttons do not use: the list
        // then always asks for the full width the panel can give it, so the
        // buttons stay where they are as windows come and go, and the panel's
        // symmetric box sizing keeps the status area in one piece. It is the
        // *last* child, and it stays that way (see redisplay), because the room
        // it eats up is meant to be after the buttons, not between them.
        this._spacer = new St.Widget({
            style_class: 'azTaskbar-window-list-spacer',
            y_align: Clutter.ActorAlign.FILL,
        });
        this.add_child(this._spacer);

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
        const styleKeys = ['window-labels', 'window-labels-auto-hide', 'window-button-icons',
            'window-button-width', 'window-label-font-size', 'icon-size', 'taskbar-spacing',
            'panel-location'];
        const layoutKeys = ['isolate-workspaces', 'isolate-monitors', 'panel-on-all-monitors'];
        // the title is cut before the layout sees it, so changing the length means
        // the titles are made again rather than merely styled
        const titleKeys = ['window-title-max-chars'];

        this._settings.connectObject('changed::show-running-apps', () => {
            this.visible = this._settings.get_boolean('show-running-apps');
        }, this);

        [...styleKeys, ...layoutKeys, ...titleKeys].forEach(key => {
            this._settings.connectObject(`changed::${key}`, () => {
                if (styleKeys.includes(key))
                    this._buttons.forEach(button => button.updateStyle());
                if (titleKeys.includes(key))
                    this._buttons.forEach(button => button.updateTitle());
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
        // the list is styled before it has a panel to sit in at session start,
        // and an actor with no stage has no theme node to write into (see
        // _isStaged): _placeInPanel styles again once the list is in the panel
        if (!this._isStaged())
            return;

        this.style = `spacing: ${this._settings.get_int('taskbar-spacing')}px;`;
    }

    queueRedisplay() {
        Utils.queueRefresh(this, '_refreshId', () => this.redisplay());
    }

    /**
     * The panel keeps its left and right boxes the same width (aztaskbar and
     * the shell both do it that way to keep the centre box centred), so a taskbar
     * in the left box only ever gets half the panel: titles get squeezed as soon
     * as there are many windows. The centre box is not capped that way, and it is
     * exactly the space between the favourites and the status area, so the window
     * list lives there - it may be as wide as twice the widest side box leaves over.
     */
    /**
     * The panel this actor sits in, or the one `via` sits in for as long as the
     * list has no parent of its own (works for the shell's panel and the fork's).
     */
    _panelAncestor(via = null) {
        let node = this.get_parent() ?? via;
        while (node && !(node._leftBox && node._centerBox && node._rightBox))
            node = node.get_parent();
        return node;
    }

    _naturalWidth(actor) {
        // an actor that is not on the stage yet (the list, before it is placed in
        // the panel) has no theme node to measure against, and Clutter shouts about
        // it - so the honest answer for that moment is 0
        if (!actor || actor.get_stage?.() === null)
            return 0;

        const sizes = actor.get_preferred_width?.(-1);
        return sizes ? Math.round(sizes[1]) : 0;
    }

    /**
     * Whether this list is inside a stage, i.e. inside a panel already.
     *
     * Writing a style to an actor that is not on the stage makes St shout
     * 'st_widget_get_theme_node called on the widget ... which is not in the
     * stage' for every write - the answer is a NULL node, so nothing breaks, but
     * it is this fork's name in the log at every session start. The style is
     * remembered anyway and applied when the actor does land on the stage, so
     * the guarded writes are made again from _placeInPanel, once there is a
     * panel to hold them.
     */
    _isStaged() {
        return this.get_stage() !== null;
    }

    _placeInPanel(via = null) {
        const centerBox = this._panelAncestor(via)?._centerBox;
        if (!centerBox || this.get_parent() === centerBox)
            return false;

        // add_child refuses a child that still has a parent (Clutter asserts and
        // silently does nothing), so the list is unparented first.
        const parent = this.get_parent();
        if (parent)
            parent.remove_child(this);

        centerBox.add_child(this);

        // the styling and the rooming were skipped while the list was off the
        // stage (see _isStaged); they are made here, where there is a panel
        // again to measure the room against and a stage to take a theme node
        // from. redisplay() ends with _shareRoom() anyway, and the fork's own
        // panel allocates the centre box from its natural width, so the list
        // that lands here has to say how wide it wants to be right away.
        this.updateStyle();
        this._shareRoom();

        return true;
    }

    /** See _placeInPanel: the width the centre box may take. */
    _roomWidth() {
        const panel = this._panelAncestor();
        const monitor = Main.layoutManager.findMonitorForActor(this) ??
            Main.layoutManager.primaryMonitor;
        if (!panel || !monitor)
            return -1;

        const side = Math.max(
            this._naturalWidth(panel._leftBox),
            this._naturalWidth(panel._rightBox));
        return Math.max(0, Math.floor(monitor.width - 2 * side));
    }

    /**
     * Share the room out over the buttons. The preference is still the maximum:
     * what each button may ask for is that preference, or the room divided by the
     * number of windows, whichever is smaller - and the leftover room goes to the
     * blank tail.
     */
    _shareRoom() {
        // no stage, no panel to take the room from, and no theme node to write
        // the spacer's width into (see _isStaged)
        if (!this._isStaged())
            return;

        const room = this._roomWidth();
        const count = this._buttons.size;
        const settings = this._settings;
        const preference = settings.get_int('window-button-width');

        let cap = preference;
        let each = NO_LIMIT;
        if (room >= 0 && count > 0) {
            each = Math.floor(room / count);
            cap = preference > 0 ? Math.min(preference, each) : each;
        }

        // A title is only worth its room if it can show a few characters: the
        // button's own padding, the icon and MIN_LABEL_WIDTH worth of title. Below
        // that the titles give way to icons on their own - that is what keeps a
        // taskbar full of windows from pushing the panel around.
        const needs = BUTTON_CHROME_WIDTH + this._buttonIconWidth() + MIN_LABEL_WIDTH;
        const fit = room < 0 || count === 0 || each >= needs;
        const showLabels = settings.get_boolean('window-labels') &&
            (fit || !settings.get_boolean('window-labels-auto-hide'));

        this._buttons.forEach(button => button.updateStyle(cap, showLabels));

        if (room < 0) {
            this._spacer.visible = false;
            this._spacer.style = '';
            return;
        }

        // the spacer's own request is part of the measured natural width, so it is
        // counted in what the list asks for; it gets a fixed width rather than a
        // minimum, because a child with a minimum and no natural size of its own is
        // exactly what Clutter refuses to fit in a box
        const withoutSpacer = this._naturalWidth(this) - this._naturalWidth(this._spacer);
        this._spacer.visible = true;
        this._spacer.style = `width: ${Math.max(0, room - withoutSpacer)}px;`;
    }

    /**
     * How many buttons the room the centre box has can hold, counting each button
     * at its smallest (icons only, no title). More buttons than that would ask the
     * panel for more than it has, and the favourites and the status area would be
     * carried off the monitor - so the list stops adding buttons there instead, and
     * the windows left over stay reachable through the overview.
     *
     * It is a count limit rather than a size limit on purpose: capping what the
     * list asks for below what its buttons must have is the one request Clutter
     * does not forgive ("natural width ... < minimum" aborts the whole shell).
     */
    _maxButtonCount() {
        const room = this._roomWidth();

        // no room computed means the list is not in the panel yet (at session
        // start, and again whenever the panel is rebuilt): nothing to cap then
        if (room < 0)
            return Number.MAX_SAFE_INTEGER;

        const smallest = BUTTON_CHROME_WIDTH + this._buttonIconWidth() +
            this._settings.get_int('taskbar-spacing');
        return Math.max(1, Math.floor(room / smallest));
    }

    _buttonIconWidth() {
        return this._settings.get_boolean('window-button-icons')
            ? this._settings.get_int('icon-size')
            : 0;
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
        this._placeInPanel();

        // the room decides how many buttons there may be (see _maxButtonCount);
        // the windows beyond that are the overview's business, not the taskbar's
        const windows = this.getWindows().slice(0, this._maxButtonCount());
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
                // A new button goes to the index it belongs at, not to the tail:
                // the tail is the blank spacer's place, and appending behind it
                // puts the unused room between the favourites and the button
                // until the next pass repairs the order. insert_child_at_index
                // does take an unattached child, and clamps an index past the
                // last child rather than refusing it.
                this.insert_child_at_index(button, index);
            } else if (this._indexOf(button) !== index) {
                // insert_child_at_index will not re-parent an attached child
                this.remove_child(button);
                this.insert_child_at_index(button, index);
            }
        });

        // ... and the spacer is the last of them: it is there to swallow the
        // room the buttons do not use, which is only after the buttons. It was
        // already there, so it is taken out and put back at the end rather than
        // inserted, because insert_child_at_index refuses a child that is still
        // attached; and appending is what add_child is for.
        if (this._indexOf(this._spacer) !== this.get_n_children() - 1) {
            this.remove_child(this._spacer);
            this.add_child(this._spacer);
        }

        this._syncStates();
        this._shareRoom();
    }

    /** Which child number this actor is, or -1 when it is not a child at all. */
    _indexOf(child) {
        return this.get_children().indexOf(child);
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
