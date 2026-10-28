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
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const BUILD = '/home/qq/distrobox/ubuntu/Projects/qwen-gnome-app-list/build/dev';
const REQUEST = `${BUILD}/dump.request`;
const RESULT = `${BUILD}/dump.json`;
const SHOT_REQUEST = `${BUILD}/shot.request`;
const SHOT_FILE = `${BUILD}/shot.png`;
const CLICK_REQUEST = `${BUILD}/click.request`;


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
    // ... and the height is what says whether an actor fits the panel it sits in:
    // a natural height over the band is a box handing the child more than it has,
    // which is a button hanging off the bottom of the screen (HACKING.md).
    const height = actor.get_preferred_height?.(-1);
    if (height) {
        node.minH = Math.round(height[0]);
        node.natH = Math.round(height[1]);
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
    const buttons = list._buttons instanceof Map
        ? [...list._buttons.values()]
        : [...(list._buttons ?? [])];
    return {
        visible: list.visible,
        buttons: list._buttons ? list._buttons.size : null,
        children: list.get_children().length,
        // what a drop committed (windowButtons.js _commitOrder): the row order is
        // built from this, so a drag that did not stick shows up here as a stale
        // title order against buttonWidths below
        order: (list._order ?? []).map(w => w.get_title?.() ?? null),
        // whether a drag is holding the row still (see _draggedButton)
        dragging: list._draggedButton?.metaWindow?.get_title?.() ?? null,
        // how the list worked its own width out (see _shareRoom/_roomWidth)
        sizing: {
            room: list._measuredRoom,
            panel: list._panel?.constructor?.name ?? null,
            rowPaddingBorder: list._rowPaddingBorder?.(),
            rowIndent: list._rowIndent?.(),
            rowChrome2: list._rowChrome?.(2),
            buttonChrome: list._buttonChromeWidth?.(),
            iconWidth: list._buttonIconWidth?.(),
            maxButtons: list._maxButtonCount?.(),
            // the room the buttons do not use, and how _shareRoom split it between
            // the two blank ends (that split is what centres the row)
            spacerLead: list._spacerLead?.style ?? null,
            spacerLeadVisible: list._spacerLead?.visible ?? null,
            spacerLeadNat: list._naturalWidth?.(list._spacerLead),
            spacer: list._spacer?.style ?? null,
            spacerVisible: list._spacer?.visible ?? null,
            spacerNat: list._naturalWidth?.(list._spacer),
            listNat: list._naturalWidth?.(list),
            natural: list.get_preferred_width?.(-1),
            minimum: list.get_preferred_width?.(-1)?.[0],
            // the vertical budget: the panel's own height, and what the list asks
            // for against it (see WindowButton._fitVertical)
            band: list._bandHeight?.(),
            bandNat: list.get_preferred_height?.(-1)?.[1],
            panelHeight: list._panelAncestor?.()?.get_height?.() ?? null,
            labels: list._settings?.get_boolean('window-labels'),
            autoHide: list._settings?.get_boolean('window-labels-auto-hide'),
            icons: list._settings?.get_boolean('window-button-icons'),
            widthPref: list._settings?.get_int('window-button-width'),
            spacing: list._settings?.get_int('taskbar-spacing'),
        },
        // every button as the layout sees it
        buttonWidths: list.get_children().filter(c => !list._isSpacer?.(c)).map(b => ({
            title: (b.metaWindow?.get_title() ?? '').slice(0, 30),
            visible: b.visible,
            nat: b.get_preferred_width?.(-1)?.[1],
            min: b.get_preferred_width?.(-1)?.[0],
            chrome: b.themeChrome?.(),
            labelVisible: b._label?.visible,
            // labelMax reads back what updateStyle wrote, and that property is
            // inert on Clutter 18 (HACKING.md, "API notes") - the number is on the
            // JS wrapper, not on the actor
            labelMax: b._label?.max_width,
            labelNat: b._label?.get_preferred_width?.(-1)?.[1],
            w: Math.round(b.get_width?.() ?? -1),
            // vertical: the box's own height against what the button asks for
            h: Math.round(b.get_height?.() ?? -1),
            minH: b.get_preferred_height?.(-1)?.[0],
            natH: b.get_preferred_height?.(-1)?.[1],
            chromeH: b.themeChromeHeight?.(),
            rowNatH: b._box?.get_preferred_height?.(-1)?.[1],
            labelNatH: b._label?.get_preferred_height?.(-1)?.[1],
            indicatorH: b._indicator?.height,
            indicatorVisible: b._indicator?.visible,
        })),
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

/**
 * A screenshot without the D-Bus service, the permission prompt or a portal.
 *
 * `Shell.Screenshot` is the same capture path the shell's own screenshot UI
 * uses; the shell promisifies its async methods when it loads that module,
 * which always happens at session start. The D-Bus gate that refuses container
 * clients does not apply here, and nothing is put on the clipboard or into the
 * user's Pictures folder.
 */
async function takeScreenshot(path) {
    const shooter = new Shell.Screenshot();
    try {
        const [content] = await shooter.screenshot_stage_to_content();
        const texture = content.get_texture();
        const stream = Gio.MemoryOutputStream.new_resizable();
        await Shell.Screenshot.composite_to_stream(
            texture, 0, 0, -1, -1, 1, null, 0, 0, 1, stream);
        stream.close(null);
        GLib.file_set_contents(path, stream.steal_as_bytes().get_data());
        log(`windowtaskbar-dev: shot -> ${path}`);
    } finally {
        shooter.destroy?.();
    }
}

/**
 * Dev-only: drive a window button the way a click would, and report the state
 * change. Mouse events cannot be injected into the shell (XWayland input only
 * reaches X clients), so the handler is called directly: that exercises the
 * whole click chain, including the menu, without any pointer.
 *
 * The request file holds a JSON body: {title: 'substring', action: 'click'|'activate'|'menu'}
 */
async function clickButton(ext) {
    const [, raw] = GLib.file_get_contents(CLICK_REQUEST);
    const request = JSON.parse(new TextDecoder().decode(raw));
    const list = collectManagers(ext)
        .map(e => (e.value.appIconsTaskbar ?? e.value._appIconsTaskbar)?.windowsList)
        .find(l => l);
    if (!list)
        throw new Error('no window list to click in');

    // _buttons is a Map of metaWindow -> button, so the window comes with it
    const entries = list._buttons instanceof Map ? [...list._buttons.entries()] : [...list._buttons];
    const found = entries.find(([w]) => (w.get_title?.() ?? '').includes(request.title ?? ''));
    const button = found ? found[1] : null;
    if (!button)
        throw new Error(`no window button matching ${JSON.stringify(request.title)}`);

    const metaWindow = found ? found[0] : button.metaWindow;
    const before = {
        title: metaWindow.get_title(),
        focused: metaWindow.has_focus(),
        minimized: metaWindow.minimized,
        monitor: metaWindow.get_monitor(),
    };

    switch (request.action) {
    case 'activate':
        button._activate();
        break;
    case 'menu':
        button._popupMenu();
        Main.panel.menuManager.closeMenu?.();
        break;
    default:
        button._onClick();
        break;
    }

    // give the window manager a moment to react (activate/unminimize are async)
    await new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });

    const result = {
        clicked: before,
        after: {
            title: metaWindow.get_title(),
            focused: metaWindow.has_focus(),
            minimized: metaWindow.minimized,
            stable: metaWindow.get_stable_sequence(),
        },
        focusedWindow: global.display.focus_window?.get_title?.() ?? null,
    };
    GLib.file_set_contents(`${BUILD}/click.json`, `${JSON.stringify(result, null, 4)}\n`);
    log(`windowtaskbar-dev: clicked '${before.title}' -> focused=${result.after.focused}`);
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

/**
 * Dev-only tidying. An enable that threw halfway earlier (or an older iteration
 * whose instance is gone) can leave its actors in the panel, and those stale
 * actors then take space and steal window buttons. Iteration classes are named
 * after the build, so anything from an older iter number is fair game to drop.
 */
function removeStaleIterationActors() {
    const iter = Number(import.meta.url.match(/\/iter(\d+)\//)?.[1] ?? 0);
    const boxes = [Main.panel._leftBox, Main.panel._centerBox, Main.panel._rightBox];
    const stale = [];

    for (const box of boxes) {
        for (const child of box.get_children()) {
            // renamed classes carry the build number as a suffix: 'WindowTaskbarButton_43'
            const match = /_(\d+)$/.exec(child.constructor?.name ?? '');
            const found = match ? Number(match[1]) : NaN;
            if (Number.isFinite(found) && found < iter)
                stale.push(child);
        }
    }

    stale.forEach(actor => {
        log(`windowtaskbar-dev: removing stale actor from an older build: ${actor.constructor?.name}`);
        actor.destroy();
    });
    return stale.length;
}

/** Watch dump.request in the build directory and answer it. */
export function attach(ext) {
    removeStaleIterationActors();

    const dir = Gio.File.new_for_path(BUILD);
    const monitor = dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
    // Gio.File has get_basename(), and a directory monitor hands us the child
    // that changed: only our request file is interesting.
    const onEvent = (_f, file) => {
        const name = file?.get_basename?.();
        if (name === 'click.request') {
            clickButton(ext).catch(e => logError(e, 'windowtaskbar-dev: click failed'));
            return;
        }
        if (name === 'shot.request') {
            takeScreenshot(SHOT_FILE).catch(e => logError(e, 'windowtaskbar-dev: shot failed'));
            return;
        }
        if (name !== 'dump.request')
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
    const click = Gio.File.new_for_path(CLICK_REQUEST);
    if (click.query_exists(null))
        onEvent(null, click);
    const shot = Gio.File.new_for_path(SHOT_REQUEST);
    if (shot.query_exists(null))
        onEvent(null, shot);

    return () => monitor.cancel?.();
}
