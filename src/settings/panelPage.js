import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export const PanelPage = GObject.registerClass(
class AzTaskbarPanelPage extends Adw.PreferencesPage {
    _init(settings) {
        super._init({
            title: _('Panel'),
            icon_name: 'focus-top-bar-symbolic',
            name: 'PanelPage',
        });

        this._settings = settings;

        const panelGroup = new Adw.PreferencesGroup({
            title: _('Panel'),
        });
        this.add(panelGroup);

        const intellihideOptionsButton = new Gtk.Button({
            child: new Adw.ButtonContent({icon_name: 'applications-system-symbolic'}),
            valign: Gtk.Align.CENTER,
        });
        intellihideOptionsButton.connect('clicked', () => {
            const intellihideOptions = new IntellihideOptionsPage(this.get_root(), this._settings);
            intellihideOptions.show();
        });
        const intellihideSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        const intellihideRow = new Adw.ActionRow({
            title: _('Panel Intellihide'),
            activatable_widget: intellihideSwitch,
        });
        intellihideSwitch.set_active(this._settings.get_boolean('intellihide'));
        intellihideSwitch.connect('notify::active', widget => {
            this._settings.set_boolean('intellihide', widget.get_active());
        });
        intellihideRow.add_suffix(intellihideOptionsButton);
        intellihideRow.add_suffix(intellihideSwitch);
        panelGroup.add(intellihideRow);

        this._settings.bind('intellihide', intellihideOptionsButton, 'sensitive', Gio.SettingsBindFlags.DEFAULT);

        const panelLocations = new Gtk.StringList();
        panelLocations.append(_('Top'));
        panelLocations.append(_('Bottom'));
        const panelLocationRow = new Adw.ComboRow({
            title: _('Panel Location'),
            model: panelLocations,
            selected: this._settings.get_enum('panel-location'),
        });
        panelLocationRow.connect('notify::selected', widget => {
            this._settings.set_enum('panel-location', widget.selected);
        });
        panelGroup.add(panelLocationRow);

        const showOnAllMonitorsSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        const showOnAllMonitorsRow = new Adw.ActionRow({
            title: _('Show Panels on All Monitors'),
            activatable_widget: showOnAllMonitorsSwitch,
        });
        showOnAllMonitorsSwitch.set_active(this._settings.get_boolean('panel-on-all-monitors'));
        showOnAllMonitorsSwitch.connect('notify::active', widget => {
            this._settings.set_boolean('panel-on-all-monitors', widget.get_active());
        });
        showOnAllMonitorsRow.add_suffix(showOnAllMonitorsSwitch);
        panelGroup.add(showOnAllMonitorsRow);

        const [panelHeightOverride, panelHeight] = this._settings.get_value('main-panel-height').deep_unpack();

        const panelHeightSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        panelHeightSwitch.connect('notify::active', widget => {
            const [oldEnabled_, oldValue] = this._settings.get_value('main-panel-height').deep_unpack();
            this._settings.set_value('main-panel-height',
                new GLib.Variant('(bi)', [widget.get_active(), oldValue]));
            if (widget.get_active())
                panelHeightSpinButton.set_sensitive(true);
            else
                panelHeightSpinButton.set_sensitive(false);
        });
        const panelHeightSpinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 5,
                upper: 60,
                step_increment: 1,
            }),
            climb_rate: 1,
            digits: 0,
            numeric: true,
            valign: Gtk.Align.CENTER,
            value: panelHeight,
            sensitive: panelHeightOverride,
        });
        panelHeightSpinButton.connect('value-changed', widget => {
            const [oldEnabled, oldValue_] = this._settings.get_value('main-panel-height').deep_unpack();
            this._settings.set_value('main-panel-height',
                new GLib.Variant('(bi)', [oldEnabled, widget.get_value()]));
        });

        const panelHeightRow = new Adw.ActionRow({
            title: _('Panel Height'),
            activatable_widget: panelHeightSwitch,
        });
        panelHeightRow.add_suffix(panelHeightSwitch);
        panelHeightRow.add_suffix(new Gtk.Separator({
            orientation: Gtk.Orientation.VERTICAL,
            margin_top: 10,
            margin_bottom: 10,
        }));
        panelHeightRow.add_suffix(panelHeightSpinButton);
        panelHeightSwitch.set_active(panelHeightOverride);
        panelGroup.add(panelHeightRow);

        const panelOverviewStyleSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        const panelOverviewStyleRow = new Adw.ActionRow({
            title: _('Transparent Panel in Overview'),
            activatable_widget:  panelOverviewStyleSwitch,
        });
        panelOverviewStyleSwitch.set_active(this._settings.get_boolean('panel-transparent-in-overview'));
        panelOverviewStyleSwitch.connect('notify::active', widget => {
            this._settings.set_boolean('panel-transparent-in-overview', widget.get_active());
        });
        panelOverviewStyleRow.add_suffix(panelOverviewStyleSwitch);
        panelGroup.add(panelOverviewStyleRow);

        const activitiesSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        const activitiesRow = new Adw.ActionRow({
            title: _('Show Activities Button'),
            activatable_widget: activitiesSwitch,
        });
        activitiesSwitch.set_active(this._settings.get_boolean('show-panel-activities-button'));
        activitiesSwitch.connect('notify::active', widget => {
            this._settings.set_boolean('show-panel-activities-button', widget.get_active());
        });
        activitiesRow.add_suffix(activitiesSwitch);
        panelGroup.add(activitiesRow);

        const showWeather = this._settings.get_enum('show-weather-by-clock');
        const weatherOptions = new Gtk.StringList();
        weatherOptions.append(_('Off'));
        weatherOptions.append(_('Left'));
        weatherOptions.append(_('Right'));
        const weatherOptionsRow = new Adw.ComboRow({
            title: _('Show Weather near Clock'),
            model: weatherOptions,
            selected: showWeather,
        });
        weatherOptionsRow.connect('notify::selected', widget => {
            this._settings.set_enum('show-weather-by-clock', widget.selected);
        });
        panelGroup.add(weatherOptionsRow);

        const [clockOverride, clockFormat] = this._settings.get_value('override-panel-clock-format').deep_unpack();
        const clockExpanderRow = new Adw.ExpanderRow({
            title: _('Customize Panel Clock'),
        });
        panelGroup.add(clockExpanderRow);

        const panelPositions = new Gtk.StringList();
        panelPositions.append(_('Left'));
        panelPositions.append(_('Center'));
        panelPositions.append(_('Right'));
        const clockPositionRow = new Adw.ComboRow({
            title: _('Clock Position in Panel'),
            model: panelPositions,
            selected: this._settings.get_enum('clock-position-in-panel'),
        });
        clockPositionRow.connect('notify::selected', widget => {
            this._settings.set_enum('clock-position-in-panel', widget.selected);
        });
        clockExpanderRow.add_row(clockPositionRow);

        const clockOffsetSpinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 15, step_increment: 1, page_increment: 1, page_size: 0,
            }),
            climb_rate: 1,
            digits: 0,
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        clockOffsetSpinButton.set_value(this._settings.get_int('clock-position-offset'));
        clockOffsetSpinButton.connect('value-changed', widget => {
            this._settings.set_int('clock-position-offset', widget.get_value());
        });
        const clockOffsetRow = new Adw.ActionRow({
            title: _('Position Offset'),
            subtitle: _('Offset the position within the above selected box'),
            activatable_widget: clockOffsetSpinButton,
        });
        clockOffsetRow.add_suffix(clockOffsetSpinButton);
        clockExpanderRow.add_row(clockOffsetRow);

        const linkButton = new Gtk.LinkButton({
            label: _('Format Guide'),
            uri: 'https://docs.gtk.org/glib/method.DateTime.format.html#description',
            css_classes: ['caption'],
            valign: Gtk.Align.CENTER,
        });
        const enableFormatSwitch = new Gtk.Switch({
            active: clockOverride,
            valign: Gtk.Align.CENTER,
        });
        enableFormatSwitch.connect('notify::active', widget => {
            clockFormatEntry.sensitive = widget.get_active();
            const [oldClockOverride_, oldClockFormat] = this._settings.get_value('override-panel-clock-format').deep_unpack();
            this._settings.set_value('override-panel-clock-format',
                new GLib.Variant('(bs)', [widget.get_active(), oldClockFormat]));
        });
        const clockFormatTextRow = new Adw.ActionRow({
            title: _('Customize Clock Format'),
        });
        clockFormatTextRow.add_suffix(linkButton);
        clockFormatTextRow.add_suffix(enableFormatSwitch);
        clockExpanderRow.add_row(clockFormatTextRow);

        const clockFormatEntry = new Gtk.Entry({
            valign: Gtk.Align.FILL,
            vexpand: true,
            halign: Gtk.Align.FILL,
            hexpand: true,
            text: clockFormat || '',
            sensitive: clockOverride,
        });
        clockFormatEntry.connect('changed', widget => {
            const [oldClockOverride, oldClockFormat_] = this._settings.get_value('override-panel-clock-format').deep_unpack();
            this._settings.set_value('override-panel-clock-format',
                new GLib.Variant('(bs)', [oldClockOverride, widget.get_text()]));
        });
        const clockFormatRow = new Adw.ActionRow({
            activatable: false,
            selectable: false,
        });

        clockFormatRow.set_child(clockFormatEntry);
        clockExpanderRow.add_row(clockFormatRow);

        const [clockSizeOverride, clockSize] = this._settings.get_value('clock-font-size').deep_unpack();

        const clockSizeSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        clockSizeSwitch.connect('notify::active', widget => {
            const [oldEnabled_, oldValue] = this._settings.get_value('clock-font-size').deep_unpack();
            this._settings.set_value('clock-font-size',
                new GLib.Variant('(bi)', [widget.get_active(), oldValue]));
            if (widget.get_active())
                clockSizeSpinButton.set_sensitive(true);
            else
                clockSizeSpinButton.set_sensitive(false);
        });
        const clockSizeSpinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 5,
                upper: 60,
                step_increment: 1,
            }),
            climb_rate: 1,
            digits: 0,
            numeric: true,
            valign: Gtk.Align.CENTER,
            value: clockSize,
            sensitive: clockSizeOverride,
        });
        clockSizeSpinButton.connect('value-changed', widget => {
            const [oldEnabled, oldValue_] = this._settings.get_value('clock-font-size').deep_unpack();
            this._settings.set_value('clock-font-size',
                new GLib.Variant('(bi)', [oldEnabled, widget.get_value()]));
        });

        const clockSizeRow = new Adw.ActionRow({
            title: _('Clock Font Size'),
            activatable_widget: clockSizeSwitch,
        });
        clockSizeRow.add_suffix(clockSizeSwitch);
        clockSizeRow.add_suffix(new Gtk.Separator({
            orientation: Gtk.Orientation.VERTICAL,
            margin_top: 10,
            margin_bottom: 10,
        }));
        clockSizeRow.add_suffix(clockSizeSpinButton);
        clockSizeSwitch.set_active(clockSizeOverride);
        clockExpanderRow.add_row(clockSizeRow);
    }
});

