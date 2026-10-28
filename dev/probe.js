// Dev-only inspector, injected by scripts/hotreload.sh into the iteration build
// (it is not part of the shipped extension). It answers "what is actually on
// screen right now?" without screenshots or org.gnome.Shell.Eval:
//
//   scripts/dump.sh            # writes build/dev/dump.json
//
// The dump covers the panel actor tree, the extension's own objects and the
// current gsettings values, so an empty/again-collapsed taskbar can be traced
// from the shell's own state.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const BUILD = '/home/qq/distrobox/ubuntu/Projects/qwen-gnome-app-list/build/dev';
const REQUEST = `${BUILD}/dump.request`;
const RESULT = `${BUILD}/dump.json`;


function actorName(actor) {
    return Clutter.actor.get_name ? actor.get_name() : actor.constructor.name;
}

function describeActor(actor, depth = 0, maxDepth = 6) {
    if (!actor || depth > maxDepth)
        return null;

    let text;
    try {
        text = actor.get_text?.();
    } catch (e) {
        // not a text actor
    }

    const [px, py] = actor.get_transformed_position ? actor.get_transformed_position() ?? [NaN, NaN] : [NaN, NaN];

    const node = {
        actor: actor.constructor.name,
        name: actor.get_name?.() ?? null,
        classes: actor.get_style_class_name?.() ?? null,
        text: text && text.length < 120 ? text : undefined,
        mapped: actor.get_mapped?.() ?? null,
        reactive: actor.get_reactive?.() ?? null,
        opacity: actor.get_opacity?.() ?? null,
        x: Math.round(px),
        y: Math.round(py),
        w: Math.round(actor.get_width?.() ?? -1),
        h: Math.round(actor.get_height?.() ?? -1),
    };

    // Clutter's preferred-size vfuncs take an out-param in C, but in the JS
    // binding they take the for-width/height hint and return [min, natural].
    const width = actor.get_preferred_width?.(-1);
    if (width) {
        node.minW = Math.round(width[0]);
        node.natW = Math.round(width[1]);
        // A child whose minimum is larger than its natural size is not a
        // warning Clutter tolerates: it asserts and takes the shell down.
        node.violation = node.minW > node.natW;
    }
    void Clutter;

    const children = actor.get_children?.() ?? [];
    if (children.length) {
        node.n = children.length;
        if (depth + 1 <= maxDepth) {
            node.children = children
                .map(c => describeActor(c, depth + 1, maxDepth))
                .filter(c => c);
        }
    }
    return node;
}

function describeValue(value) {
    if (value === null || value === undefined)
        return String(value);
    if (typeof value !== 'object')
        return typeof value;
    if (value instanceof Clutter.Actor)
        return `actor:${value.constructor.name}`;
    if (Array.isArray(value))
        return `array(${value.length})`;
    if (value.constructor?.name)
        return value.constructor.name;
    return 'object';
}

function describeExtension(ext) {
    const out = {};
    for (const key of Object.getOwnPropertyNames(ext)) {
        let value;
        try {
            value = ext[key];
        } catch (e) {
            out[key] = `<getter threw: ${e.message}`;
            continue;
        }
        out[key] = describeValue(value);
    }
    return out;
}

/** The window list lives inside a panel-manager object, wherever it is kept. */
function collectManagers(ext) {
    const found = [];
    const seen = new Set();

    const visit = (obj, path, depth) => {
        if (!obj || typeof obj !== 'object' || seen.has(obj) || depth > 4)
            return;
        seen.add(obj);
        for (const key of Object.getOwnPropertyNames(obj)) {
            let value;
            try {
                value = obj[key];
            } catch (e) {
                continue;
            }
            if (!value || typeof value !== 'object' || value instanceof Clutter.Actor)
                continue;
            if (value.windowsList || value.appIconsTaskbar)
                found.push({path: `${path}.${key}`, value});
            visit(value, `${path}.${key}`, depth + 1);
        }
    };

    visit(ext, 'ext', 0);
    return found;
}

function windowListDump(list) {
    if (!list)
        return null;
    const windows = list.getWindows?.() ?? [];
    return {
        visible: list.visible,
        buttons: list._buttons ? list._buttons.size : null,
        children: list.get_children().length,
        windows: windows.map(w => ({
            title: w.get_title(),
            type: w.get_window_type?.() ?? null,
            app: w.get_app?.()?.get_id?.() ?? null,
            focused: w.has_focus(),
            minimized: w.minimized,
            onMonitor: w.get_monitor(),
            state: w.get_state?.().name ?? null,
            stable: w.get_stable_sequence(),
            workspace: w.get_workspace?.()?.workspace_index ?? null,
        })),
    };
}

