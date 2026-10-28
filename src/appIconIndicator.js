import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {AppState, MultiWindowIndicatorStyle} from './appIcon.js';
import {TaskbarManager} from './taskbarManager.js';

// Time between animation ticks (ms)
const ANIMATION_INTERVAL = 10;
// How many times the animation will tick (total 150ms animation)
const ANIMATION_TICKS = 15;

const INDICATOR_RADIUS = 1.5;
const DEGREES = Math.PI / 180;

const AnimationState = {
    NONE: 0,
    ANIMATE_DASHES: 1,
    ANIMATE_SINGLE: 2,
    ANIMATING: 3,
    COMPLETE: 4,
};

export const IndicatorLocation = {
    TOP: 0,
    BOTTOM: 1,
};

export const AppIconIndicator = GObject.registerClass(
class azTaskbarAppIconIndicator extends St.DrawingArea {
    _init(appIcon) {
        super._init({
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
        });
        this.set_offscreen_redirect(Clutter.OffscreenRedirect.ALWAYS);
        this._appIcon = appIcon;
        this.app = appIcon.app;
        this.connect('destroy', () => this._onDestroy());
        this._animationState = AnimationState.NONE;
        this._indicatorColor = 'transparent';
        this._desiredIndicatorWidth = 1;
        this._startIndicatorWidth = 0;
        this._stage = St.ThemeContext.get_for_stage(global.stage);
    }

    _setAnimationState(nPreviousWindows, nWindows) {
        const dashesEnabled = TaskbarManager.settings.get_enum('multi-window-indicator-style') ===
                              MultiWindowIndicatorStyle.MULTI_DASH;

        if (dashesEnabled && nWindows > 1)
            this._animationState = AnimationState.ANIMATE_DASHES;
        else
            this._animationState = AnimationState.ANIMATE_SINGLE;
    }

    _setIndicatorColor(appState) {
        const [accentColor, fgAccentColor] = this._stage.get_accent_color ? this._stage.get_accent_color() : [null, null];
        const accentColorString = this._getAccentColorString(accentColor, 'indicator-color-focused');
        const fgAccentColorString = this._getAccentColorString(fgAccentColor, 'indicator-color-running');

        if (appState === AppState.RUNNING)
            this._indicatorColor = fgAccentColorString;
        else if (appState === AppState.FOCUSED)
            this._indicatorColor = accentColorString;
    }

    _getAccentColorString(color, colorSetting) {
        const useAccentColors = TaskbarManager.settings.get_boolean('indicator-color-use-system-accent-color');
        if (!color || !useAccentColors)
            return TaskbarManager.settings.get_string(colorSetting);
        return `rgba(${color.red}, ${color.green}, ${color.blue}, ${color.alpha})`;
    }

    updateIndicator(forceRedraw, previousAppState, appState, nPreviousWindows, nWindows) {
        const needsRepaint = previousAppState !== appState ||
                            (previousAppState === appState && nPreviousWindows !== nWindows) ||
                            forceRedraw;

        if (!needsRepaint)
            return;

        this._setAnimationState(nPreviousWindows, nWindows);
        this._setIndicatorColor(appState);

        this.endAnimation();

        if (this._animationState === AnimationState.ANIMATE_DASHES)
            this._startDashesAnimation(previousAppState, appState, nPreviousWindows, nWindows);
        else if (this._animationState === AnimationState.ANIMATE_SINGLE)
            this._startSingleAnimation(appState);

        this._animateIndicatorsID = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ANIMATION_INTERVAL, () => {
            this.queue_repaint();
            return this._animate();
        });
    }

    _startDashesAnimation(previousAppState, appState, nPreviousWindows, nWindows) {
        const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const singleWindowRemains = nPreviousWindows === 2 && nWindows === 1;
        const singleWindowStart = nPreviousWindows === 1 && nWindows === 2;

        if (nPreviousWindows === 0 && nWindows > 1)
            nPreviousWindows = 1;

        let dashWidth = this._appIcon.width / 10;

        this._indicatorSpacing = 5 * scaleFactor;

        this._toDrawCount = nWindows - nPreviousWindows;

        if (this._toDrawCount < 0)
            this._indicatorCount = nPreviousWindows + this._toDrawCount;
        else
            this._indicatorCount = nPreviousWindows;

        this._toDrawCount = Math.abs(this._toDrawCount);

        if (appState === AppState.FOCUSED && singleWindowRemains) {
            this._indicatorWidth = this._appIcon.width / 4;
        } else if (previousAppState === AppState.RUNNING && singleWindowStart) {
            this._indicatorWidth = dashWidth;
        } else if (appState === AppState.FOCUSED && singleWindowStart) {
            this._indicatorWidth = dashWidth;
            dashWidth = this._appIcon.width / 4;
        } else {
            this._indicatorWidth = dashWidth;
        }

        this._desiredIndicatorWidth = (nWindows * this._indicatorWidth) +
                                      ((nWindows - 1) * this._indicatorSpacing);
        this._startIndicatorWidth = (nPreviousWindows * dashWidth) + ((nPreviousWindows - 1) *
                                    this._indicatorSpacing);
        this._indicatorTickWidth = (this._desiredIndicatorWidth - this._startIndicatorWidth) /
                                    ANIMATION_TICKS;
    }

    _startSingleAnimation(appState) {
        const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const radius = INDICATOR_RADIUS * scaleFactor;

        if (appState === AppState.NOT_RUNNING)
            this._desiredIndicatorWidth = -radius;
        else if (appState === AppState.RUNNING)
            this._desiredIndicatorWidth = this._appIcon.width / 10;
        else if (appState === AppState.FOCUSED)
            this._desiredIndicatorWidth = this._appIcon.width / 4;

        this._indicatorTickWidth = (this._desiredIndicatorWidth - this._startIndicatorWidth) /
                                    ANIMATION_TICKS;
    }

    _animate() {
        let animateDone = false;
        this._startIndicatorWidth += this._indicatorTickWidth;

        if (this._indicatorTickWidth > 0 && this._startIndicatorWidth >= this._desiredIndicatorWidth)
            animateDone = true;
        else if (this._indicatorTickWidth < 0 && this._startIndicatorWidth <= this._desiredIndicatorWidth)
            animateDone = true;
        else if (this._indicatorTickWidth === 0)
            animateDone = true;

        if (animateDone) {
            this._animateIndicatorsID = null;
            this._startIndicatorWidth = this._desiredIndicatorWidth;
            this.queue_repaint();
            return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
    }

    endAnimation() {
        if (this._animateIndicatorsID) {
            this._startIndicatorWidth = this._desiredIndicatorWidth;
            GLib.Source.remove(this._animateIndicatorsID);
            this._animateIndicatorsID = null;
        }
    }

    vfunc_repaint() {
        const width = this._startIndicatorWidth;

        const [bool_, color] = Clutter.Color ? Clutter.color_from_string(this._indicatorColor ?? 'transparent') : Cogl.color_from_string(this._indicatorColor ?? 'transparent');

        const [areaWidth, areaHeight] = this.get_surface_size();
        const cr = this.get_context();

        const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const radius = INDICATOR_RADIUS * scaleFactor;

        if (width <= -radius)
            return;

        let x = 0;

        const indicatorLocation = TaskbarManager.settings.get_enum('indicator-location');
        const y = indicatorLocation === IndicatorLocation.TOP ? 0 : (areaHeight - (radius * 2)) / 2;

        // GNOME 46 removed Clutter.cairo_set_source_color
        if (Clutter.cairo_set_source_color)
            Clutter.cairo_set_source_color(cr, color);
        else
            cr.setSourceColor(color);

        if (this._animationState === AnimationState.ANIMATE_DASHES) {
            cr.translate((areaWidth - width) / 2, y);
            // draw the previous visible indicators
            for (let i = 0; i < this._indicatorCount; i++) {
                cr.newSubPath();
                x = i * this._indicatorWidth + i * this._indicatorSpacing;
                cr.arc(x, y + radius, radius, 90 * DEGREES, -90 * DEGREES);
                cr.arc(x + this._indicatorWidth, y + radius, radius, -90 * DEGREES, 90 * DEGREES);
                cr.closePath();
            }
            // draw the new indicator
            for (let i = 0; i < this._toDrawCount; i++) {
                cr.newSubPath();
                x = width - this._indicatorWidth;
                cr.arc(x, y + radius, radius, 90 * DEGREES, -90 * DEGREES);
                cr.arc(x + this._indicatorWidth, y + radius, radius, -90 * DEGREES, 90 * DEGREES);
                cr.closePath();
            }
        } else {
            cr.translate((areaWidth - width) / 2, y);
            cr.newSubPath();
            cr.arc(x, y + radius, radius, 90 * DEGREES, -90 * DEGREES);
            cr.arc(x + width, y + radius, radius, -90 * DEGREES, 90 * DEGREES);
            cr.closePath();
        }

        cr.fill();
        cr.$dispose();
    }

    _onDestroy() {
        this.endAnimation();
    }
});
