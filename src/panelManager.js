import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GWeather from 'gi://GWeather';
import St from 'gi://St';

import * as Animation from 'resource:///org/gnome/shell/ui/animation.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {AppIconsTaskbar} from './appIconsTaskbar.js';
import {Intellihide} from './intellihide.js';
import {PanelBox} from './panel.js';
import {PanelLocation} from './extension.js';
import * as Proximity from './proximity.js';
import * as Utils from './utils.js';
import {TaskbarManager} from './taskbarManager.js';

const WeatherPosition = {
    OFF: 0,
    LEFT: 1,
    RIGHT: 2,
};

const PanelPosition = {
    LEFT: 0,
    CENTER: 1,
    RIGHT: 2,
};

export const PanelManager = class azTaskbarPanelManager {
    constructor(monitor) {
        this._monitor = monitor;

        if (this._monitor !== Main.layoutManager.primaryMonitor) {
            this._panelBox = new PanelBox(this._monitor);
            this._panel = this.panelBox.panel;
        } else {
            this._panelBox = Main.layoutManager.panelBox;
            this._panelBox.panel = Main.panel;
            this._panel = Main.panel;
        }

        this._appIconsTaskbar = new AppIconsTaskbar(this._monitor);
        this._panelBox.appIconsTaskbar = this._appIconsTaskbar;
        this._dateMenu = this._panel.statusArea.dateMenu;
        this._clockDisplay = this._dateMenu._clockDisplay;
        this._clock = this._dateMenu._clock;
        this._weatherClient = this._dateMenu._weatherItem._weatherClient;
        // the original clockDisplay's parent
        this._origDateMenuBox = this._clockDisplay.get_parent();
        this._hasWeatherWidget = false;

        TaskbarManager.settings.connectObject('changed::override-panel-clock-format', () => this._updateDateFormat(), this);
        this._clockDisplay.connectObject('notify::text', () => this._updateDateFormat(), this);
        TaskbarManager.settings.connectObject('changed::clock-position-in-panel', () => this._setClockPosition(), this);
        TaskbarManager.settings.connectObject('changed::clock-position-offset', () => this._setClockPosition(), this);
        TaskbarManager.settings.connectObject('changed::clock-font-size', () => this._setClockFontSize(), this);
        TaskbarManager.settings.connectObject('changed::show-weather-by-clock', () => this._establishWeatherWidget(), this);
        TaskbarManager.settings.connectObject('changed::panel-transparent-in-overview', () => this._updateOverviewPanelStyle(), this);

        this.setAppsPosition();
        this._updateDateFormat();
        this._setClockPosition();
        this._setClockFontSize();
        this._establishWeatherWidget();
        this._updateOverviewPanelStyle();
    }

    get isMainPanel() {
        return this.panel === Main.panel;
    }

    get monitor() {
        return this._monitor;
    }

    get panel() {
        return this._panel;
    }

    get panelBox() {
        return this._panelBox;
    }

    get appIconsTaskbar() {
        return this._appIconsTaskbar;
    }

    enable() {
        this.proximityManager = new Proximity.ProximityManager();
        this.intellihide = new Intellihide(this);

        this._panelBox.intellihide = this.intellihide;

        if (this.isMainPanel) {
            this.panel._toggleMenu = indicator => {
                if (!indicator || (!this.intellihide.enabled && !indicator.mapped) || !indicator.reactive)
                    return;

                this.intellihide.revealAndHold(0, true);
                Object.getPrototypeOf(this.panel)._toggleMenu(indicator);
            };
        }
    }

    _updateOverviewPanelStyle() {
        this._panel.remove_style_pseudo_class('overview');
        Main.overview.disconnectObject(this._panel);

        const transparencyEnabled = TaskbarManager.settings.get_boolean('panel-transparent-in-overview');
        if (transparencyEnabled) {
            Main.overview.connectObject('showing', () => {
                this._panel.add_style_pseudo_class('overview');
            }, this._panel);

            Main.overview.connectObject('hiding', () => {
                this._panel.remove_style_pseudo_class('overview');
            }, this._panel);

            if (Main.overview.visible)
                this._panel.add_style_pseudo_class('overview');
        }
    }

    _establishWeatherWidget() {
        const weatherPosition = TaskbarManager.settings.get_enum('show-weather-by-clock');

        if (weatherPosition === WeatherPosition.OFF && this._hasWeatherWidget)
            this._destroyWeatherWidget();
        else if (weatherPosition !== WeatherPosition.OFF && this._hasWeatherWidget)
            this._moveWeatherWidget(weatherPosition);
        else if (weatherPosition !== WeatherPosition.OFF && !this._hasWeatherWidget)
            this._createWeatherWidget(weatherPosition);
    }

    _destroyWeatherWidget() {
        if (this._updateWeatherTimeoutId) {
            GLib.source_remove(this._updateWeatherTimeoutId);
            this._updateWeatherTimeoutId = null;
        }

        // Weather Widget hasn't been created or was previously destroyed
        if (!this._hasWeatherWidget)
            return;

        // put the clockDisplay back to its original parent
        this._customDateMenuBox.remove_child(this._clockDisplay);
        this._clockDisplay.set_style_class_name('clock');
        this._origDateMenuBox.insert_child_at_index(this._clockDisplay, 1);

        this._weatherClient.disconnectObject(this);
        this._customDateMenuBox.destroy();
        this._customDateMenuBox = null;
        this._weatherTemp = null;
        this._hasWeatherWidget = false;
    }

    _moveWeatherWidget(weatherPosition) {
        this._customDateMenuBox.remove_child(this._weatherBox);
        this._customDateMenuBox.remove_child(this._clockDisplay);
        if (weatherPosition === WeatherPosition.LEFT) {
            this._customDateMenuBox.add_child(this._weatherBox);
            this._customDateMenuBox.add_child(this._clockDisplay);
        } else {
            this._customDateMenuBox.add_child(this._clockDisplay);
            this._customDateMenuBox.add_child(this._weatherBox);
        }
    }

    _createWeatherWidget(weatherPosition) {
        this._weatherClient.update();
        this._hasWeatherWidget = true;
        this._weatherClient.connectObject('changed', this._syncWeather.bind(this), this);

        this._origDateMenuBox.remove_child(this._clockDisplay);
        this._clockDisplay.remove_style_class_name('clock');

        this._customDateMenuBox = new St.BoxLayout({
            ...Utils.getOrientationProp(false),
            style_class: 'clock',
            style: 'spacing: 8px;',
        });
        this._weatherBox = new St.BoxLayout({
            ...Utils.getOrientationProp(false),
        });
        this._weatherIcon = new St.Icon({
            icon_size: 16,
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this._weatherTemp = new St.Label({
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
            style: this._clockDisplay.style,
        });
        this._spinner = new Animation.Spinner(16, {
            animate: false,
            hideOnStop: true,
        });
        this._weatherBox.add_child(this._spinner);
        this._weatherBox.add_child(this._weatherIcon);
        this._weatherBox.add_child(this._weatherTemp);
        this._spinner.play();

        if (weatherPosition === WeatherPosition.LEFT) {
            this._customDateMenuBox.add_child(this._weatherBox);
            this._customDateMenuBox.add_child(this._clockDisplay);
        } else {
            this._customDateMenuBox.add_child(this._clockDisplay);
            this._customDateMenuBox.add_child(this._weatherBox);
        }

        this._origDateMenuBox.insert_child_at_index(this._customDateMenuBox, 1);

        this._syncWeather();

        // Update the weather every 5 minutes
        this._updateWeatherTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 300, () => {
            this._weatherClient.update();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _syncWeather() {
        if (!(this._weatherClient.available && this._weatherClient.hasLocation)) {
            this._weatherBox.hide();
            this._weatherIcon.hide();
            this._weatherTemp.hide();
            this._spinner.stop();
            return;
        }

        const {info} = this._weatherClient;

        if (this._weatherClient.loading) {
            this._weatherBox.show();
            this._weatherIcon.hide();
            this._weatherTemp.hide();
            this._spinner.play();
            return;
        }

        if (info.is_valid()) {
            this._weatherBox.show();
            this._spinner.stop();
            const [, tempValue] = info.get_value_temp(GWeather.TemperatureUnit.DEFAULT);
            const tempPrefix = Math.round(tempValue) >= 0 ? ' ' : '';

            this._weatherIcon.icon_name = info.get_symbolic_icon_name();
            this._weatherTemp.text = `${tempPrefix}${Math.round(tempValue)}°`;
            this._weatherIcon.show();
            this._weatherTemp.show();
            return;
        }

        // no valid weather
        this._weatherBox.hide();
        this._weatherIcon.hide();
        this._weatherTemp.hide();
        this._spinner.stop();
    }

    _updateDateFormat() {
        const formattedDate = Utils.getFormattedDate(TaskbarManager.settings);
        if (formattedDate)
            this._clockDisplay.text = formattedDate;
        else
            this._clockDisplay.text = this._clock.clock;
    }

    setAppsPosition() {
        const position = TaskbarManager.settings.get_enum('position-in-panel');
        const offset = TaskbarManager.settings.get_int('position-offset');

        this._setElementPosition(this.appIconsTaskbar, position, offset);
    }

    _setClockPosition() {
        const position = TaskbarManager.settings.get_enum('clock-position-in-panel');
        const offset = TaskbarManager.settings.get_int('clock-position-offset');

        if (position === PanelPosition.LEFT || position === PanelPosition.RIGHT)
            this._dateMenu.style = '-natural-hpadding: 0px; -minimum-hpadding: 0px;';
        else
            this._dateMenu.style = '';

        this._setElementPosition(this._dateMenu, position, offset);
    }

    _setClockFontSize() {
        const [clockSizeOverride, clockSize] = TaskbarManager.settings.get_value('clock-font-size').deep_unpack();

        if (!clockSizeOverride) {
            this._clockDisplay.style = 'text-align: center';
            if (this._weatherTemp)
                this._weatherTemp.style = this._clockDisplay.style;
            return;
        }

        this._clockDisplay.style = `font-size: ${clockSize}px; text-align: center`;
        if (this._weatherTemp)
            this._weatherTemp.style = this._clockDisplay.style;
    }

    _setElementPosition(element, position, offset) {
        element = element.container ?? element;

        const parent = element.get_parent();
        if (parent)
            parent.remove_child(element);

        if (position === PanelPosition.LEFT) {
            this.panel._leftBox.insert_child_at_index(element, offset);
        } else if (position === PanelPosition.CENTER) {
            this.panel._centerBox.insert_child_at_index(element, offset);
        } else if (position === PanelPosition.RIGHT) {
            const nChildren = this.panel._rightBox.get_n_children();
            const order = Math.clamp(nChildren - offset, 0, nChildren);
            this.panel._rightBox.insert_child_at_index(element, order);
        }
    }

    // Based on code from Just Perfection extension
    setSizeAndPosition() {
        const panelLocation = TaskbarManager.settings.get_enum('panel-location');
        if (panelLocation === PanelLocation.TOP) {
            if (this._workareasChangedId) {
                global.display.disconnect(this._workareasChangedId);
                this._workareasChangedId = null;
            }
            if (this._panelHeightSignal) {
                this._panelBox.disconnect(this._panelHeightSignal);
                this._panelHeightSignal = null;
            }
            this.panelBox.set_position(this._monitor.x, this._monitor.y);
            Main.layoutManager.uiGroup.remove_style_class_name('azTaskbar-bottom-panel');
            return;
        }

        const bottomY = this._monitor.y + this._monitor.height - this.panelBox.height;
        this.panelBox.set_position(this._monitor.x, bottomY);
        Main.layoutManager.uiGroup.add_style_class_name('azTaskbar-bottom-panel');

        if (!this._workareasChangedId) {
            this._workareasChangedId = global.display.connect('workareas-changed', () => {
                this.setSizeAndPosition();
            });
        }

        if (!this._panelHeightSignal) {
            this._panelHeightSignal = this.panelBox.connect('notify::height', () => {
                this.setSizeAndPosition();
            });
        }
    }

    destroy() {
        this._panelBox.appIconsTaskbar = null;
        this._panelBox.intellihide = null;
        if (this.isMainPanel)
            delete this.panel._toggleMenu;

        this.proximityManager?.destroy();
        this.intellihide?.destroy();
        this._destroyWeatherWidget();

        this._clockDisplay.disconnectObject(this);
        this.panelBox.disconnectObject(this);
        TaskbarManager.settings.disconnectObject(this);
        Main.overview.disconnectObject(this._panel);

        if (this._workareasChangedId) {
            global.display.disconnect(this._workareasChangedId);
            this._workareasChangedId = null;
        }

        if (this._panelHeightSignal) {
            this._panelBox.disconnect(this._panelHeightSignal);
            this._panelHeightSignal = null;
        }

        if (!this.isMainPanel) {
            this.panel.disable();
            this.panelBox.destroy();
        } else {
            this._clockDisplay.text = this._clock.clock;
            this._clockDisplay.style = '';

            this._setElementPosition(this._dateMenu, PanelPosition.CENTER, 0);

            this._appIconsTaskbar.destroy();
            Main.overview.connectObject('showing', () => {
                Main.panel.add_style_pseudo_class('overview');
            }, Main.panel);

            Main.overview.connectObject('hiding', () => {
                Main.panel.remove_style_pseudo_class('overview');
            }, Main.panel);
        }

        this._panelBox = null;
        this._panel = null;
        this.intellihide = null;
        this.proximityManager = null;
        this._appIconsTaskbar = null;
        this._dateMenu = null;
        this._clockDisplay = null;
        this._clock = null;
        this._weatherClient = null;
        this._origDateMenuBox = null;
    }
};
