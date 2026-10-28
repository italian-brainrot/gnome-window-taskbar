import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {AboutPage} from './settings/aboutPage.js';
import {ActionsPage} from './settings/actionsPage.js';
import {DonatePage} from './settings/donatePage.js';
import {GeneralPage} from './settings/generalPage.js';
import {PanelPage} from './settings/panelPage.js';

export default class AzTaskbarPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const iconPath = `${this.path}/media`;
        const iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
        if (!iconTheme.get_search_path().includes(iconPath))
            iconTheme.add_search_path(iconPath);

        const settings = this.getSettings();

        let pageChangedId = settings.connect('changed::prefs-visible-page', () => {
            if (settings.get_string('prefs-visible-page') !== '')
                this._setVisiblePage(window, settings);
        });

        window.set_search_enabled(true);
        window.set_default_size(750, 800);

        window.connect('close-request', () => {
            if (pageChangedId) {
                settings.disconnect(pageChangedId);
                pageChangedId = null;
            }
        });

        const generalPage = new GeneralPage(settings);
        window.add(generalPage);

        const panelPage = new PanelPage(settings);
        window.add(panelPage);

        const actionsPage = new ActionsPage(settings);
        window.add(actionsPage);

        const donatePage = new DonatePage(this.metadata);
        window.add(donatePage);

        const aboutPage = new AboutPage(settings, this.metadata, this.path);
        window.add(aboutPage);

        this._setVisiblePage(window, settings);
    }

    _setVisiblePage(window, settings) {
        const prefsVisiblePage = settings.get_string('prefs-visible-page');

        window.pop_subpage();
        if (prefsVisiblePage === '') {
            window.set_visible_page_name('GeneralPage');
        } else if (prefsVisiblePage === 'DonatePage') {
            window.set_visible_page_name('DonatePage');
        } else if (prefsVisiblePage === 'WhatsNewPage') {
            window.set_visible_page_name('AboutPage');
            const page = window.get_visible_page();
            page.showWhatsNewPage();
        }

        settings.set_string('prefs-visible-page', '');
    }
}