const IntellihideOptionsPage = GObject.registerClass(
class azTaskbarIntellihideOptionsPage extends Adw.PreferencesWindow {
    _init(parent, settings) {
        super._init({
            title: _('Intellihide Options'),
            transient_for: parent,
            modal: true,
            default_width: 700,
            default_height: 625,
        });

        const restoreDefaultsButton = new Gtk.Button({
            icon_name: 'view-refresh-symbolic',
            tooltip_text: _('Reset settings'),
            css_classes: ['flat'],
        });
        restoreDefaultsButton.connect('clicked', () => {
            const dialog = new Gtk.MessageDialog({
                text: `<b>${_('Reset all %s settings?').format(this.title)}</b>`,
                secondary_text: _('All %s settings will be reset to the default value.').format(this.title),
                use_markup: true,
                buttons: Gtk.ButtonsType.YES_NO,
                message_type: Gtk.MessageType.WARNING,
                transient_for: this.get_root(),
                modal: true,
            });
            dialog.connect('response', (widget, response) => {
                if (response === Gtk.ResponseType.YES)
                    this.restoreDefaults();
                dialog.destroy();
            });
            dialog.show();
        });

        this._settings = settings;
        SwitchRow.setSettings(this._settings);
        SpinRow.setSettings(this._settings);

        const mainPage = new Adw.PreferencesPage();
        this.add(mainPage);

        // First Preferences Group
        const group1 = new Adw.PreferencesGroup();
        mainPage.add(group1);

        group1.set_header_suffix(restoreDefaultsButton);

        const windowHideRow = new SwitchRow({
            setting: 'intellihide-hide-from-windows',
            title: _('Dodge Windows'),
            subtitle:  _("Show the panel when it doesn't obstruct app windows."),
        });
        group1.add(windowHideRow);

        const behaviourOptions = new Gtk.StringList();
        behaviourOptions.append(_('All Windows'));
        behaviourOptions.append(_('Only Focused Windows'));
        behaviourOptions.append(_('Only Maximized Windows'));
        const behaviourOptionsMenu = new Gtk.DropDown({
            valign: Gtk.Align.CENTER,
            model: behaviourOptions,
            selected: this._settings.get_enum('intellihide-behaviour'),
        });
        const behaviourOptionsRow = new Adw.ActionRow({
            title: _('Dodge Windows Mode'),
            activatable_widget: behaviourOptionsMenu,
        });
        behaviourOptionsRow.add_suffix(behaviourOptionsMenu);
        behaviourOptionsMenu.connect('notify::selected', widget => {
            this._settings.set_enum('intellihide-behaviour', widget.selected);
        });
        group1.add(behaviourOptionsRow);

        this._settings.bind('intellihide-hide-from-windows', behaviourOptionsRow, 'sensitive', Gio.SettingsBindFlags.DEFAULT);

        // Second Preferences Group
        const group2 = new Adw.PreferencesGroup();
        mainPage.add(group2);

        const usePressureRow = new SwitchRow({
            setting: 'intellihide-use-pressure',
            title: _('Require Pressure To Reveal the Panel'),
        });
        group2.add(usePressureRow);

        const pressureThresholdRow = new SpinRow({
            setting: 'intellihide-pressure-threshold',
            lower: 1,
            upper: 9900,
            title: _('Pressure Threshold (px)'),
        });
        group2.add(pressureThresholdRow);

        const pressureTimeoutRow = new SpinRow({
            setting: 'intellihide-pressure-time',
            lower: 1,
            upper: 5000,
            title: _('Pressure Timeout (ms)'),
        });
        group2.add(pressureTimeoutRow);

        this._settings.bind('intellihide-use-pressure', pressureThresholdRow, 'sensitive', Gio.SettingsBindFlags.DEFAULT);
        this._settings.bind('intellihide-use-pressure', pressureTimeoutRow, 'sensitive', Gio.SettingsBindFlags.DEFAULT);

        // Third Preferences Group
        const group3 = new Adw.PreferencesGroup();
        mainPage.add(group3);

        const fullscreenRow = new SwitchRow({
            setting: 'intellihide-show-in-fullscreen',
            title: _('Reveal Panel with Mouse while in Fullscreen App'),
        });
        group3.add(fullscreenRow);

        const onlySecondaryRow = new SwitchRow({
            setting: 'intellihide-only-secondary',
            title: _('Only Hide Secondary Panels'),
        });
        group3.add(onlySecondaryRow);

        const accelerator = this._settings.get_strv('intellihide-key-toggle').toString();
        const hotkeyString = this.acceleratorToLabel(accelerator);
        const hotkeyLabel = new Gtk.Label({
            label: hotkeyString,
            css_classes: ['dim-label'],
        });
        const customHotkeyRow = new Adw.ActionRow({
            title: _('Hotkey to Reveal and Hold Panel'),
            activatable: true,
        });
        customHotkeyRow.add_suffix(hotkeyLabel);

        customHotkeyRow.connect('activated', () => {
            const dialog = new HotkeyDialog(this._settings, this);
            dialog.show();
            dialog.inhibitSystemShortcuts();
            dialog.connect('response', (_w, response) => {
                if (response === Gtk.ResponseType.APPLY) {
                    if (dialog.resultsText)
                        this._settings.set_strv('intellihide-key-toggle', [dialog.resultsText]);
                    else
                        this._settings.set_strv('intellihide-key-toggle', []);
                    hotkeyLabel.label = this.acceleratorToLabel(dialog.resultsText);
                }
                dialog.restoreSystemShortcuts();
                dialog.destroy();
            });
        });
        group3.add(customHotkeyRow);

        const persistRow = new Adw.ActionRow({
            title: _('Persist State Across Restarts'),
        });
        const persistSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
            active: this._settings.get_int('intellihide-persisted-state') !== -1,
        });
        persistSwitch.connect('notify::active', widget => {
            this._settings.set_int('intellihide-persisted-state', widget.get_active() ? 0 : -1);
        });
        persistRow.add_suffix(persistSwitch);
        group3.add(persistRow);

        const notificationRow = new SwitchRow({
            setting: 'intellihide-show-on-notification',
            title: _('Reveal and Hold the Panel on Notification'),
            subtitle:  _('Respects GNOME "Do Not Disturb" and requires show notification counter badge option.'),
        });
        group3.add(notificationRow);

        // Fourth Preferences Group
        const group4 = new Adw.PreferencesGroup();
        mainPage.add(group4);

        const animationRow = new SpinRow({
            setting: 'intellihide-animation-time',
            lower: 10,
            upper: 2000,
            title: _('Hide and Reveal Animation Duration (ms)'),
        });
        group4.add(animationRow);

        const hideDelayRow = new SpinRow({
            setting: 'intellihide-close-delay',
            lower: 10,
            upper: 4000,
            title: _('Delay Before Hiding the Panel (ms)'),
        });
        group4.add(hideDelayRow);

        const startDelayRow = new SpinRow({
            setting: 'intellihide-enable-start-delay',
            lower: 0,
            upper: 10000,
            title: _('Delay Before Enabling Intellihide on Start (ms)'),
        });
        group4.add(startDelayRow);

        this.restoreDefaults = () => {
            const settingKeys = [
                'intellihide-hide-from-windows',
                'intellihide-use-pressure',
                'intellihide-pressure-threshold',
                'intellihide-pressure-time',
                'intellihide-show-in-fullscreen',
                'intellihide-show-on-notification',
                'intellihide-only-secondary',
                'intellihide-animation-time',
                'intellihide-close-delay',
                'intellihide-key-toggle',
                'intellihide-enable-start-delay',
            ];

            settingKeys.forEach(key => {
                this._settings.reset(key);
            });

            // for settings that aren't bound, manually set to default value.
            behaviourOptionsMenu.selected = 1;
            persistSwitch.active = false;

            const newAccelerator = this._settings.get_strv('intellihide-key-toggle').toString();
            const label = this.acceleratorToLabel(newAccelerator);
            hotkeyLabel.label = label;
        };
    }

    acceleratorToLabel(accelerator) {
        if (!accelerator)
            return null;
        const [ok, key, mods] = Gtk.accelerator_parse(accelerator);
        if (!ok)
            return null;

        return Gtk.accelerator_get_label(key, mods);
    }
});

