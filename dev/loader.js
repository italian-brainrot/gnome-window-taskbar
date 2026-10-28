// Development-only loader: this is the extension.js of the *dev* extension
// (uuid windowtaskbar-dev@local). It is the only file the shell imports from
// the extension directory; everything else is imported fresh from the project's
// build directory on every enable, which is how a code change is picked up
// without restarting the session.
//
// scripts/hotreload.sh copies src/ into build/dev/iter<N>/, rewrites the class
// names to <name><N> (GJS registers GType names globally, and re-registering a
// name fails with "Type name … is already registered"), writes the iteration
// number into build/dev/current and reloads this extension.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const BUILD = '/home/qq/distrobox/ubuntu/Projects/qwen-gnome-app-list/build/dev';
const STAMP = `${BUILD}/current`;

export default class WindowTaskbarDevLoader extends Extension {
    async enable() {
        this._inner = null;

        let iter;
        try {
            const [, raw] = GLib.file_get_contents(STAMP);
            iter = new TextDecoder().decode(raw).trim();
        } catch (e) {
            logError(e, 'windowtaskbar-dev: cannot read build stamp, not loading');
            return;
        }

        const dir = Gio.File.new_for_path(`${BUILD}/iter${iter}`);
        if (!dir.get_child('extension.js').query_exists(null)) {
            log(`windowtaskbar-dev: no build in ${dir.get_path()}, run scripts/hotreload.sh`);
            return;
        }

        // The extension code reads dir/path from its metadata (GExtensionBase),
        // so point it at the iteration directory: its schemas/, locale/ and
        // gsettings keys resolve from there.
        const metadata = {...this.metadata, dir, path: dir.get_path()};

        try {
            const module = await import(`file://${dir.get_path()}/extension.js`);
            this._inner = new module.default(metadata);
            await this._inner.enable();
            log(`windowtaskbar-dev: loaded build iter${iter} from ${dir.get_path()}`);
        } catch (e) {
            logError(e, `windowtaskbar-dev: iter${iter} failed to load`);
            this._inner = null;
        }
    }

    disable() {
        try {
            this._inner?.disable();
        } catch (e) {
            logError(e, 'windowtaskbar-dev: disable failed');
        }
        this._inner = null;
    }

    openPreferences() {
        return this._inner?.openPreferences() ?? null;
    }
}
