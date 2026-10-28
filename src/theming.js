import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {TaskbarManager} from './taskbarManager.js';

Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');
Gio._promisify(Gio.File.prototype, 'delete_async');

const FileName = 'XXXXXX-aztaskbar-stylesheet.css';

/**
 * Create and load a custom stylesheet file into global.stage St.Theme
 */
export function createStylesheet() {
    try {
        const [file] = Gio.File.new_tmp(FileName);
        TaskbarManager.customStylesheet = file;
        updateStylesheet();
    } catch (e) {
        log(`AppIcons Taskbar - Error creating custom stylesheet: ${e}`);
    }
}

/**
 * Unload the custom stylesheet from global.stage St.Theme
 */
function unloadStylesheet() {
    if (!TaskbarManager.customStylesheet)
        return;

    const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
    theme.unload_stylesheet(TaskbarManager.customStylesheet);
}

/**
 * Delete and unload the custom stylesheet file from global.stage St.Theme
 */
export async function deleteStylesheet() {
    unloadStylesheet();

    const {extension} = TaskbarManager;
    const stylesheet = TaskbarManager.customStylesheet;

    try {
        if (stylesheet.query_exists(null))
            await stylesheet.delete_async(GLib.PRIORITY_DEFAULT, null);
    } catch (e) {
        if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            log(`AppIcons Taskbar - Error deleting custom stylesheet: ${e}`);
    } finally {
        delete extension.customStylesheet;
    }
}

/**
 * Write theme data to custom stylesheet and reload into global.stage St.Theme
 */
export async function updateStylesheet() {
    const {settings} = TaskbarManager;
    const stylesheet = TaskbarManager.customStylesheet;

    if (!stylesheet) {
        log('AppIcons Taskbar - Custom stylesheet error!');
        return;
    }

    unloadStylesheet();

    const [overridePanelHeight, panelHeight] = settings.get_value('main-panel-height').deep_unpack();

    let customStylesheetCSS = '';

    if (overridePanelHeight) {
        customStylesheetCSS += `.azTaskbar-panel{
            height: ${panelHeight}px;
        }`;
    }

    try {
        const bytes = new GLib.Bytes(customStylesheetCSS);
        const [success, etag_] = await stylesheet.replace_contents_bytes_async(bytes, null, false,
            Gio.FileCreateFlags.REPLACE_DESTINATION, null);

        if (!success) {
            log('AppIcons Taskbar - Failed to replace contents of custom stylesheet.');
            return;
        }

        TaskbarManager.customStylesheet = stylesheet;
        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
        theme.load_stylesheet(TaskbarManager.customStylesheet);
    } catch (e) {
        log(`AppIcons Taskbar - Error updating custom stylesheet. ${e.message}`);
    }
}