const SwitchRow = GObject.registerClass({
    Properties: {
        'setting': GObject.ParamSpec.string(
            'setting', 'setting', 'setting',
            GObject.ParamFlags.READWRITE,
            ''),
    },
}, class azTaskbarSwitchRow extends Adw.ActionRow {
    static setSettings(settings) {
        azTaskbarSwitchRow.settings = settings;
    }

    _init(params) {
        super._init({...params});

        const settingSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        this.activatable_widget = settingSwitch;
        this.add_suffix(settingSwitch);
        azTaskbarSwitchRow.settings.bind(this.setting, settingSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    }
});

const SpinRow = GObject.registerClass({
    Properties: {
        'setting': GObject.ParamSpec.string(
            'setting', 'setting', 'setting',
            GObject.ParamFlags.READWRITE,
            ''),
        'upper': GObject.ParamSpec.int(
            'upper', 'upper', 'upper',
            GObject.ParamFlags.READWRITE,
            1, GLib.MAXINT32, 10000),
        'lower': GObject.ParamSpec.int(
            'lower', 'lower', 'lower',
            GObject.ParamFlags.READWRITE,
            0, GLib.MAXINT32, 0),
    },
},
class azTaskbarSpinRow extends Adw.ActionRow {
    static setSettings(settings) {
        azTaskbarSpinRow.settings = settings;
    }

    _init(params) {
        super._init({...params});

        const spinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: this.lower,
                page_increment: 100,
                step_increment: 10,
                upper: this.upper,
            }),
            numeric: true,
            valign: Gtk.Align.CENTER,
            width_chars: 4,
        });
        this.add_suffix(spinButton);
        azTaskbarSpinRow.settings.bind(this.setting, spinButton, 'value', Gio.SettingsBindFlags.DEFAULT);
    }
});

