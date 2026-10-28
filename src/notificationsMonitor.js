/*
* Code in this file borrowed from Dash to Dock
* https://github.com/micheleg/dash-to-dock/blob/master/notificationsMonitor.js
* Modified slightly to suit this extensions needs.
*/

import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';

import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export const NotificationsMonitor = class AzTaskbarNotificationsMonitor extends EventEmitter {
    constructor(extensionSettings) {
        super();
        this._settings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.notifications',
        });

        this._extensionSettings = extensionSettings;

        this._appNotifications = Object.create(null);
        this._signalsHandler = new Map();

        const alwaysShow = this._extensionSettings.get_boolean('always-show-notifications');
        const showBanners = this._settings.get_boolean('show-banners');

        this._isEnabled = showBanners || alwaysShow;

        this._showBannersId = this._settings.connect('changed::show-banners', () => {
            this._setEnabled();
        });
        this._alwaysShowId = this._extensionSettings.connect('changed::always-show-notifications', () => {
            this._setEnabled();
        });

        this._updateState();
    }

    _setEnabled() {
        const alwaysShow = this._extensionSettings.get_boolean('always-show-notifications');
        const showBanners = this._settings.get_boolean('show-banners');

        const isEnabled = showBanners || alwaysShow;
        if (isEnabled !== this._isEnabled) {
            this._isEnabled = isEnabled;
            this.emit('state-changed');

            this._updateState();
        }
    }

    _disconnectMessageTray() {
        if (this._sourceAddedId) {
            Main.messageTray.disconnect(this._sourceAddedId);
            this._sourceAddedId = null;
        }

        if (this._sourceRemovedId) {
            Main.messageTray.disconnect(this._sourceRemovedId);
            this._sourceRemovedId = null;
        }
    }

    destroy() {
        this.emit('destroy');

        this._disconnectMessageTray();

        this._signalsHandler.forEach((object, id) => {
            object.disconnect(id);
            id = null;
        });

        this._signalsHandler = null;

        if (this._showBannersId) {
            this._settings.disconnect(this._showBannersId);
            this._showBannersId = null;
        }

        if (this._alwaysShowId) {
            this._extensionSettings.disconnect(this._alwaysShowId);
            this._alwaysShowId = null;
        }

        this._appNotifications = null;
        this._settings = null;
    }

    get enabled() {
        return this._isEnabled;
    }

    getAppNotificationsCount(appId) {
        return this._appNotifications[appId] ?? 0;
    }

    _updateState() {
        if (this.enabled) {
            if (!this._sourceAddedId) {
                this._sourceAddedId = Main.messageTray.connect('source-added',
                    () => this._checkNotifications());
            }
            if (!this._sourceRemovedId) {
                this._sourceRemovedId = Main.messageTray.connect('source-removed',
                    () => this._checkNotifications());
            }
        } else {
            this._disconnectMessageTray();
        }

        this._checkNotifications();
    }

    _checkNotifications() {
        this._appNotifications = Object.create(null);
        this._signalsHandler.forEach((object, id) => {
            object.disconnect(id);
            id = null;
        });
        this._signalsHandler = new Map();

        if (this.enabled) {
            Main.messageTray.getSources().forEach(source => {
                this._signalsHandler.set(source.connect('notification-added',
                    () => this._checkNotifications()), source);

                source.notifications.forEach(notification => {
                    const app = notification.source?.app ?? notification.source?._app;
                    const appId = app?.id ?? app?._appId;

                    if (appId) {
                        if (notification.resident) {
                            if (notification.acknowledged)
                                return;
                            this._signalsHandler.set(notification.connect('notify::acknowledged',
                                () => this._checkNotifications()), notification);
                        }
                        this._signalsHandler.set(notification.connect('destroy',
                            () => this._checkNotifications()), notification);
                        this._appNotifications[appId] =
                            (this._appNotifications[appId] ?? 0) + 1;
                    }
                });
            });
        }

        this.emit('changed');
    }
};
