import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export const ActionsPage = GObject.registerClass(
class AzTaskbarActionsPage extends Adw.PreferencesPage {
    _init(settings) {
        super._init({
            title: _('Actions'),
            icon_name: 'input-mouse-symbolic',
            name: 'ActionsPage',
        });
        this._settings = settings;

        const clickActionGroup = new Adw.PreferencesGroup({
            title: _('Click Actions'),
        });
        this.add(clickActionGroup);

        const clickOptions = new Gtk.StringList();
        clickOptions.append(_('Toggle / Cycle'));
        clickOptions.append(_('Toggle / Cycle + Minimize'));
        clickOptions.append(_('Toggle / Preview'));
        clickOptions.append(_('Cycle'));
        clickOptions.append(_('Raise'));
        clickOptions.append(_('Minimize'));
        clickOptions.append(_('Quit'));
        clickOptions.append(_('Launch New Instance'));
        clickOptions.append(_('Raise Here'));
        const clickOptionsMenu = new Gtk.DropDown({
            valign: Gtk.Align.CENTER,
            model: clickOptions,
            selected: this._settings.get_enum('click-action'),
        });
        const clickOptionsRow = new Adw.ActionRow({
            title: _('Left Click'),
            activatable_widget: clickOptionsMenu,
        });
        clickOptionsRow.add_suffix(clickOptionsMenu);
        clickOptionsMenu.connect('notify::selected', widget => {
            this._settings.set_enum('click-action', widget.selected);
        });
        clickActionGroup.add(clickOptionsRow);

        const middleClickOptionsMenu = new Gtk.DropDown({
            valign: Gtk.Align.CENTER,
            model: clickOptions,
            selected: this._settings.get_enum('middle-click-action'),
        });
        const middleClickOptionsRow = new Adw.ActionRow({
            title: _('Middle Click'),
            activatable_widget: middleClickOptionsMenu,
        });
        middleClickOptionsRow.add_suffix(middleClickOptionsMenu);
        middleClickOptionsMenu.connect('notify::selected', widget => {
            this._settings.set_enum('middle-click-action', widget.selected);
        });
        clickActionGroup.add(middleClickOptionsRow);

        const shiftMiddleClickOptionsMenu = new Gtk.DropDown({
            valign: Gtk.Align.CENTER,
            model: clickOptions,
            selected: this._settings.get_enum('shift-middle-click-action'),
        });
        const shiftMiddleClickOptionsRow = new Adw.ActionRow({
            title: _('Shift + Middle Click'),
            activatable_widget: middleClickOptionsMenu,
        });
        shiftMiddleClickOptionsRow.add_suffix(shiftMiddleClickOptionsMenu);
        shiftMiddleClickOptionsMenu.connect('notify::selected', widget => {
            this._settings.set_enum('shift-middle-click-action', widget.selected);
        });
        clickActionGroup.add(shiftMiddleClickOptionsRow);

        const scrollActionGroup = new Adw.PreferencesGroup({
            title: _('Scroll Actions'),
        });
        this.add(scrollActionGroup);

        const scrollOptions = new Gtk.StringList();
        scrollOptions.append(_('Cycle Windows'));
        scrollOptions.append(_('No Action'));
        const scrollOptionsRow = new Adw.ComboRow({
            title: _('Scroll Action'),
            model: scrollOptions,
            selected: this._settings.get_enum('scroll-action'),
        });
        scrollOptionsRow.connect('notify::selected', widget => {
            this._settings.set_enum('scroll-action', widget.selected);
        });
        scrollActionGroup.add(scrollOptionsRow);

        const hoverActionGroup = new Adw.PreferencesGroup({
            title: _('Hover Actions'),
        });
        this.add(hoverActionGroup);

        const toolTipsSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        const toolTipsRow = new Adw.ActionRow({
            title: _('Tool-Tips'),
            activatable_widget: toolTipsSwitch,
        });
        toolTipsSwitch.set_active(this._settings.get_boolean('tool-tips'));
        toolTipsSwitch.connect('notify::active', widget => {
            this._settings.set_boolean('tool-tips', widget.get_active());
        });
        toolTipsRow.add_suffix(toolTipsSwitch);
        hoverActionGroup.add(toolTipsRow);

        const windowPreviewsSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        const windowPreviewsOptionsButton = new Gtk.Button({
            child: new Adw.ButtonContent({icon_name: 'applications-system-symbolic'}),
            valign: Gtk.Align.CENTER,
        });
        windowPreviewsOptionsButton.connect('clicked', () => {
            const windowPreviewOptions = new WindowPreviewOptions(this.get_root(), this._settings);
            windowPreviewOptions.show();
        });
        const windowPreviewsRow = new Adw.ActionRow({
            title: _('Window Previews'),
            activatable_widget: windowPreviewsSwitch,
        });
        windowPreviewsSwitch.set_active(this._settings.get_boolean('window-previews'));
        windowPreviewsOptionsButton.set_sensitive(this._settings.get_boolean('window-previews'));
        windowPreviewsSwitch.connect('notify::active', widget => {
            windowPreviewsOptionsButton.set_sensitive(widget.get_active());
            this._settings.set_boolean('window-previews', widget.get_active());
        });
        windowPreviewsRow.add_suffix(windowPreviewsOptionsButton);
        windowPreviewsRow.add_suffix(windowPreviewsSwitch);
        hoverActionGroup.add(windowPreviewsRow);
    }
});