const ForbiddenKeyvals = [
    Gdk.KEY_Home,
    Gdk.KEY_Left,
    Gdk.KEY_Up,
    Gdk.KEY_Right,
    Gdk.KEY_Down,
    Gdk.KEY_Page_Up,
    Gdk.KEY_Page_Down,
    Gdk.KEY_End,
    Gdk.KEY_Tab,
    Gdk.KEY_KP_Enter,
    Gdk.KEY_Return,
    Gdk.KEY_Mode_switch,
];

const HotkeyDialog = GObject.registerClass({
    Signals: {
        'response': {param_types: [GObject.TYPE_INT]},
    },
},
class azTaskbarHotkeyDialog extends Adw.Window {
    _init(settings, parent) {
        super._init({
            modal: true,
            title: _('Modify Hotkey'),
            transient_for: parent.get_root(),
            resizable: false,
        });
        this._settings = settings;
        this._parentWindow = parent.get_root();

        this.set_default_size(460, 275);

        const eventControllerKey = new Gtk.EventControllerKey();
        this.add_controller(eventControllerKey);

        const shortcutController = new Gtk.ShortcutController();
        this.add_controller(shortcutController);
        const escapeShortcut = new Gtk.Shortcut({
            trigger: Gtk.ShortcutTrigger.parse_string('Escape'),
            action: Gtk.ShortcutAction.parse_string('action(window.close)'),
        });
        shortcutController.add_shortcut(escapeShortcut);

        this.connect('destroy', () => {
            this.restoreSystemShortcuts();
        });

        const sidebarToolBarView = new Adw.ToolbarView({
            top_bar_style: Adw.ToolbarStyle.RAISED,
        });
        this.set_content(sidebarToolBarView);

        const headerBar = new Adw.HeaderBar({
            show_end_title_buttons: true,
            show_start_title_buttons: false,
        });
        sidebarToolBarView.add_top_bar(headerBar);

        const applyButton = new Gtk.Button({
            label: _('Apply'),
            halign: Gtk.Align.END,
            hexpand: false,
            css_classes: ['suggested-action'],
            visible: false,
        });
        applyButton.connect('clicked', () => {
            this.emit('response', Gtk.ResponseType.APPLY);
        });
        headerBar.pack_end(applyButton);

        const cancelButton = new Gtk.Button({
            label: _('Cancel'),
            halign: Gtk.Align.START,
            hexpand: false,
            visible: false,
        });
        cancelButton.connect('clicked', () => this.close());
        headerBar.pack_start(cancelButton);

        const content = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 18,
            margin_top: 12,
            margin_bottom: 12,
            margin_start: 12,
            margin_end: 12,
        });
        sidebarToolBarView.set_content(content);

        const keyLabel = new Gtk.Label({
            /* TRANSLATORS: %s is replaced with a description of the keyboard shortcut, don't translate/transliterate <b>%s</b>*/
            label: _('Enter a new hotkey'),
            use_markup: true,
            xalign: .5,
            wrap: true,
        });
        content.append(keyLabel);

        const directory = GLib.path_get_dirname(import.meta.url);
        const rootDirectory = GLib.path_get_dirname(directory);
        const iconPath = '/media/settings-keyboard.svg';

        const keyboardImage = new Gtk.Picture({
            file: Gio.File.new_for_uri(`${rootDirectory}${iconPath}`),
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
            can_shrink: false,
        });
        content.append(keyboardImage);

        const shortcutLabel = new Gtk.ShortcutLabel({
            hexpand: true,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.START,
            vexpand: false,
            visible: false,
            disabled_text: _('Disabled'),
        });
        content.append(shortcutLabel);

        const conflictLabel = new Gtk.Label({
            label: _('Press Esc to cancel or Backspace to disable the keyboard shortcut.'),
            use_markup: true,
            wrap: true,
        });
        content.append(conflictLabel);

        // Based on code from PaperWM prefsKeybinding.js https://github.com/paperwm/PaperWM
        eventControllerKey.connect('key-pressed', (controller, keyval, keycode, state) => {
            let modmask = state & Gtk.accelerator_get_default_mod_mask();
            let keyvalLower = Gdk.keyval_to_lower(keyval);

            // Normalize <Tab>
            if (keyvalLower === Gdk.KEY_ISO_Left_Tab)
                keyvalLower = Gdk.KEY_Tab;

            // Put Shift back if it changed the case of the key
            if (keyvalLower !== keyval)
                modmask |= Gdk.ModifierType.SHIFT_MASK;

            const event = controller.get_current_event();
            const isModifier = event.is_modifier();

            // Backspace deletes
            if (!isModifier && modmask === 0 && keyvalLower === Gdk.KEY_BackSpace) {
                this.resultsText = null;
                shortcutLabel.accelerator = null;
                shortcutLabel.visible = true;
                cancelButton.visible = true;
                keyboardImage.visible = false;
                conflictLabel.visible = false;
                applyButton.visible = true;
                return Gdk.EVENT_STOP;
            }

            // Remove CapsLock
            modmask &= ~Gdk.ModifierType.LOCK_MASK;

            const combo = {mods: modmask, keycode, keyval: keyvalLower};
            if (!this._isValidBinding(combo))
                return Gdk.EVENT_STOP;

            this.resultsText = Gtk.accelerator_name(keyval, modmask);
            const conflicts = this.findConflicts(this.resultsText);

            shortcutLabel.accelerator = this.resultsText;
            shortcutLabel.visible = true;
            cancelButton.visible = true;
            keyboardImage.visible = false;
            if (conflicts) {
                this.resultsText = null;
                applyButton.visible = false;
                conflictLabel.css_classes = ['error'];
                conflictLabel.visible = true;
                conflictLabel.label = _('Conflict with <b>%s</b> hotkey').format(`${conflicts.conflict}`);
            } else {
                conflictLabel.visible = false;
                applyButton.visible = true;
            }

            return Gdk.EVENT_STOP;
        });
    }

    // Based on code from PaperWM prefsKeybinding.js https://github.com/paperwm/PaperWM
    _isValidBinding(combo) {
        if ((combo.mods === 0 || combo.mods === Gdk.ModifierType.SHIFT_MASK) && combo.keycode !== 0) {
            const keyval = combo.keyval;
            if ((keyval >= Gdk.KEY_a && keyval <= Gdk.KEY_z) ||
                (keyval >= Gdk.KEY_A && keyval <= Gdk.KEY_Z) ||
                (keyval >= Gdk.KEY_0 && keyval <= Gdk.KEY_9) ||
                (keyval >= Gdk.KEY_kana_fullstop && keyval <= Gdk.KEY_semivoicedsound) ||
                (keyval >= Gdk.KEY_Arabic_comma && keyval <= Gdk.KEY_Arabic_sukun) ||
                (keyval >= Gdk.KEY_Serbian_dje && keyval <= Gdk.KEY_Cyrillic_HARDSIGN) ||
                (keyval >= Gdk.KEY_Greek_ALPHAaccent && keyval <= Gdk.KEY_Greek_omega) ||
                (keyval >= Gdk.KEY_hebrew_doublelowline && keyval <= Gdk.KEY_hebrew_taf) ||
                (keyval >= Gdk.KEY_Thai_kokai && keyval <= Gdk.KEY_Thai_lekkao) ||
                (keyval >= Gdk.KEY_Hangul_Kiyeog && keyval <= Gdk.KEY_Hangul_J_YeorinHieuh) ||
                (keyval === Gdk.KEY_space && combo.mods === 0) ||
                ForbiddenKeyvals.includes(keyval))
                return false;
        }

        // Empty binding
        if (combo.keyval === 0 && combo.mods === 0 && combo.keycode === 0)
            return false;

        // Don't allow use of Super_L and Super_R hotkeys
        if (combo.keyval === Gdk.KEY_Super_L || combo.keyval === Gdk.KEY_Super_R)
            return false;

        // Allow Tab in addition to accelerators allowed by GTK
        if (!Gtk.accelerator_valid(combo.keyval, combo.mods) &&
            (combo.keyval !== Gdk.KEY_Tab || combo.mods === 0))
            return false;

        return true;
    }

    getConflictSettings() {
        if (!this._conflictSettings) {
            this._conflictSettings = [];
            this._addConflictSettings('org.gnome.mutter.keybindings');
            this._addConflictSettings('org.gnome.mutter.wayland.keybindings');
            this._addConflictSettings('org.gnome.shell.keybindings');
            this._addConflictSettings('org.gnome.desktop.wm.keybindings');
            this._addConflictSettings('org.gnome.settings-daemon.plugins.media-keys');
        }

        return this._conflictSettings;
    }

    _addConflictSettings(schemaId) {
        try {
            const settings = new Gio.Settings({schema_id: schemaId});
            this._conflictSettings.push(settings);
        } catch (e) {
            console.log(e);
        }
    }

    generateKeycomboMap(settings) {
        const map = {};
        for (const name of settings.list_keys()) {
            const value = settings.get_value(name);
            if (value.get_type_string() !== 'as')
                continue;

            for (const combo of value.deep_unpack()) {
                if (combo === '0|0')
                    continue;
                if (map[combo])
                    map[combo].push(name);
                else
                    map[combo] = [name];
            }
        }

        return map;
    }

    findConflicts(newHotkey) {
        const schemas = this.getConflictSettings();
        let conflicts = null;

        const newHotkeyMap = {};
        newHotkeyMap[newHotkey] = ['New Hotkey'];

        for (const settings of schemas) {
            const against = this.generateKeycomboMap(settings);
            for (const combo in newHotkeyMap) {
                if (against[combo]) {
                    conflicts = {
                        conflict: against[combo],
                        name: newHotkeyMap[combo],
                    };
                }
            }
        }

        return conflicts;
    }

    inhibitSystemShortcuts() {
        this.grab_focus();

        // Note - surface.inhibit_system_shortcuts() seems to need a different surface on X11 vs Wayland?
        const isWayland = GLib.getenv('XDG_SESSION_TYPE') === 'wayland';
        const surface = isWayland ? this.get_surface() : this._parentWindow.get_surface();

        surface.inhibit_system_shortcuts(null);
    }

    restoreSystemShortcuts() {
        // Note - surface.inhibit_system_shortcuts() seems to need a different surface on X11 vs Wayland?
        const isWayland = GLib.getenv('XDG_SESSION_TYPE') === 'wayland';
        const surface = isWayland ? this.get_surface() : this._parentWindow.get_surface();

        if (surface)
            surface.restore_system_shortcuts();
    }
});
