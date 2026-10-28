/*
* Code in this file borrowed from Dash to Dock
* https://github.com/micheleg/dash-to-dock/blob/master/appIconIndicators.js
* Modified slightly to suit this extensions needs.
*/
import Cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {IndicatorLocation} from './appIconIndicator.js';
import {TaskbarManager} from './taskbarManager.js';
import * as Utils from './utils.js';

const INDICATOR_RADIUS = 1.5;
const DEGREES = Math.PI / 180;
const DEBUG = false;

function drawRoundedLine(cr, x, y, width, height, fill) {
    cr.newSubPath();
    cr.arc(x, y + INDICATOR_RADIUS, INDICATOR_RADIUS, 90 * DEGREES, -90 * DEGREES);
    cr.arc(x + width, y + INDICATOR_RADIUS, INDICATOR_RADIUS, -90 * DEGREES, 90 * DEGREES);
    cr.closePath();

    if (fill !== null) {
        cr.setSource(fill);
        cr.fillPreserve();
    }
    cr.fill();
}

export const AppIconBadges = GObject.registerClass(
class azTaskbarAppIconBadges extends St.Bin {
    _init(source) {
        super._init({
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.START,
            x_expand: true,
            y_expand: true,
        });

        this._source = source;
        this._signalHandler = new Utils.SignalHandler();

        this._notificationBadgeLabel = new St.Label();
        this.set_child(this._notificationBadgeLabel);

        Utils.addChildToParent(this._source._overlayGroup, this);
        this._notificationBadgeLabel.add_style_class_name('azTaskbar-notification-badge');
        this._notificationBadgeLabel.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;

        this.hide();
        this.updateNotificationBadgeStyle();
        this._setConnections();
        this._updateLocations();

        TaskbarManager.settings.connectObject('changed::unity-badges', () => {
            this._clearBadges();
            this._setConnections();
        }, this);
        TaskbarManager.settings.connectObject('changed::unity-progress-bars', () => {
            this._clearBadges();
            this._setConnections();
        }, this);
        TaskbarManager.settings.connectObject('changed::notification-badges', () => {
            this._clearBadges();
            this._setConnections();
        }, this);

        this.connect('destroy', () => this._onDestroy());
    }

    _setConnections() {
        const {remoteModel, notificationsMonitor} = TaskbarManager;
        const remoteEntry = remoteModel.lookupById(this._source.app.id);
        this._remoteEntry = remoteEntry;

        if (TaskbarManager.settings.get_boolean('unity-badges')) {
            this._signalHandler.connect(remoteEntry, 'count-changed', () => this._updateNotificationsCount());
            this._signalHandler.connect(remoteEntry, 'count-visible-changed', () => this._updateNotificationsCount());
        }

        if (TaskbarManager.settings.get_boolean('unity-progress-bars')) {
            this._signalHandler.connect(remoteEntry, 'progress-changed',
                (sender, {progress, progress_visible: progressVisible}) => this.setProgress(progressVisible ? progress : -1));

            this._signalHandler.connect(remoteEntry, 'progress-visible-changed',
                (sender, {progress, progress_visible: progressVisible}) => this.setProgress(progressVisible ? progress : -1));
            this.setProgress(this._remoteEntry.progress_visible ? this._remoteEntry.progress : -1);
        }

        if (TaskbarManager.settings.get_boolean('notification-badges'))
            this._signalHandler.connect(notificationsMonitor, 'changed', () => this._updateNotificationsCount());

        this._signalHandler.connect(remoteEntry, 'urgent-changed', (sender, {urgent}) => this.setUrgent(urgent));

        const stage = St.ThemeContext.get_for_stage(global.stage);
        this._signalHandler.connect(stage, 'changed', () => this.updateNotificationBadgeStyle());

        this._signalHandler.connect(this._source._iconBin, 'notify::size', () => this.updateNotificationBadgeStyle());
        this._signalHandler.connect(TaskbarManager.settings, 'changed::indicator-location', () => this._updateLocations());

        this._updateNotificationsCount();
        this.setUrgent(this._remoteEntry.urgent);
    }

    _onDestroy() {
        TaskbarManager.settings.disconnectObject(this);
        this._signalHandler.destroy();
        this._signalHandler = null;
        this._source = null;
        this._remoteEntry = null;
    }

    _clearBadges() {
        this._signalHandler.disconnectAll();
        this.setNotificationCount(0);
        this._hideProgressOverlay();
        this.setUrgent(false);
        this._remoteEntry = null;
    }

    _updateLocations() {
        const indicatorLocation = TaskbarManager.settings.get_enum('indicator-location');
        if (indicatorLocation === IndicatorLocation.TOP)
            this.y_align = Clutter.ActorAlign.END;
        else
            this.y_align = Clutter.ActorAlign.START;

        this._updateProgressOverlay();
    }

    updateNotificationBadgeStyle() {
        const iconSize = TaskbarManager.settings.get_int('icon-size');
        const fontSize = Math.round(Math.max(4, 0.45 * iconSize));

        let style = `font-size: ${fontSize}px;`;

        if (this._notificationBadgeLabel.get_text().length === 1)
            style += 'padding: 0.1em 0.45em;';
        else
            style += 'padding: 0.1em 0.25em;';

        this._notificationBadgeLabel.set_style(style);
    }

    _notificationBadgeCountToText(count) {
        if (count <= 99)
            return count.toString();
        else
            return '99+';
    }

    _updateNotificationsCount() {
        if (!this._source)
            return;
        let remoteCount = 0;
        if (TaskbarManager.settings.get_boolean('unity-badges')) {
            if (this._remoteEntry) {
                remoteCount = this._remoteEntry['count-visible']
                    ? this._remoteEntry.count ?? 0 : 0;
            }
        }

        let notificationsCount = 0;
        if (TaskbarManager.settings.get_boolean('notification-badges')) {
            const {notificationsMonitor} = TaskbarManager;
            notificationsCount = notificationsMonitor.getAppNotificationsCount(
                this._source.app.id);
        }

        this.setNotificationCount(remoteCount + notificationsCount);
    }

    setNotificationCount(count) {
        if (count > 0) {
            const text = this._notificationBadgeCountToText(count);
            this._notificationBadgeLabel.set_text(text);
            this.show();
        } else {
            this.hide();
        }

        if (DEBUG) {
            const text = this._notificationBadgeCountToText(99);
            this._notificationBadgeLabel.set_text(text);
            this.show();
        }

        this.updateNotificationBadgeStyle();
    }

    _showProgressOverlay() {
        if (this._progressOverlayArea) {
            this._updateProgressOverlay();
            return;
        }

        this._progressOverlayArea = new St.DrawingArea({x_expand: true, y_expand: true});
        this._progressOverlayArea.add_style_class_name('azTaskbar-progress-bar');
        this._source._overlayGroup.add_child(this._progressOverlayArea);

        this._progressOverlayArea.connect('repaint', () => {
            this._drawProgressOverlay(this._progressOverlayArea);
        });

        this._updateProgressOverlay();
    }

    _hideProgressOverlay() {
        if (this._progressOverlayArea)
            this._progressOverlayArea.destroy();
        this._progressOverlayArea = null;
    }

    _updateProgressOverlay() {
        if (this._progressOverlayArea)
            this._progressOverlayArea.queue_repaint();
    }

    _drawProgressOverlay(area) {
        const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const [surfaceWidth, surfaceHeight] = area.get_surface_size();
        const cr = area.get_context();

        const iconSize = TaskbarManager.settings.get_int('icon-size') * scaleFactor;

        const x = Math.floor((surfaceWidth - iconSize) / 2);

        const width = iconSize;
        const height = 3;

        let y;
        const indicatorLocation = TaskbarManager.settings.get_enum('indicator-location');

        if (indicatorLocation === IndicatorLocation.TOP)
            y = 0;
        else
            y = surfaceHeight - 3;

        const fallbackColor = {red: 204, green: 204, blue: 204, alpha: 255};
        let bg = Clutter.Color ? new Clutter.Color(fallbackColor) : new Cogl.Color(fallbackColor);

        const node = this._progressOverlayArea.get_theme_node();
        const [hasColor, color] = node.lookup_color('-progress-bar-background', false);
        if (hasColor)
            bg = color;

        // Draw the background
        let fill = new Cairo.LinearGradient(0, y, 0, height);
        fill.addColorStopRGBA(0.4, 0.25, 0.25, 0.25, 1.0);
        fill.addColorStopRGBA(0.9, 0.35, 0.35, 0.35, 1.0);
        drawRoundedLine(cr, x, y, width, height, fill);

        // Draw the finished bar
        const finishedWidth = Math.ceil(this._progress * width);

        fill = Cairo.SolidPattern.createRGBA(bg.red / 255, bg.green / 255, bg.blue / 255, bg.alpha / 255);

        if (Clutter.get_default_text_direction() === Clutter.TextDirection.RTL)
            drawRoundedLine(cr, x + width - finishedWidth, y, finishedWidth, height, fill);
        else
            drawRoundedLine(cr, x, y, finishedWidth, height, fill);

        cr.$dispose();
    }

    setProgress(progress) {
        if (progress < 0) {
            this._hideProgressOverlay();
        } else {
            this._progress = Math.min(progress, 1.0);
            this._showProgressOverlay();
        }

        if (DEBUG) {
            this._progress = Math.min(.2, 1.0);
            this._showProgressOverlay();
        }
    }

    setUrgent(urgent) {
        if (urgent || this._isUrgent !== undefined)
            this._source.urgent = urgent;

        if (urgent)
            this._isUrgent = urgent;
        else
            delete this._isUrgent;
    }
});