export function dump(ext) {
    const panelManagers = collectManagers(ext).map(entry => {
        const manager = entry.value;
        const taskbar = manager.appIconsTaskbar ?? manager._appIconsTaskbar;
        // The window list lives on the taskbar actor (a JS property), not on the
        // panel manager, so it is looked up in both places.
        const windowsList = taskbar?.windowsList ?? manager.windowsList ?? null;
        return {
            path: entry.path,
            // Set by the dev-only 'dump.request' handler: whether the
            // deferred-work callbacks ever ran for these actors.
            taskbarState: taskbar && {
                shownInitially: taskbar._shownInitially,
                workId: taskbar._workId,
                mapped: taskbar.mapped,
                visible: taskbar.visible,
                mainBoxChildren: taskbar.mainBox.get_children().map(c => c.constructor.name),
                showAppsIconParent: taskbar.showAppsIcon?.get_parent()?.constructor?.name ?? null,
                appIconsCache: taskbar.appIconsCache ? taskbar.appIconsCache.size : null,
            },
            windowsList: windowListDump(windowsList),
            taskbar: taskbar ? describeActor(taskbar, 0, 7) : null,
        };
    });

    const ws = global.workspace_manager?.get_active_workspace?.();
    const windows = ws
        ? global.display.get_tab_list(Meta.TabList.NORMAL_ALL, ws).map(w => ({
            title: w.get_title(),
            type: w.get_window_type(),
            app: w.get_app?.()?.get_id?.() ?? null,
            minimized: w.minimized,
            onMonitor: w.get_monitor(),
            stable: w.get_stable_sequence(),
        }))
        : null;

    const data = {
        time: new Date().toISOString(),
        monitors: global.context.get_monitor_count?.() ?? null,
        globalUiGroup: global.uiGroup ? 'yes' : 'no',
        panelLocation: Main.panel.get_parent?.()?.constructor?.name ?? null,
        panelBox: describeActor(Main.layoutManager.panelBox, 0, 3),
        panel: describeActor(Main.panel, 0, 6),
        leftBoxChildren: Main.panel._leftBox.get_children().map(c => c.constructor.name),
        centerBoxChildren: Main.panel._centerBox.get_children().map(c => c.constructor.name),
        rightBoxChildren: Main.panel._rightBox.get_children().map(c => c.constructor.name),
        workspace: ws ? {
            index: ws.workspace_index,
            nColumns: global.workspace_manager.get_n_columns?.() ?? null,
            nRows: global.workspace_manager.get_n_rows?.() ?? null,
        } : null,
        windows,
        extension: describeExtension(ext),
        panelManagers,
        // Every key of the schema: no hard-coded list to keep in sync.
        settings: Object.fromEntries(ext.settings.list_keys().map(k => [
            k, (() => {
                const v = ext.settings.get_value(k);
                return v ? v.unpack?.() ?? String(v) : null;
            })(),
        ])),
        schemaKeys: null,
    };

    GLib.file_set_contents(RESULT, `${JSON.stringify(data, null, 4)}\n`);
    log(`windowtaskbar-dev: dumped ${data.panel?.w}px panel, ` +
        `${data.leftBoxChildren.length} left / ${data.rightBoxChildren.length} right panel items, ` +
        `${windows?.length ?? 0} windows -> ${RESULT}`);
}

/** Watch dump.request in the build directory and answer it. */
export function attach(ext) {
    const dir = Gio.File.new_for_path(BUILD);
    const monitor = dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
    // Gio.File has get_basename(), and a directory monitor hands us the child
    // that changed: only our request file is interesting.
    const onEvent = (_f, file) => {
        if (file?.get_basename?.() !== 'dump.request')
            return;
        try {
            dump(ext);
        } catch (e) {
            logError(e, 'windowtaskbar-dev: dump failed');
        }
    };
    monitor.connect('changed', onEvent);

    // A dump requested before this reload is answered as soon as we attach.
    const request = Gio.File.new_for_path(REQUEST);
    if (request.query_exists(null))
        onEvent(null, request);

    return () => monitor.cancel?.();
}
