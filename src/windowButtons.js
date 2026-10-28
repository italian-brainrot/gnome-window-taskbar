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

import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
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

// A strip shorter than the two rounded ends of the dash is not a dash any more:
// vfunc_repaint draws arcs of this radius, so this is the floor below which the
// strip is hidden instead of squeezed (see WindowButton._fitVertical).
const INDICATOR_MIN_HEIGHT = INDICATOR_RADIUS * 2;

// A window title that can be ellipsized from; the width preference subtracts
// the button's own chrome (padding, border, the icon and its spacing).
const MIN_LABEL_WIDTH = 24;

// What a button's theme spends around its content, for the moments there is no
// theme node to read it from: before the list is on the stage, and for a button
// that has just been created. The real number is measured (themeChrome());
// guessing it is what lets the row ask the panel for more than it has, because
// the width preference is spent on the title while the padding and the border
// come on top of it. On this shell the honest figure is 22px - the fork's own
// .azTaskbar-BaseIcon padding of 8px per side plus the 3px border that
// '#panel .panel-button' (an id selector, so it outranks our class) puts on
// every panel button.
const BUTTON_CHROME_WIDTH = 24;

// The same for the height. The window button carries no vertical padding or
// margin (stylesheet.css), so what the theme spends around it vertically is the
// 3px border that '#panel .panel-button' puts on every panel button, per side.
const BUTTON_CHROME_HEIGHT = 6;

// The same for the window list itself: its padding and the border that draws the
// separator line in front of the buttons (see .azTaskbar-window-list in
// stylesheet.css), again only for the pass with no theme node to read.
const BUTTON_ROW_WIDTH = 9;

// How long the press has to be held before a window button comes loose from the
// row and becomes a drag. The same threshold the favourite AppIcons use
// (appIcon.js), so a click stays a click on either kind of button.
const DRAG_TIMEOUT = 200;

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
    //
    // On a window button it is only ever shown once the titles have given way
    // (WindowButton._showsIndicator): a titled button wears no dash.
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