const WindowPreviewOptions = GObject.registerClass(
class azTaskbarWindowPreviewOptions extends Adw.PreferencesWindow {
    _init(parent, settings) {
        super._init({
            title: _('Window Preview Options'),
            transient_for: parent,
            modal: true,
            default_width: 700,
            default_height: 625,
        });

        this._settings = settings;

        const mainPage = new Adw.PreferencesPage();
        this.add(mainPage);

        const windowPreviewsGroup = new Adw.PreferencesGroup({
            title: _('Window Previews'),
        });
        mainPage.add(windowPreviewsGroup);

        const clickOptions = new Gtk.StringList();
        clickOptions.append(_('Raise'));
        clickOptions.append(_('Raise/Minimize'));
        const clickOptionsRow = new Adw.ComboRow({
            title: _('Click Action'),
            model: clickOptions,
            selected: this._settings.get_enum('window-preview-click-action'),
        });
        clickOptionsRow.connect('notify::selected', widget => {
            this._settings.set_enum('window-preview-click-action', widget.selected);
        });
        windowPreviewsGroup.add(clickOptionsRow);

        const showDelaySpinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 1200, step_increment: 100, page_increment: 100, page_size: 0,
            }),
            climb_rate: 100,
            digits: 0,
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        showDelaySpinButton.set_value(this._settings.get_int('window-previews-show-timeout'));
        showDelaySpinButton.connect('value-changed', widget => {
            this._settings.set_int('window-previews-show-timeout', widget.get_value());
        });
        const showDelaySpinRow = new Adw.ActionRow({
            title: _('Show Window Previews Delay'),
            subtitle: _('Time in ms to show the window preview'),
            activatable_widget: showDelaySpinButton,
        });
        showDelaySpinRow.add_suffix(showDelaySpinButton);
        windowPreviewsGroup.add(showDelaySpinRow);

        const hideDelaySpinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 1200, step_increment: 100, page_increment: 100, page_size: 0,
            }),
            climb_rate: 100,
            digits: 0,
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        hideDelaySpinButton.set_value(this._settings.get_int('window-previews-hide-timeout'));
        hideDelaySpinButton.connect('value-changed', widget => {
            this._settings.set_int('window-previews-hide-timeout', widget.get_value());
        });
        const hideDelaySpinRow = new Adw.ActionRow({
            title: _('Hide Window Previews Delay'),
            subtitle: _('Time in ms to hide the window preview'),
            activatable_widget: hideDelaySpinButton,
        });
        hideDelaySpinRow.add_suffix(hideDelaySpinButton);
        windowPreviewsGroup.add(hideDelaySpinRow);

        const styleGroup = new Adw.PreferencesGroup({
            title: _('Window Preview Style'),
        });
        mainPage.add(styleGroup);

        const gridEnabledRow = new Adw.ExpanderRow({
            title: _('Enable Grid Layout'),
            subtitle: _('Display window previews in a grid layout'),
            show_enable_switch: true,
            expanded: false,
            enable_expansion: this._settings.get_boolean('window-preview-grid-enabled'),
        });
        gridEnabledRow.connect('notify::enable-expansion', widget => {
            this._settings.set_boolean('window-preview-grid-enabled', widget.enable_expansion);
        });
        styleGroup.add(gridEnabledRow);

        const gridColumnsSpinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 1, upper: 10, step_increment: 1, page_increment: 1, page_size: 0,
            }),
            climb_rate: 1,
            digits: 0,
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        gridColumnsSpinButton.set_value(this._settings.get_int('window-preview-grid-columns'));
        gridColumnsSpinButton.connect('value-changed', widget => {
            this._settings.set_int('window-preview-grid-columns', widget.get_value());
        });
        const gridColumnsRow = new Adw.ActionRow({
            title: _('Grid Columns'),
            activatable_widget: gridColumnsSpinButton,
        });
        gridColumnsRow.add_suffix(gridColumnsSpinButton);
        gridEnabledRow.add_row(gridColumnsRow);

        const switchDelaySpinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 1200, step_increment: 100, page_increment: 100, page_size: 0,
            }),
            climb_rate: 100,
            digits: 0,
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        switchDelaySpinButton.set_value(this._settings.get_int('window-previews-switch-timeout'));
        switchDelaySpinButton.connect('value-changed', widget => {
            this._settings.set_int('window-previews-switch-timeout', widget.get_value());
        });
        const switchDelaySpinRow = new Adw.ActionRow({
            title: _('Switch Window Preview Delay'),
            subtitle: _('Time in ms to switch to a new window preview'),
            activatable_widget: switchDelaySpinButton,
        });
        switchDelaySpinRow.add_suffix(switchDelaySpinButton);
        windowPreviewsGroup.add(switchDelaySpinRow);

        const previewScaleSpinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: .3, upper: 2, step_increment: .1, page_increment: .1, page_size: 0,
            }),
            climb_rate: .1,
            digits: 2,
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        previewScaleSpinButton.set_value(this._settings.get_double('window-previews-size-scale'));
        previewScaleSpinButton.connect('value-changed', widget => {
            this._settings.set_double('window-previews-size-scale', widget.get_value());
        });
        const previewScaleRow = new Adw.ActionRow({
            title: _('Scaling Factor'),
            activatable_widget: previewScaleSpinButton,
        });
        previewScaleRow.add_suffix(previewScaleSpinButton);
        styleGroup.add(previewScaleRow);

        const titleFontSizeButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 6, upper: 40, step_increment: 1, page_increment: 1, page_size: 0,
            }),
            climb_rate: 1,
            digits: 0,
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        titleFontSizeButton.set_value(this._settings.get_int('window-preview-title-font-size'));
        titleFontSizeButton.connect('value-changed', widget => {
            this._settings.set_int('window-preview-title-font-size', widget.get_value());
        });
        const titleFontSizeRow = new Adw.ActionRow({
            title: _('Title Font Size'),
            activatable_widget: titleFontSizeButton,
        });
        titleFontSizeRow.add_suffix(titleFontSizeButton);
        styleGroup.add(titleFontSizeRow);

        const appIconSizeButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 6, upper: 40, step_increment: 1, page_increment: 1, page_size: 0,
            }),
            climb_rate: 1,
            digits: 0,
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        appIconSizeButton.set_value(this._settings.get_int('window-preview-app-icon-size'));
        appIconSizeButton.connect('value-changed', widget => {
            this._settings.set_int('window-preview-app-icon-size', widget.get_value());
        });
        const appIconSizeRow = new Adw.ActionRow({
            title: _('App Icon Size'),
            activatable_widget: appIconSizeButton,
        });
        appIconSizeRow.add_suffix(appIconSizeButton);
        styleGroup.add(appIconSizeRow);

        const buttonSizeButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 6, upper: 40, step_increment: 1, page_increment: 1, page_size: 0,
            }),
            climb_rate: 1,
            digits: 0,
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        buttonSizeButton.set_value(this._settings.get_int('window-preview-button-size'));
        buttonSizeButton.connect('value-changed', widget => {
            this._settings.set_int('window-preview-button-size', widget.get_value());
        });
        const buttonSizeRow = new Adw.ActionRow({
            title: _('Button Size'),
            subtitle: _('Close/Minimize Buttons'),
            activatable_widget: buttonSizeButton,
        });
        buttonSizeRow.add_suffix(buttonSizeButton);
        styleGroup.add(buttonSizeRow);

        const buttonIconSizeButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 6, upper: 40, step_increment: 1, page_increment: 1, page_size: 0,
            }),
            climb_rate: 1,
            digits: 0,
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        buttonIconSizeButton.set_value(this._settings.get_int('window-preview-button-icon-size'));
        buttonIconSizeButton.connect('value-changed', widget => {
            this._settings.set_int('window-preview-button-icon-size', widget.get_value());
        });
        const buttonIconSizeRow = new Adw.ActionRow({
            title: _('Button Icon Size'),
            subtitle: _('Close/Minimize Buttons'),
            activatable_widget: buttonIconSizeButton,
        });
        buttonIconSizeRow.add_suffix(buttonIconSizeButton);
        styleGroup.add(buttonIconSizeRow);

        const buttonSpacingButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 20, step_increment: 1, page_increment: 1, page_size: 0,
            }),
            climb_rate: 1,
            digits: 0,
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        buttonSpacingButton.set_value(this._settings.get_int('window-preview-button-spacing'));
        buttonSpacingButton.connect('value-changed', widget => {
            this._settings.set_int('window-preview-button-spacing', widget.get_value());
        });
        const buttonSpacingRow = new Adw.ActionRow({
            title: _('Button Spacing'),
            subtitle: _('Close/Minimize Buttons'),
            activatable_widget: buttonSpacingButton,
        });
        buttonSpacingRow.add_suffix(buttonSpacingButton);
        styleGroup.add(buttonSpacingRow);

        const showMinimizeButtonSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
            active: this._settings.get_boolean('window-preview-show-minimize-button'),
        });
        const showMinimizeButtonRow = new Adw.ActionRow({
            title: _('Show Minimize Button'),
            activatable_widget: showMinimizeButtonSwitch,
        });
        showMinimizeButtonSwitch.connect('notify::active', widget => {
            this._settings.set_boolean('window-preview-show-minimize-button', widget.get_active());
        });
        showMinimizeButtonRow.add_suffix(showMinimizeButtonSwitch);
        styleGroup.add(showMinimizeButtonRow);

        const windowPeekGroup = new Adw.PreferencesGroup({
            title: _('Window Peeking'),
        });
        mainPage.add(windowPeekGroup);

        const enablePeekSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        const enablePeekRow = new Adw.ActionRow({
            title: _('Window Peeking'),
            subtitle: _('Hovering a window preview will focus desired window'),
            activatable_widget: enablePeekSwitch,
        });
        enablePeekSwitch.set_active(this._settings.get_boolean('peek-windows'));
        enablePeekSwitch.connect('notify::active', widget => {
            this._settings.set_boolean('peek-windows', widget.get_active());
        });
        enablePeekRow.add_suffix(enablePeekSwitch);
        windowPeekGroup.add(enablePeekRow);

        const peekTimeoutSpinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 800, step_increment: 100, page_increment: 100, page_size: 0,
            }),
            climb_rate: 100,
            digits: 0,
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        peekTimeoutSpinButton.set_value(this._settings.get_int('peek-windows-timeout'));
        peekTimeoutSpinButton.connect('value-changed', widget => {
            this._settings.set_int('peek-windows-timeout', widget.get_value());
        });
        const peekTimeoutSpinRow = new Adw.ActionRow({
            title: _('Window Peeking Delay'),
            subtitle: _('Time in ms to trigger window peek'),
            activatable_widget: peekTimeoutSpinButton,
        });
        peekTimeoutSpinRow.add_suffix(peekTimeoutSpinButton);
        windowPeekGroup.add(peekTimeoutSpinRow);

        const peekOpacitySpinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 255, step_increment: 1, page_increment: 1, page_size: 0,
            }),
            climb_rate: 1,
            digits: 0,
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        peekOpacitySpinButton.set_value(this._settings.get_int('peek-windows-opacity'));
        peekOpacitySpinButton.connect('value-changed', widget => {
            this._settings.set_int('peek-windows-opacity', widget.get_value());
        });
        const peekOpacityRow = new Adw.ActionRow({
            title: _('Window Peeking Opacity'),
            subtitle: _('Opacity of non-focused windows during a window peek'),
            activatable_widget: peekOpacitySpinButton,
        });
        peekOpacityRow.add_suffix(peekOpacitySpinButton);
        windowPeekGroup.add(peekOpacityRow);
    }
});
