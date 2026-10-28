import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import * as Config from 'resource:///org/gnome/Shell/Extensions/js/misc/config.js';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const [ShellVersion] = Config.PACKAGE_VERSION.split('.').map(s => Number(s));

export const GeneralPage = GObject.registerClass(
class AzTaskbarGeneralPage extends Adw.PreferencesPage {
    _init(settings) {
        super._init({
            title: _('Settings'),
            icon_name: 'preferences-system-symbolic',
            name: 'GeneralPage',
        });

        this._settings = settings;

        const generalGroup = new Adw.PreferencesGroup({
            title: _('General'),
        });
        this.add(generalGroup);

        const dashVisibilitySwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
            active: this._settings.get_boolean('hide-dash'),
        });
        const dashVisibilityRow = new Adw.ActionRow({
            title: _('Hide Dash in Overview'),
            activatable_widget: dashVisibilitySwitch,
        });
        dashVisibilitySwitch.connect('notify::active', widget => {
            this._settings.set_boolean('hide-dash', widget.get_active());
        });
        dashVisibilityRow.add_suffix(dashVisibilitySwitch);
        generalGroup.add(dashVisibilityRow);

        const taskbarGroup = new Adw.PreferencesGroup({
            title: _('App Icons Taskbar Behavior'),
        });
        this.add(taskbarGroup);

        const panelPositions = new Gtk.StringList();
        panelPositions.append(_('Left'));
        panelPositions.append(_('Center'));
        panelPositions.append(_('Right'));
        const panelPositionRow = new Adw.ComboRow({
            title: _('App Icons Position in Panel'),
            model: panelPositions,
            selected: this._settings.get_enum('position-in-panel'),
        });
        panelPositionRow.connect('notify::selected', widget => {
            this._settings.set_enum('position-in-panel', widget.selected);
        });
        taskbarGroup.add(panelPositionRow);

        const positionOffsetSpinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 15, step_increment: 1, page_increment: 1, page_size: 0,
            }),
            climb_rate: 1,
            digits: 0,
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        positionOffsetSpinButton.set_value(this._settings.get_int('position-offset'));
        positionOffsetSpinButton.connect('value-changed', widget => {
            this._settings.set_int('position-offset', widget.get_value());
        });
        const positionOffsetRow = new Adw.ActionRow({
            title: _('Position Offset'),
            subtitle: _('Offset the App Icons position within the panel box.'),
            activatable_widget: positionOffsetSpinButton,
        });
        positionOffsetRow.add_suffix(positionOffsetSpinButton);
        taskbarGroup.add(positionOffsetRow);

        const taskbarSpacingSpinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 50, step_increment: 1, page_increment: 1, page_size: 0,
            }),
            climb_rate: 1,
            digits: 0,
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        taskbarSpacingSpinButton.set_value(this._settings.get_int('taskbar-spacing'));
        taskbarSpacingSpinButton.connect('value-changed', widget => {
            this._settings.set_int('taskbar-spacing', widget.get_value());
        });
        const taskbarSpacingRow = new Adw.ActionRow({
            title: _('Taskbar Spacing'),
            subtitle: _('The spacing between the App Icons on the taskbar.'),
            activatable_widget: taskbarSpacingSpinButton,
        });
        taskbarSpacingRow.add_suffix(taskbarSpacingSpinButton);
        taskbarGroup.add(taskbarSpacingRow);

        const [showAppsButton, showAppsButtonPosition] =
            this._settings.get_value('show-apps-button').deep_unpack();

        const showAppsButtonSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        showAppsButtonSwitch.connect('notify::active', widget => {
            const [oldEnabled_, oldValue] = this._settings.get_value('show-apps-button').deep_unpack();
            this._settings.set_value('show-apps-button',
                new GLib.Variant('(bi)', [widget.get_active(), oldValue]));
            if (widget.get_active())
                showAppsButtonCombo.set_sensitive(true);
            else
                showAppsButtonCombo.set_sensitive(false);
        });
        const showAppsButtonCombo = new Gtk.ComboBoxText({
            valign: Gtk.Align.CENTER,
            sensitive: showAppsButton,
        });
        showAppsButtonCombo.append_text(_('Left'));
        showAppsButtonCombo.append_text(_('Right'));
        showAppsButtonCombo.set_active(showAppsButtonPosition);
        showAppsButtonCombo.connect('changed', widget => {
            const [oldEnabled, oldValue_] = this._settings.get_value('show-apps-button').deep_unpack();
            this._settings.set_value('show-apps-button',
                new GLib.Variant('(bi)', [oldEnabled, widget.get_active()]));
        });

        const showAppsButtonRow = new Adw.ActionRow({
            title: _('Enable "Show All Apps" Button'),
            activatable_widget: showAppsButtonSwitch,
        });
        showAppsButtonRow.use_markup = true;
        showAppsButtonRow.add_suffix(showAppsButtonSwitch);
        showAppsButtonRow.add_suffix(new Gtk.Separator({
            orientation: Gtk.Orientation.VERTICAL,
            margin_top: 10,
            margin_bottom: 10,
        }));
        showAppsButtonRow.add_suffix(showAppsButtonCombo);
        showAppsButtonSwitch.set_active(showAppsButton);
        taskbarGroup.add(showAppsButtonRow);

        const favoritesRow = new Adw.ExpanderRow({
            title: _('Show Favorite Apps'),
            show_enable_switch: true,
            expanded: false,
            enable_expansion: this._settings.get_boolean('favorites'),
        });
        favoritesRow.connect('notify::enable-expansion', widget => {
            this._settings.set_boolean('favorites', widget.enable_expansion);
        });
        taskbarGroup.add(favoritesRow);

        const favsOnAllMonitorsSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
            active: this._settings.get_boolean('favorites-on-all-monitors'),
        });
        const favsOnAllMonitorsRow = new Adw.ActionRow({
            title: _('Show Favorites on All Monitors'),
            activatable_widget: favsOnAllMonitorsSwitch,
        });
        favsOnAllMonitorsSwitch.connect('notify::active', widget => {
            this._settings.set_boolean('favorites-on-all-monitors', widget.get_active());
        });
        favsOnAllMonitorsRow.add_suffix(favsOnAllMonitorsSwitch);
        favoritesRow.add_row(favsOnAllMonitorsRow);

        const alwaysNewWindowSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
            active: this._settings.get_boolean('favorites-always-new-window'),
        });
        const alwaysNewWindowRow = new Adw.ActionRow({
            title: _('Always Open a New Window on Click'),
            subtitle: _('Favourite icons launch instead of cycling windows'),
            activatable_widget: alwaysNewWindowSwitch,
        });
        alwaysNewWindowSwitch.connect('notify::active', widget => {
            this._settings.set_boolean('favorites-always-new-window', widget.get_active());
        });
        alwaysNewWindowRow.add_suffix(alwaysNewWindowSwitch);
        favoritesRow.add_row(alwaysNewWindowRow);

        const runningAppsRow = new Adw.ExpanderRow({
            title: _('Show Open Windows (ungrouped)'),
            show_enable_switch: true,
            expanded: false,
            enable_expansion: this._settings.get_boolean('show-running-apps'),
        });
        runningAppsRow.connect('notify::enable-expansion', widget => {
            this._settings.set_boolean('show-running-apps', widget.enable_expansion);
        });
        taskbarGroup.add(runningAppsRow);

        const isolateWorkspacesSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        const isolateWorkspacesRow = new Adw.ActionRow({
            title: _('Isolate Workspaces'),
            activatable_widget: isolateWorkspacesSwitch,
        });
        isolateWorkspacesSwitch.set_active(this._settings.get_boolean('isolate-workspaces'));
        isolateWorkspacesSwitch.connect('notify::active', widget => {
            this._settings.set_boolean('isolate-workspaces', widget.get_active());
        });
        isolateWorkspacesRow.add_suffix(isolateWorkspacesSwitch);
        runningAppsRow.add_row(isolateWorkspacesRow);

        const isolateMonitorsSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        const isolateMonitorsRow = new Adw.ActionRow({
            title: _('Isolate Monitors'),
            activatable_widget: isolateMonitorsSwitch,
        });
        isolateMonitorsSwitch.set_active(this._settings.get_boolean('isolate-monitors'));
        isolateMonitorsSwitch.connect('notify::active', widget => {
            this._settings.set_boolean('isolate-monitors', widget.get_active());
        });
        isolateMonitorsRow.add_suffix(isolateMonitorsSwitch);
        runningAppsRow.add_row(isolateMonitorsRow);

        const iconGroup = new Adw.PreferencesGroup({
            title: _('App Icons'),
        });
        this.add(iconGroup);

        const iconSizeSpinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 15, upper: 50, step_increment: 1, page_increment: 1, page_size: 0,
            }),
            climb_rate: 1,
            digits: 0,
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        iconSizeSpinButton.set_value(this._settings.get_int('icon-size'));
        iconSizeSpinButton.connect('value-changed', widget => {
            this._settings.set_int('icon-size', widget.get_value());
        });
        const iconSizeRow = new Adw.ActionRow({
            title: _('Icon Size'),
            activatable_widget: iconSizeSpinButton,
        });
        iconSizeRow.add_suffix(iconSizeSpinButton);
        iconGroup.add(iconSizeRow);

        const iconPaddingSpinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 5, upper: 50, step_increment: 1, page_increment: 1, page_size: 0,
            }),
            climb_rate: 1,
            digits: 0,
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        iconPaddingSpinButton.set_value(this._settings.get_int('icon-padding-horizontal'));
        iconPaddingSpinButton.connect('value-changed', widget => {
            this._settings.set_int('icon-padding-horizontal', widget.get_value());
        });
        const iconPaddingRow = new Adw.ActionRow({
            title: _('App Icon Horizontal Padding'),
            activatable_widget: iconPaddingSpinButton,
        });
        iconPaddingRow.add_suffix(iconPaddingSpinButton);
        iconGroup.add(iconPaddingRow);

        const desatureFactorSpinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 0.0, upper: 1.0, step_increment: 0.05, page_increment: 0.1, page_size: 0,
            }),
            climb_rate: 0.05,
            digits: 2,
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        desatureFactorSpinButton.set_value(this._settings.get_double('desaturation-factor'));
        desatureFactorSpinButton.connect('value-changed', widget => {
            this._settings.set_double('desaturation-factor', widget.get_value());
        });
        const desatureFactorRow = new Adw.ActionRow({
            title: _('Icon Desaturate Factor'),
            activatable_widget: desatureFactorSpinButton,
        });
        desatureFactorRow.add_suffix(desatureFactorSpinButton);
        iconGroup.add(desatureFactorRow);

        const iconStyles = new Gtk.StringList();
        iconStyles.append(_('Regular'));
        iconStyles.append(_('Symbolic'));
        const iconStyleRow = new Adw.ComboRow({
            title: _('Icon Style'),
            subtitle: _('Icon themes may not have a symbolic icon for every app'),
            model: iconStyles,
            selected: this._settings.get_enum('icon-style'),
        });
        iconStyleRow.connect('notify::selected', widget => {
            this._settings.set_enum('icon-style', widget.selected);
        });
        iconGroup.add(iconStyleRow);

        const danceUrgentSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
            active: this._settings.get_boolean('dance-urgent'),
        });
        const danceUrgentRow = new Adw.ActionRow({
            title: _('Dance Urgent App Icons'),
            activatable_widget: danceUrgentSwitch,
        });
        danceUrgentSwitch.connect('notify::active', widget => {
            this._settings.set_boolean('dance-urgent', widget.get_active());
        });
        danceUrgentRow.add_suffix(danceUrgentSwitch);
        iconGroup.add(danceUrgentRow);

        const indicatorGroup = new Adw.PreferencesGroup({
            title: _('App Icon Indicators'),
        });
        this.add(indicatorGroup);

        const multiWindowIndicatorStyles = new Gtk.StringList();
        multiWindowIndicatorStyles.append(_('Indicator'));
        multiWindowIndicatorStyles.append(_('Multi-Dashes'));
        const multiWindowIndicatorRow = new Adw.ComboRow({
            title: _('Multi-Window Indicator Style'),
            model: multiWindowIndicatorStyles,
            selected: this._settings.get_enum('multi-window-indicator-style'),
        });
        multiWindowIndicatorRow.connect('notify::selected', widget => {
            this._settings.set_enum('multi-window-indicator-style', widget.selected);
        });
        indicatorGroup.add(multiWindowIndicatorRow);

        const indicatorLocations = new Gtk.StringList();
        indicatorLocations.append(_('Top'));
        indicatorLocations.append(_('Bottom'));
        const indicatorLocationRow = new Adw.ComboRow({
            title: _('Indicator Location'),
            model: indicatorLocations,
            selected: this._settings.get_enum('indicator-location'),
        });
        indicatorLocationRow.connect('notify::selected', widget => {
            this._settings.set_enum('indicator-location', widget.selected);
        });
        indicatorGroup.add(indicatorLocationRow);

        const systemAccentColorSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
            active: this._settings.get_boolean('indicator-color-use-system-accent-color'),
        });
        const systemAccentColorRow = new Adw.ActionRow({
            title: _('Use System Accent Colors'),
            activatable_widget: systemAccentColorSwitch,
            visible: ShellVersion >= 47,
        });
        systemAccentColorSwitch.connect('notify::active', widget => {
            this._settings.set_boolean('indicator-color-use-system-accent-color', widget.get_active());
            indicatorFocusedRow.visible = !widget.get_active();
            indicatorRunningRow.visible = !widget.get_active();
        });
        systemAccentColorRow.add_suffix(systemAccentColorSwitch);
        indicatorGroup.add(systemAccentColorRow);

        const showIndicatorColorButtons = ShellVersion >= 47 ? !this._settings.get_boolean('indicator-color-use-system-accent-color') : true;
        let color = new Gdk.RGBA();
        color.parse(this._settings.get_string('indicator-color-running'));
        const indicatorRunningColorButton = new Gtk.ColorButton({
            rgba: color,
            use_alpha: true,
            valign: Gtk.Align.CENTER,
        });
        indicatorRunningColorButton.connect('color-set', widget => {
            const widgetColor = widget.get_rgba().to_string();
            this._settings.set_string('indicator-color-running', widgetColor);
        });
        const indicatorRunningRow = new Adw.ActionRow({
            title: _('Running Indicator Color'),
            activatable_widget: indicatorRunningColorButton,
            visible: showIndicatorColorButtons,
        });
        indicatorRunningRow.add_suffix(indicatorRunningColorButton);
        indicatorGroup.add(indicatorRunningRow);

        color = new Gdk.RGBA();
        color.parse(this._settings.get_string('indicator-color-focused'));
        const indicatorFocusedColorButton = new Gtk.ColorButton({
            rgba: color,
            use_alpha: true,
            valign: Gtk.Align.CENTER,
        });
        indicatorFocusedColorButton.connect('color-set', widget => {
            const widgetColor = widget.get_rgba().to_string();
            this._settings.set_string('indicator-color-focused', widgetColor);
        });

        const indicatorFocusedRow = new Adw.ActionRow({
            title: _('Focused Indicator Color'),
            activatable_widget: indicatorFocusedColorButton,
            visible: showIndicatorColorButtons,
        });
        indicatorFocusedRow.add_suffix(indicatorFocusedColorButton);
        indicatorGroup.add(indicatorFocusedRow);

        const windowButtonsGroup = new Adw.PreferencesGroup({
            title: _('Window Buttons'),
            description: _('Every open window gets its own button, with its title. '
                         + 'Windows of the same application are never grouped.'),
        });
        this.add(windowButtonsGroup);

        const windowLabelsSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
            active: this._settings.get_boolean('window-labels'),
        });
        const windowLabelsRow = new Adw.ActionRow({
            title: _('Show Window Titles'),
            activatable_widget: windowLabelsSwitch,
        });
        windowLabelsSwitch.connect('notify::active', widget => {
            this._settings.set_boolean('window-labels', widget.get_active());
        });
        windowLabelsRow.add_suffix(windowLabelsSwitch);
        windowButtonsGroup.add(windowLabelsRow);

        const windowIconsSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
            active: this._settings.get_boolean('window-button-icons'),
        });
        const windowIconsRow = new Adw.ActionRow({
            title: _('Show Window Icons'),
            activatable_widget: windowIconsSwitch,
        });
        windowIconsSwitch.connect('notify::active', widget => {
            this._settings.set_boolean('window-button-icons', widget.get_active());
        });
        windowIconsRow.add_suffix(windowIconsSwitch);
        windowButtonsGroup.add(windowIconsRow);

        const windowButtonWidthSpinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 1000, step_increment: 10, page_increment: 20, page_size: 0,
            }),
            climb_rate: 1,
            digits: 0,
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        windowButtonWidthSpinButton.set_value(this._settings.get_int('window-button-width'));
        windowButtonWidthSpinButton.connect('value-changed', widget => {
            this._settings.set_int('window-button-width', widget.get_value());
        });
        const windowButtonWidthRow = new Adw.ActionRow({
            title: _('Window Button Width'),
            subtitle: _('0 means the button is as wide as its title'),
            activatable_widget: windowButtonWidthSpinButton,
        });
        windowButtonWidthRow.add_suffix(windowButtonWidthSpinButton);
        windowButtonsGroup.add(windowButtonWidthRow);

        const windowLabelFontSpinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 48, step_increment: 1, page_increment: 4, page_size: 0,
            }),
            climb_rate: 1,
            digits: 0,
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        windowLabelFontSpinButton.set_value(this._settings.get_int('window-label-font-size'));
        windowLabelFontSpinButton.connect('value-changed', widget => {
            this._settings.set_int('window-label-font-size', widget.get_value());
        });
        const windowLabelFontRow = new Adw.ActionRow({
            title: _('Window Title Font Size'),
            subtitle: _('0 uses the panel default size'),
            activatable_widget: windowLabelFontSpinButton,
        });
        windowLabelFontRow.add_suffix(windowLabelFontSpinButton);
        windowButtonsGroup.add(windowLabelFontRow);

        const closeOnMiddleSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
            active: true,
            sensitive: false,
        });
        const closeOnMiddleRow = new Adw.ActionRow({
            title: _('Close With Middle Click or Shift+Click'),
            subtitle: _('Right click opens the window menu, scroll wheel cycles the windows'),
        });
        closeOnMiddleRow.add_suffix(closeOnMiddleSwitch);
        windowButtonsGroup.add(closeOnMiddleRow);


        const badgesGroup = new Adw.PreferencesGroup({
            title: _('App Icon Badges'),
        });
        this.add(badgesGroup);

        const notificationCounterSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
            active: this._settings.get_boolean('notification-badges'),
        });
        const notificationCounterRow = new Adw.ActionRow({
            title: _('Notification Badges Count'),
            subtitle: _('Adds a badge counter to the App Icon based on GNOME shell notifications'),
            activatable_widget: notificationCounterSwitch,
        });
        notificationCounterSwitch.connect('notify::active', widget => {
            this._settings.set_boolean('notification-badges', widget.get_active());
        });
        notificationCounterRow.add_suffix(notificationCounterSwitch);
        badgesGroup.add(notificationCounterRow);

        const notificationAlwaysShowSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
            active: this._settings.get_boolean('always-show-notifications'),
        });
        const notificationAlwaysShowRow = new Adw.ActionRow({
            title: _('Always Show Notification Badges'),
            subtitle: _('Bypass "Do Not Disturb" mode'),
            activatable_widget: notificationAlwaysShowSwitch,
        });
        notificationAlwaysShowSwitch.connect('notify::active', widget => {
            this._settings.set_boolean('always-show-notifications', widget.get_active());
        });
        notificationAlwaysShowRow.add_suffix(notificationAlwaysShowSwitch);
        badgesGroup.add(notificationAlwaysShowRow);

        const unityCountSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
            active: this._settings.get_boolean('unity-badges'),
        });
        const unityCountRow = new Adw.ActionRow({
            title: _('Unity Badges Count'),
            subtitle: _('Requires Unity API'),
            activatable_widget: unityCountSwitch,
        });
        unityCountSwitch.connect('notify::active', widget => {
            this._settings.set_boolean('unity-badges', widget.get_active());
        });
        unityCountRow.add_suffix(unityCountSwitch);
        badgesGroup.add(unityCountRow);

        const progressSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
            active: this._settings.get_boolean('unity-progress-bars'),
        });
        const progressRow = new Adw.ActionRow({
            title: _('Unity Progress Bars'),
            subtitle: _('Requires Unity API'),
            activatable_widget: progressSwitch,
        });
        progressSwitch.connect('notify::active', widget => {
            this._settings.set_boolean('unity-progress-bars', widget.get_active());
        });
        progressRow.add_suffix(progressSwitch);
        badgesGroup.add(progressRow);
    }
});