// One button per open window; exported so the favourites' drop handling can tell
// a window button apart from an AppIcon (a window is not a thing to favourite).
export const WindowButton = GObject.registerClass(
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
        // whether the window is on its way out (see _watchWindow, _menuItem)
        this._windowGone = false;

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

        // Drag the button along the row to reorder the taskbar, exactly as the
        // favourite icons are reordered. DND asks the actor's _delegate for the
        // drag actor and the drop target answers as the list itself (see
        // WindowsList.handleDragOver), so both delegates are set here and there.
        this._delegate = this;
        this._draggable = DND.makeDraggable(this, {timeoutThreshold: DRAG_TIMEOUT});
        this._draggable.connectObject(
            'drag-begin', () => this._onDragBegin(),
            'drag-end', () => this._onDragEnd(),
            this);

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
        // Meta.Window has 'focus', 'unmanaged', 'unmanaging', 'workspace-changed'
        // and notify:: on its GObject properties.
        this._signals.connect(window, 'notify::title', () => this.updateTitle());
        this._signals.connect(window, 'notify::minimized', refresh);
        this._signals.connect(window, 'notify::demands-attention', refresh);
        this._signals.connect(window, 'focus', refresh);
        this._signals.connect(window, 'workspace-changed', () => this._list.queueRedisplay());
        this._signals.connect(window, 'unmanaging', () => this._windowIsLeaving());
        this._signals.connect(window, 'unmanaged', () => this._list.removeWindow(window));
    }

    /**
     * The window is gone. Nothing may be asked of it any more: 'unmanaging'
     * fires while it is still usable, and mutter does not answer politely for a
     * window that is not managed - the button is only destroyed one signal later
     * ('unmanaged'), and anything that fires in between, in particular an item
     * of the window menu the user left open, still holds this window.
     */
    _windowIsLeaving() {
        this._windowGone = true;
        this._menu?.close();
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

    /**
     * What the theme spends around the button's content: its horizontal padding
     * and border. Read off the theme node, because that is what the panel has to
     * lay out - the width preference buys the title, and everything the theme
     * takes for itself is asked for on top of it.
     *
     * An actor that is not on the stage has no theme node (and St shouts about
     * the question), so the constant is the answer for that moment.
     */
    themeChrome() {
        if (this.get_stage() === null)
            return BUTTON_CHROME_WIDTH;

        const node = this.get_theme_node();
        if (!node)
            return BUTTON_CHROME_WIDTH;

        const chrome = [St.Side.LEFT, St.Side.RIGHT].reduce(
            (sum, side) => sum + node.get_padding(side) + node.get_border_width(side), 0);
        return Math.round(chrome);
    }

    /**
     * The same, for the height: what the theme spends above and below the
     * button's content - padding, border and margin, per side. It is what the
     * panel has to fit the button into, and it is what the panel's height has to
     * be measured against (see _fitVertical).
     */
    themeChromeHeight() {
        if (this.get_stage() === null)
            return BUTTON_CHROME_HEIGHT;

        const node = this.get_theme_node();
        if (!node)
            return BUTTON_CHROME_HEIGHT;

        const chrome = [St.Side.TOP, St.Side.BOTTOM].reduce((sum, side) =>
            sum + node.get_padding(side) + node.get_border_width(side) + node.get_margin(side), 0);
        return Math.round(chrome);
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

    /**
     * Whether this button wears the running/focused dash at all.
     *
     * Not while it shows a title. The dash answers "is this application running?",
     * and a button that names a window cannot answer anything but yes: the button
     * exists because the window is open. What it does cost is a strip of the
     * panel's height out of the band the title's line shares (see _fitVertical),
     * which is where the title came to sit above the middle of the panel rather
     * than on it.
     *
     * The favourites keep theirs - there the question is a real one - and so do
     * the window buttons once the titles have given way to icons
     * (window-labels-auto-hide), where a button looks like a favourite again and
     * the dash is the one thing left that says which window is focused.
     */
    _showsIndicator() {
        return !this._label.visible;
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
     * What the label never gets is a minimum, and `min_width = 0` is the part of
     * this that is real on Clutter 18: it takes the floor out, so the panel is
     * never handed a child it cannot fit. Clutter aborts the whole shell when a
     * box child asks for more than it can get, and a title that has ellipsized
     * down to just the ellipsis has a natural width of some 17px, smaller than any
     * sensible minimum - the abort line was "natural width: 17 < minimum 24", and
     * it cost the session its login.
     *
     * The cap itself is written as `max_width`, and on this Clutter that is
     * nothing at all: the property is gone and GJS puts the number on the JS
     * wrapper rather than on the actor (HACKING.md, "API notes"). The row is kept
     * inside the panel by measuring it and by the label's ellipsization instead
     * (see WindowsList._shareRoom); the assignment stays as the honest spelling of
     * the preference, not as the thing that works.
     *
     * @param {number=} widthCap - room per button, see WindowsList._shareRoom
     * @param {number=} bandHeight - the panel's height, see _fitVertical
     */
    updateStyle(widthCap = null, showLabels = null, bandHeight = null) {
        const settings = this._settings;

        this._icon.visible = settings.get_boolean('window-button-icons');
        this._icon.icon_size = settings.get_int('icon-size');

        // the list works out whether titles fit the room it shares out (see
        // _shareRoom), so that decision is handed down here
        this._label.visible = showLabels ?? settings.get_boolean('window-labels');

        const requested = widthCap ?? settings.get_int('window-button-width');
        // min_width is real, and 0 is the whole point of it (see the note above);
        // max_width is the preference's own spelling and inert on this Clutter.
        this._label.min_width = 0;
        this._label.max_width = NO_LIMIT;
        if (requested > 0) {
            // the floor is only ever a maximum (max_width), so it is safe
            this._label.max_width = Math.max(MIN_LABEL_WIDTH,
                requested - this.themeChrome() - this._iconWidth());
        }

        // the font size comes as a style; the width cap is the max_width property,
        // which is what keeps the button's width to the title's own (a CSS
        // max-width would fix the label's natural size, and uniform buttons are
        // not what was asked for) - except that this Clutter has no such property,
        // so the row's width is decided by _shareRoom measuring it instead
        const fontSize = settings.get_int('window-label-font-size');
        this._label.style = fontSize > 0 ? `font-size: ${fontSize}px;` : '';

        this._indicator.setIndicatorLocation(settings.get_enum('indicator-location'));
        this._setIndicatorOrder();
        // The dash goes on or off here rather than in _fitVertical, because that
        // pass returns early until the panel has been measured, and a titled
        // button would wear its dash for the moment before the first measurement.
        this._indicator.visible = this._showsIndicator();
        this._fitVertical(bandHeight);
    }

    /**
     * Fit the button's content into the height the panel has.
     *
     * A box layout does not shrink a child below its *minimum*: when the minimum
     * is more than the box has, it hands over the larger number, and the child is
     * not clipped to the panel - it hangs off the bottom of it, which for a bottom
     * panel means off the screen. That is what a title does: the line of text, the
     * indicator strip and the theme's padding, border and margin around them come
     * to more than the panel's height (18 + 8 + 6 + 6 + 4 = 42 px against the ~30 px
     * band the theme's `#panel {height: 2.2em}` leaves, see HACKING.md), so the button
     * sat below the band: its dash was drawn under the edge of the screen, and the rows
     * of the band the button no longer covered were presses on the panel rather than
     * presses on the button - and GNOME 50's panel answers a press on itself by starting
     * a window move, which swallows the click. So the height is budgeted here rather
     * than left to the theme: the row of icon and title keeps its line, the indicator
     * strip takes what that leaves of the band, and the button's *minimum* stays under
     * the band - which is what makes the box hand it the band and no more.
     *
     * A titled button has no strip to budget in the first place (see
     * _showsIndicator), and this pass is then only the floor: the row gets the band
     * to itself and is centered in it. What is left to budget is the icon-only
     * button - the row of one icon, and the dash under it.
     *
     * Clutter 18 has no max-height property (see HACKING.md), and a natural size
     * below the minimum is the request that aborts the shell, so nothing is ever
     * capped here: the row's minimum is put on the floor (min-height *is* the
     * request in this Clutter, so 0 means the box may give the row less than the
     * text asks for), and the strip is the part that gives way - down to being
     * hidden, since an invisible child asks for nothing.
     *
     * @param {number=} bandHeight - see WindowsList._bandHeight
     */
    _fitVertical(bandHeight = null) {
        // no stage, no panel measured yet: leave the requests as they came
        const band = bandHeight ?? this._list._bandHeight();
        if (band <= 0 || this.get_stage() === null)
            return;

        // the floor goes out of the row: if the panel is shorter than a line of
        // text, the text is what is cut, not the button's place in the panel
        this._label.min_height = 0;
        this._icon.min_height = 0;

        // No strip to fit on a titled button, and nothing to size: the row of
        // icon and title has the band to itself (an invisible child is left out
        // of the box's request *and* of its allocation), the row's y_expand is
        // what makes it span that band, and the CENTER alignment the icon and the
        // title are laid out with is what puts the title on the middle line of it
        // - Clutter applies an actor's own alignment to the allocation its parent
        // hands it, and the label's natural height is a single line of text, so
        // the whole band is what it is centered against once the strip is gone.
        if (!this._showsIndicator()) {
            this._indicator.visible = false;
            this._indicator.height = INDICATOR_HEIGHT;
            return;
        }

        // what the button's content may use, the theme's chrome paid for
        const room = Math.max(0, band - this.themeChromeHeight());

        // the row the icon and the title make: an invisible child asks for
        // nothing, so this is the icon's line once the titles have given way
        const [, rowNatural] = this._box.get_preferred_height(-1);
        const rowHeight = Math.round(rowNatural);

        const left = room - Math.min(rowHeight, room);
        if (left >= INDICATOR_MIN_HEIGHT) {
            this._indicator.visible = true;
            this._indicator.height = Math.min(INDICATOR_HEIGHT, left);
        } else {
            // no room for a dash at all: the strip goes, and with it its request
            this._indicator.visible = false;
            this._indicator.height = INDICATOR_HEIGHT;
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
            if (!this._windowGone)
                this.metaWindow.delete(global.get_current_time());
            return;
        }

        Main.overview.hide();
        this._activate();
    }

    /** Clicking the focused, unminimized window minimizes it, otherwise it raises it. */
    _activate() {
        const window = this.metaWindow;

        if (this._windowGone)
            return;

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

    /**
     * The actor that follows the pointer during a drag: a copy of the button, so
     * a window drags as the titled thing it is (a favourite drags as its icon,
     * for the same reason - see AppIcon.getDragActor).
     *
     * The button itself stays in the row: DND takes the source out of its parent
     * only when there is no drag actor to show in its place, and the live
     * reordering in WindowsList.handleDragOver needs it there.
     */
    getDragActor() {
        const clone = new Clutter.Clone({source: this});

        // DND measures the drag actor as soon as it is picked up, before the stage
        // has laid it out - and an actor with neither an allocation nor a size
        // request answers -1. The button's own box is the honest size for a copy
        // of it.
        clone.set_size(this.get_width(), this.get_height());
        return clone;
    }

    getDragActorSource() {
        return this;
    }

    /**
     * The button is loose. The list is told, because the signals a drag sets off
     * (a window raised, a window closed, the room moving) would otherwise rebuild
     * the row under the pointer and put every button back where it was (see
     * WindowsList._dragStarted).
     */
    _onDragBegin() {
        this._menu?.close();
        this._list._dragStarted(this);
    }

    /**
     * The drag is over, however it ended - accepted, refused, or cancelled with
     * Escape. The order was committed on the drop only (see acceptDrop), so a
     * cancelled drag has nothing to undo: the redisplay that is queued here puts
     * every button back at the index its stored order gives it.
     */
    _onDragEnd() {
        this._list._dragEnded();
    }

    _menuSide() {
        const location = TaskbarManager.settings.get_enum('panel-location');
        return location === PanelLocation.BOTTOM ? St.Side.BOTTOM : St.Side.TOP;
    }

    /**
     * A menu item that hands the window to its action, and does nothing at all
     * when the window is on its way out - the menu can be open while the window
     * closes itself, or while its application closes it, and the item still
     * fires. See _windowIsLeaving().
     */
    _menuItem(label, action) {
        const item = new PopupMenu.PopupMenuItem(label);
        item.connect('activate', () => {
            if (this._windowGone)
                return;
            action(this.metaWindow);
        });
        this._menu.addMenuItem(item);
    }

    _popupMenu() {
        if (this._menu) {
            this._menu.toggle();
            return;
        }

        this._menu = new PopupMenu.PopupMenu(this, 0.5, this._menuSide());

        this._menuItem(_('Minimize'), window => window.minimize());

        this._menuItem(_('Maximize'), window => {
            const flags = Meta.MaximizeFlags.HORIZONTAL | Meta.MaximizeFlags.VERTICAL;
            if (window.is_maximized())
                window.unmaximize(flags);
            else
                window.maximize(flags);
        });

        this._menuItem(_('Keep above other windows'), window => {
            if (window.is_above())
                window.unmake_above();
            else
                window.make_above();
        });

        this._menuItem(_('Move to this workspace'), window => {
            window.change_workspace(global.workspace_manager.get_active_workspace());
        });

        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._menuItem(_('Close'), window => window.delete(global.get_current_time()));

        this._menuManager.addMenu(this._menu);
        this._menu.open(global.get_current_time());
        this._menuManager.ignoreRelease?.();
    }

    _onDestroy() {
        this._signals.destroy();
        this._menu?.destroy();
        this._menu = null;
        this._draggable?.disconnectObject(this);
        this._draggable = null;

        // A button that went away mid-drag (its window closed under it) must not
        // leave the list refusing to rebuild itself. No redisplay is queued from
        // here: this is on the teardown path, and the list's own teardown destroys
        // every button (HACKING.md, "Tearing down").
        if (this._list._draggedButton === this)
            this._list._draggedButton = null;
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
        /**
         * The order of the row, as the user left it: windows in the place a drag
         * put them, and empty until somebody drags one (see _compareWindows and
         * acceptDrop). Windows are the key, as they are for _buttons - the same
         * Meta.Window wrapper comes back from global.get_window_actors() for the
         * life of a window, which is what the _buttons map already relies on.
         */
        this._order = [];
        // the button currently loose in the row, and the reason redisplay waits
        this._draggedButton = null;
        // set once _destroy() has begun: DND can still come asking afterwards
        this._tornDown = false;
        // the panel this list sits in, and the room it had when the buttons were
        // last sized (see _watchPanelRoom)
        this._panel = null;
        this._measuredRoom = -1;

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

        // The drop target for a drag along the row. DND asks the _delegate of the
        // actor under the pointer and then walks up the parents, and the buttons
        // are drag *sources* only (see WindowButton): the row is what takes a
        // window back.
        this._delegate = this;

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
            'panel-location', 'main-panel-height'];
        const layoutKeys = ['isolate-workspaces', 'isolate-monitors', 'panel-on-all-monitors'];
        // the title is cut before the layout sees it, so changing the length means
        // the titles are made again rather than merely styled
        const titleKeys = ['window-title-max-chars'];

        this._settings.connectObject('changed::show-running-apps', () => {
            this.visible = this._settings.get_boolean('show-running-apps');
        }, this);

        [...styleKeys, ...layoutKeys, ...titleKeys].forEach(key => {
            this._settings.connectObject(`changed::${key}`, () => {
                // A setting is not styled here: the buttons get their style from
                // the same pass that works the room out (_shareRoom), and styling
                // them first would hand the panel a row of uncapped buttons for a
                // moment - long enough to shove the status area off the monitor.
                if (styleKeys.includes(key))
                    this.updateStyle();
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
        const panel = this._panelAncestor(via);
        const centerBox = panel?._centerBox;

        if (!centerBox)
            return false;

        const placed = this.get_parent() === centerBox;

        if (!placed) {
            // add_child refuses a child that still has a parent (Clutter asserts
            // and silently does nothing), so the list is unparented first.
            const parent = this.get_parent();
            if (parent)
                parent.remove_child(this);

            centerBox.add_child(this);
        }

        if (placed && panel === this._panel)
            return false;

        this._panel = panel;
        this._watchPanelRoom(panel);

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

    /**
     * Watch the boxes that decide how much room there is.
     *
     * The room is what the panel's side boxes are not using, and they change on
     * their own account: the clock's text gets longer, the message indicator
     * counts something, another extension's tray icons arrive. None of that is a
     * window event, so nothing would re-share the room, and a row sized to the
     * room of five minutes ago is then sized to more than there is - which is the
     * panel pushing its own status area off the monitor. A relayout of a side box
     * is the notice that the room may have moved, and the room is measured before
     * asking for a pass, so the relayout a pass of our own causes does not feed
     * the loop.
     */
    _watchPanelRoom(panel) {
        this._roomSignals?.destroy();
        this._roomSignals = new Utils.SignalHandler();

        for (const box of [panel._leftBox, panel._rightBox]) {
            this._roomSignals.connect(box, 'queue-relayout', () => {
                if (this._roomWidth() !== this._measuredRoom)
                    this.queueRedisplay();
            });
        }
    }

    /**
     * See _placeInPanel: the width the centre box may take.
     *
     * Asking the panel that does the allocating is the point: there are two
     * panels and they allocate differently. The shell's own (the primary monitor,
     * where the fork does not build a panel) keeps the left and right boxes the
     * same width so that the centre box stays centred, and the fork's own panel
     * (panel.js, every other monitor) hands the room one side does not use to the
     * side that does. Guessing the symmetric formula on the asymmetric panel
     * sizes the list to something other than what it is given, and the panel then
     * clips the favourites instead of the titles, because it hands a side box less
     * than that box insists on keeping.
     */
    _roomWidth() {
        const panel = this._panelAncestor();
        const monitor = Main.layoutManager.findMonitorForActor(this) ??
            Main.layoutManager.primaryMonitor;
        if (!panel || !monitor)
            return -1;

        // A CSS margin is not part of what the actor reports as its own width: the
        // box that holds the list puts it *around* the request, so the room the
        // list may fill is that much smaller.
        const margin = this._marginWidth();

        if (panel.centerBoxRoom)
            return Math.max(0, panel.centerBoxRoom(this) - margin);

        const side = Math.max(
            this._naturalWidth(panel._leftBox),
            this._naturalWidth(panel._rightBox));
        return Math.max(0, Math.floor(monitor.width - 2 * side) - margin);
    }

    /** The horizontal CSS margin around the list itself, from the theme. */
    _marginWidth() {
        if (!this._isStaged())
            return 0;

        const node = this.get_theme_node();
        if (!node)
            return 0;

        return Math.round(
            node.get_margin(St.Side.LEFT) + node.get_margin(St.Side.RIGHT));
    }

    /**
     * The height of the band the buttons live in: the panel's own height, read off
     * the panel that does the allocating. Not the `main-panel-height` preference:
     * the fork writes that as a class (`.azTaskbar-panel`) and the theme's
     * `#panel {height: 2.2em}` is an id selector, so the theme's height is what the
     * panel actually gets (HACKING.md, "The panel's height"). The buttons have to
     * fit into it - it is the vertical counterpart of _roomWidth(), and it is asked
     * of the panel for the same reason: the allocation, not the setting.
     *
     * An actor that has never been allocated answers with its natural request, so
     * the answer is honest before the first layout pass too; 0 means there is no
     * panel to measure against.
     */
    _bandHeight() {
        const panel = this._panelAncestor();
        const height = panel ? Math.round(panel.height) : 0;
        return height > 0 ? height : 0;
    }

    /**
     * What the row costs apart from its buttons: the list's own padding and
     * border (the separator line in front of the buttons is one of them), plus
     * the spacing between the children. Read from the theme node, because it all
     * comes out of the room the panel has: the width preference buys the title and
     * the theme takes the rest.
     *
     * ClutterBoxLayout leaves an invisible child and the gap after it out of its
     * request, so the number of children here is the number that are shown - the
     * blank tail counted with them.
     */
    _rowPaddingBorder() {
        const node = this._isStaged() ? this.get_theme_node() : null;
        if (!node)
            return BUTTON_ROW_WIDTH;

        return Math.round([St.Side.LEFT, St.Side.RIGHT].reduce(
            (sum, side) => sum + node.get_padding(side) + node.get_border_width(side), 0));
    }

    _rowChrome(children) {
        const spacing = this._settings.get_int('taskbar-spacing');
        return this._rowPaddingBorder() + spacing * Math.max(0, children - 1);
    }

    /** What the first `count` buttons ask for, gaps and the row's own chrome included. */
    _rowWidth(buttons, count) {
        const width = buttons.slice(0, count)
            .reduce((sum, button) => sum + this._naturalWidth(button), 0);
        return width + this._rowChrome(count + 1);
    }

    /**
     * The longest row, from the front, that the room holds at the widths the
     * buttons are actually asking for. Everything past it is hidden rather than
     * squeezed: an invisible child asks for nothing, so the row can never leave
     * the panel with a minimum it cannot honour, and the windows behind it stay
     * reachable through the overview, as they are beyond _maxButtonCount.
     */
    _fitsCount(buttons, room) {
        const spacing = this._settings.get_int('taskbar-spacing');
        let used = this._rowPaddingBorder();
        let count = 0;

        for (const button of buttons) {
            // every button brings its own width and the gap after it; the blank
            // tail then fills whatever is left
            const width = this._naturalWidth(button);
            if (used + width + spacing * (count + 1) > room)
                break;

            used += width;
            count++;
        }

        return Math.max(1, count);
    }

    /**
     * Share the room out over the buttons, and stop when they no longer ask the
     * panel for more than it has.
     *
     * The preference is still the maximum: what each button may ask for is that
     * preference, or what is left of the room once the row's own cost is paid,
     * divided by the number of buttons, whichever is smaller. Whether that is
     * enough is not something the constants can answer - a button is its title, up
     * to the cap, plus the icon, plus whatever padding and border the theme puts
     * around them - so the row is styled, measured, and the decision made again on
     * the measurement:
     *
     *   1. the titles give way to icons (window-labels-auto-hide), and
     *   2. if a row of icons does not fit either, it stops at the last button the
     *      room holds.
     *
     * Both levers take requests away, and that direction is the safe one: a child
     * insisting on a minimum the box cannot give is the request Clutter answers by
     * aborting the shell (see "Size requests" in HACKING.md).
     */
    _shareRoom() {
        // no stage, no panel to take the room from, and no theme node to measure
        // against or to write the spacer's width into (see _isStaged)
        if (!this._isStaged())
            return;

        const room = this._roomWidth();
        this._measuredRoom = room;
        const band = this._bandHeight();

        // the buttons in the order the row lays them out, so that giving up on a
        // button means giving up on the last one of the row, not on the last one
        // the map happens to hold
        const buttons = this.get_children().filter(child => child !== this._spacer);
        const settings = this._settings;
        const preference = settings.get_int('window-button-width');

        if (room < 0 || buttons.length === 0) {
            this._spacer.visible = false;
            this._spacer.style = '';
            return;
        }

        // icons only are an alternative to titles only when there are icons to
        // show instead of them
        const givesWay = settings.get_boolean('window-labels-auto-hide') &&
            settings.get_boolean('window-button-icons');

        let showLabels = settings.get_boolean('window-labels');
        let shown = buttons.length;

        for (;;) {
            const each = Math.floor(Math.max(0, room - this._rowChrome(shown + 1)) / shown);
            const cap = preference > 0 ? Math.min(preference, each) : each;

            buttons.forEach((button, index) => {
                const visible = index < shown;
                if (button.visible !== visible)
                    button.visible = visible;
                button.updateStyle(cap, showLabels && visible, band);
            });

            if (this._rowWidth(buttons, shown) <= room)
                break;

            if (showLabels && givesWay) {
                showLabels = false;
            } else {
                const fits = this._fitsCount(buttons, room);
                if (fits >= shown)
                    break;
                shown = fits;
            }
        }

        // the blank tail eats the room the buttons do not use, so the buttons do
        // not jump as windows come and go: a fixed width rather than a minimum,
        // because a child with a minimum and no natural size of its own is exactly
        // what Clutter refuses to fit in a box
        this._spacer.visible = true;
        this._spacer.style = `width: ${Math.max(0, room - this._rowWidth(buttons, shown))}px;`;
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
     *
     * This is the cheap first cut, and _shareRoom checks it against the measured
     * width of the buttons: an estimate that is a button too generous costs a
     * hidden button at the end of the row, not the clock.
     */
    _maxButtonCount() {
        const room = this._roomWidth();

        // no room computed means the list is not in the panel yet (at session
        // start, and again whenever the panel is rebuilt): nothing to cap then
        if (room < 0)
            return Number.MAX_SAFE_INTEGER;

        const smallest = this._buttonChromeWidth() + this._buttonIconWidth() +
            this._settings.get_int('taskbar-spacing');
        return Math.max(1, Math.floor(room / smallest));
    }

    /**
     * The padding and border of a button, measured off the first button that is
     * on the stage; the constant is only for the pass that has none to measure.
     */
    _buttonChromeWidth() {
        for (const button of this._buttons.values()) {
            if (button.get_parent() === this)
                return button.themeChrome();
        }
        return BUTTON_CHROME_WIDTH;
    }

    _buttonIconWidth() {
        return this._settings.get_boolean('window-button-icons')
            ? this._settings.get_int('icon-size')
            : 0;
    }

    /**
     * Windows belonging on this monitor's taskbar, in the order of the row: the
     * place the user dragged each one to, and creation order for the rest.
     */
    getWindows() {
        const windows = global.get_window_actors().map(actor => actor.metaWindow);

        return Utils.getInterestingWindows(this._settings, windows, this._monitor.index)
            .sort((a, b) => this._compareWindows(a, b));
    }

    /**
     * Where the row puts a window: a dragged place first, creation order after.
     *
     * A window nobody has moved (_order has no place for it) waits at the end of
     * the row, so a new window joins the taskbar where the taskbar has always put
     * it; and a taskbar nobody has ever reordered - an empty _order - is sorted
     * exactly as it was before dragging existed.
     */
    _compareWindows(a, b) {
        const posA = this._order.indexOf(a);
        const posB = this._order.indexOf(b);

        if (posA !== posB) {
            if (posA === -1)
                return 1;
            if (posB === -1)
                return -1;
            return posA - posB;
        }

        return a.get_stable_sequence() - b.get_stable_sequence();
    }

    _syncStates() {
        this._buttons.forEach(button => button.syncState());
    }

    removeWindow(metaWindow) {
        const button = this._buttons.get(metaWindow);
        if (!button)
            return;

        this._buttons.delete(metaWindow);
        // The place the user gave the window is *not* dropped here: this runs for
        // a window that merely left the workspace or the monitor as well (see
        // redisplay), and the place it was dragged to is meant to survive that.
        // Gone windows are pruned in _pruneOrder.
        button.destroy();
    }

    /**
     * Drop the windows that no longer exist from the stored order. A kept
     * Meta.Window is a kept window, so this cannot wait; and a stale entry would
     * push the windows behind it along the row.
     *
     * "No longer exists" is answered by the window actors: mutter 18 has no
     * is_destroyed to ask a window with (HACKING.md, "API notes"), but every
     * managed window - on any workspace, minimized or not - has an actor, and a
     * closed one has none. So a window that only moved out of sight keeps its
     * place, and one that was closed loses it.
     */
    _pruneOrder() {
        if (this._order.length === 0)
            return;

        const alive = new Set(global.get_window_actors().map(actor => actor.metaWindow));
        this._order = this._order.filter(window => alive.has(window));
    }

    redisplay() {
        // A drag is moving the buttons about by itself; rebuilding the row in the
        // middle of one would take them back to their stored order under the
        // pointer. Nothing is lost: the drag's end asks for this pass again (see
        // _dragEnded), and the order the drag committed is what that pass lays out.
        if (this._draggedButton)
            return;

        this._placeInPanel();
        this._pruneOrder();

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

    /**
     * Draggable-target interface: the row a window button is dragged over moves
     * it, live, the way the favourite icons are reordered in appIconsTaskbar.
     *
     * Live rather than with a placeholder actor on purpose: a placeholder is a
     * child asking for room, and this list keeps its request to the room the
     * centre box has (HACKING.md, "When the panel runs out of room"); moving the
     * button itself costs the row nothing and is what the drop leaves behind.
     */
    handleDragOver(source, _actor, x, _y, _time) {
        // A drag outlives the actor it started on when the extension is disabled
        // halfway through: DND still asks the delegates it picked, and asking a
        // destroyed actor for its children is not a question Clutter answers.
        if (this._tornDown)
            return DND.DragMotionResult.CONTINUE;

        // Only this row's own buttons: the source has to be a window button (an
        // app dragged out of the overview or an Xdnd drop are the panel's and the
        // favourites' business, and the walk up the parents should carry on - hence
        // CONTINUE rather than NO_DROP), and it has to be *this* row's button, since
        // another monitor's taskbar holds a button for the same window (its own
        // list is the one to answer, and it is not under the pointer).
        if (!(source instanceof WindowButton) || source._list !== this)
            return DND.DragMotionResult.CONTINUE;

        this._moveButton(source, this._dropIndex(x));
        return DND.DragMotionResult.MOVE_DROP;
    }

    acceptDrop(source, _actor, _x, _y, _time) {
        if (this._tornDown)
            return false;

        if (!(source instanceof WindowButton) || source._list !== this)
            return false;

        // The button is already where the pointer left it (handleDragOver moved it
        // along the way); what a drop adds is the intention, so that the next
        // redisplay - and every one after it - lays the row out in this order.
        this._commitOrder();
        return true;
    }

    /**
     * Which button the pointer is over, as a child index: the first button whose
     * middle is to the right of the pointer, and just past the last button there
     * is room for otherwise. Dropping on the left half of a button goes before it,
     * on the right half after it - which is what makes the row move under the
     * pointer as it passes the middle of a neighbour.
     *
     * The blank tail is stepped over (it is not a window) and so are the buttons
     * the room has no space for: a child the box layout does not lay out has no
     * allocation worth trusting (see _shareRoom).
     */
    _dropIndex(x) {
        const children = this.get_children();
        // just past the last button that has an allocation, kept while walking so
        // the "past the end" answer does not have to be guessed afterwards
        let end = -1;

        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (child === this._spacer || !child.visible)
                continue;

            const {x1, x2} = child.allocation;
            if (x < x1 + (x2 - x1) / 2)
                return i;

            end = i + 1;
        }

        // Past the middle of the last button there is room for: the end of the
        // shown row - and the buttons the room has no space for keep their place
        // behind it. Sending the dragged button behind them instead would cost the
        // row a visible button on every drag to the right: the drag would land in
        // the blank tail, and the tail is what _shareRoom trims.
        return end;
    }

    /**
     * Put `button` at `index`, counting the children as they are while the button
     * is still among them (the drag leaves it in the row - see getDragActor).
     *
     * A button moving to the right leaves its old place behind, so where it lands
     * is one before where it was aimed; and the index is clamped to the children
     * there are, because the blank tail keeps the last child's place (redisplay).
     */
    _moveButton(button, index) {
        const children = this.get_children();
        const from = children.indexOf(button);
        if (from === -1)
            return false;

        let target = Math.max(0, Math.min(index, children.length - 1));
        if (from < target)
            target -= 1;

        if (from === target)
            return false;

        // insert_child_at_index will not re-parent a child that is attached
        this.remove_child(button);
        this.insert_child_at_index(button, target);
        return true;
    }

    /**
     * Make the row's order as it stands the order the list keeps: getWindows sorts
     * by it and every later redisplay lays the buttons out in it. The windows that
     * have no button (too many for the room, see _maxButtonCount) and the ones that
     * have never been dragged keep coming after it, in creation order.
     */
    _commitOrder() {
        this._order = this.get_children()
            .filter(child => child !== this._spacer)
            .map(child => child.metaWindow);
    }

    /** A button came loose: nothing may reshuffle the row until it lands. */
    _dragStarted(button) {
        this._draggedButton = button;
    }

    /** It landed, or it did not: the row is the list's again. */
    _dragEnded() {
        // 'drag-end' can arrive after the list is gone, when the extension was
        // disabled with a button in the air: queuing a refresh for a torn-down
        // list would run redisplay on a destroyed actor
        if (this._tornDown)
            return;

        this._draggedButton = null;
        // the pass the drag held off (a window closed during it, the room moved),
        // and the buttons back to their stored order when the drag was cancelled
        this.queueRedisplay();
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
        // no DND entry point is answered after this (see handleDragOver)
        this._tornDown = true;
        Utils.cancelRefresh(this, '_refreshId');
        this._settings.disconnectObject(this);
        global.display.disconnectObject(this);
        global.window_manager.disconnectObject(this);
        Shell.AppSystem.get_default().disconnectObject(this);
        this._roomSignals?.destroy();
        this._roomSignals = null;
        this._draggedButton = null;

        for (const button of this._buttons.values())
            button.destroy();
        this._buttons.clear();
        // dropped with the buttons: they hold the only references to the windows
        this._order = [];
    }
});
