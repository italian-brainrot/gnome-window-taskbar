/* eslint-disable jsdoc/require-jsdoc */
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import {formatDateWithCFormatString} from 'resource:///org/gnome/shell/misc/dateUtils.js';

const [ShellVersion] = Config.PACKAGE_VERSION.split('.').map(s => Number(s));

export function getFormattedDate(settings) {
    const [enabled, format] = settings.get_value('override-panel-clock-format').deep_unpack();

    if (!enabled)
        return false;

    const date = new Date();
    return formatDateWithCFormatString(date, format);
}

export function getInterestingWindows(settings, windows, monitorIndex) {
    if (settings.get_boolean('isolate-workspaces')) {
        const activeWorkspace = global.workspace_manager.get_active_workspace();
        windows = windows.filter(w => {
            const inWorkspace = w.get_workspace() === activeWorkspace;
            return inWorkspace;
        });
    }

    if (settings.get_boolean('panel-on-all-monitors') && settings.get_boolean('isolate-monitors')) {
        windows = windows.filter(w => {
            return w.get_monitor() === monitorIndex;
        });
    }

    return windows.filter(w => !w.skipTaskbar);
}

/**
 * Adapted from GNOME Shell. Modified to work with a horizontal scrollView
 *
 * @param {St.Scrollview} scrollView
 * @param {Clutter.Actor} actor the actor in the scroll view
 */
export function ensureActorVisibleInScrollView(scrollView, actor) {
    const {hadjustment} = getScrollViewAdjustments(scrollView);
    const [value, lower_, upper, stepIncrement_, pageIncrement_, pageSize] = hadjustment.get_values();

    let offset = 0;
    const hfade = scrollView.get_effect('fade');
    if (hfade)
        offset = hfade.fade_margins.left;

    let box = actor.get_allocation_box();
    let {x1} = box, {x2} = box;

    let parent = actor.get_parent();
    while (parent !== scrollView) {
        if (!parent)
            throw new Error('actor not in scroll view');

        box = parent.get_allocation_box();
        x1 += box.x1;
        x2 += box.x1;
        parent = parent.get_parent();
    }

    let newValue;
    if (x1 < value + offset)
        newValue = Math.max(0, x1 - offset);
    else if (x2 > value + pageSize - offset)
        newValue = Math.min(upper, x2 + offset - pageSize);
    else
        return;

    hadjustment.ease(newValue, {
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        duration: 100,
    });
}

export function laterAdd(laterType, callback) {
    return global.compositor.get_laters().add(laterType, callback);
}

export function laterRemove(id) {
    global.compositor.get_laters().remove(id);
}

/**
 *
 * @param {Clutter.Actor} parent
 * @param {Clutter.Actor} child
 * @description GNOME 46 no longer supports add_actor() method.\
 *              Check which method to use to maintain compatibility with GNOME 45 and 46.
 */
export function addChildToParent(parent, child) {
    if (parent.add_actor)
        parent.add_actor(child);
    else if (parent instanceof St.Button || parent instanceof St.ScrollView)
        parent.set_child(child);
    else
        parent.add_child(child);
}

/**
 *
 * @param {St.ScrollView} scrollView
 * @description ScrollView.(hv)scroll was deprecated in GNOME 46.\
 *              Check which ScrollView property to use to maintain compatibility with GNOME 45 and 46.
 */
export function getScrollViewAdjustments(scrollView) {
    const hadjustment = scrollView.hadjustment ?? scrollView.hscroll.adjustment;
    const vadjustment = scrollView.vadjustment ?? scrollView.vscroll.adjustment;

    return {
        hadjustment,
        vadjustment,
    };
}

/**
 *
 * @param {boolean} vertical
 * @description GNOME 48 - St.BoxLayout uses 'orientation' instead of 'vertical'
 */
export function getOrientationProp(vertical) {
    if (ShellVersion >= 48)
        return {orientation: vertical ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL};
    else
        return {vertical};
}

export class SignalHandler {
    constructor() {
        this._connections = new Map();
    }

    connect(object, signal, callback) {
        const id = object.connect(signal, callback);
        this._connections.set(id, object);
        return id;
    }

    disconnect(id) {
        const object = this._connections.get(id);
        object.disconnect(id);
        this._connections.delete(id);
    }

    disconnectAll() {
        this._connections.forEach((object, id) => {
            object.disconnect(id);
        });
        this._connections.clear();
    }

    destroy() {
        this.disconnectAll();
        this._connections = null;
    }
}
