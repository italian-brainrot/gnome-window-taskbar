import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {DateMenuButton} from 'resource:///org/gnome/shell/ui/dateMenu.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {TaskbarManager} from './taskbarManager.js';
import * as Utils from './utils.js';

const [ShellVersion] = Config.PACKAGE_VERSION.split('.').map(s => Number(s));

export const PanelBox = GObject.registerClass(
class azTaskbarPanelBox extends St.BoxLayout {
    _init(monitor) {
        super._init({
            name: 'panelBox',
            ...Utils.getOrientationProp(true),
        });

        this.monitor = monitor;
        this.panel = new Panel(monitor);
        this.add_child(this.panel);

        Main.layoutManager.addChrome(this, {
            affectsStruts: true,
            trackFullscreen: true,
        });
    }

    get index() {
        return this.monitor.index;
    }
});

export const Panel = GObject.registerClass(
class azTaskbarPanel extends St.Widget {
    _init(monitor) {
        super._init({
            name: 'panel',
            style_class: 'panel azTaskbar-panel',
            reactive: true,
        });

        this.set_offscreen_redirect(Clutter.OffscreenRedirect.ALWAYS);

        this.statusArea = {};

        this.monitor = monitor;

        this._leftBox = new St.BoxLayout({name: 'panelLeft'});
        this.add_child(this._leftBox);
        this._centerBox = new St.BoxLayout({name: 'panelCenter'});
        this.add_child(this._centerBox);
        this._rightBox = new St.BoxLayout({name: 'panelRight'});
        this.add_child(this._rightBox);

        this.connect('button-press-event', this._onButtonPress.bind(this));
        this.connect('touch-event', this._onTouchEvent.bind(this));

        this.menuManager = new PopupMenu.PopupMenuManager(this);

        this.width = this.monitor.width;

        const {statusArea} = Main.panel;
        const {quickSettings} = statusArea;
        const {activities} = statusArea;

        this._setPanelMenu('quickSettings', quickSettings.constructor, this._rightBox);
        this._setPanelMenu('dateMenu', DateMenuButton, this._centerBox);
        this._setPanelMenu('activities', activities.constructor, this._leftBox);
    }

    vfunc_get_preferred_width(_forHeight) {
        if (this.monitor)
            return [0, this.monitor.width];

        return [0, 0];
    }

    vfunc_allocate(box) {
        this.set_allocation(box);

        const allocWidth = box.x2 - box.x1;
        const allocHeight = box.y2 - box.y1;

        const [, leftNaturalWidth] = this._leftBox.get_preferred_width(-1);
        const [, centerNaturalWidth] = this._centerBox.get_preferred_width(-1);
        const [, rightNaturalWidth] = this._rightBox.get_preferred_width(-1);

        const centerWidth = centerNaturalWidth;

        // get workspace area and center date entry relative to it
        const monitor = Main.layoutManager.findMonitorForActor(this);
        let centerOffset = 0;
        if (monitor) {
            const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
            centerOffset = 2 * (workArea.x - monitor.x) + workArea.width - monitor.width;
        }

        const sideWidth = Math.max(0, (allocWidth - centerWidth + centerOffset) / 2);

        const childBox = new Clutter.ActorBox();

        childBox.y1 = 0;
        childBox.y2 = allocHeight;
        if (this.get_text_direction() === Clutter.TextDirection.RTL) {
            childBox.x1 = Math.max(allocWidth - Math.min(Math.floor(sideWidth),
                leftNaturalWidth), 0);
            childBox.x2 = allocWidth;
        } else {
            childBox.x1 = 0;
            childBox.x2 = Math.min(Math.floor(sideWidth),
                leftNaturalWidth);
        }
        this._leftBox.allocate(childBox);

        childBox.x1 = Math.ceil(sideWidth);
        childBox.y1 = 0;
        childBox.x2 = childBox.x1 + centerWidth;
        childBox.y2 = allocHeight;
        this._centerBox.allocate(childBox);

        childBox.y1 = 0;
        childBox.y2 = allocHeight;
        if (this.get_text_direction() === Clutter.TextDirection.RTL) {
            childBox.x1 = 0;
            childBox.x2 = Math.min(Math.floor(sideWidth),
                rightNaturalWidth);
        } else {
            childBox.x1 = Math.max(allocWidth - Math.min(Math.floor(sideWidth),
                rightNaturalWidth), 0);
            childBox.x2 = allocWidth;
        }
        this._rightBox.allocate(childBox);
    }

    _tryDragWindow(event) {
        if (Main.modalCount > 0)
            return Clutter.EVENT_PROPAGATE;

        const targetActor = global.stage.get_event_actor(event);
        if (targetActor !== this)
            return Clutter.EVENT_PROPAGATE;

        const [x, y] = event.get_coords();
        const dragWindow = this._getDraggableWindowForPosition(x);

        if (!dragWindow)
            return Clutter.EVENT_PROPAGATE;

        const positionHint = new Graphene.Point({x, y});

        if (ShellVersion >= 49) {
            const backend = global.stage.get_context().get_backend();
            const sprite = backend.get_sprite(global.stage, event);
            return dragWindow.begin_grab_op(
                Meta.GrabOp.MOVING,
                sprite,
                event.get_time(),
                positionHint) ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        } else if (ShellVersion >= 46) {
            return dragWindow.begin_grab_op(
                Meta.GrabOp.MOVING,
                event.get_device(),
                event.get_event_sequence(),
                event.get_time(),
                positionHint) ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        } else {
            return dragWindow.begin_grab_op(
                Meta.GrabOp.MOVING,
                event.get_device(),
                event.get_event_sequence(),
                event.get_time()) ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        }
    }

    _onButtonPress(actor, event) {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;

        return this._tryDragWindow(event);
    }

    _onTouchEvent(actor, event) {
        if (event.type() !== Clutter.EventType.TOUCH_BEGIN)
            return Clutter.EVENT_PROPAGATE;

        return this._tryDragWindow(event);
    }

    vfunc_key_press_event(keyEvent) {
        const symbol = keyEvent.keyval;
        if (symbol === Clutter.KEY_Escape) {
            global.display.focus_default_window(keyEvent.time);
            return Clutter.EVENT_STOP;
        }

        return super.vfunc_key_press_event(keyEvent);
    }

    _addToPanelBox(role, indicator, position, box) {
        const container = indicator.container;

        const parent = container.get_parent();
        if (parent)
            parent.remove_child(container);

        box.insert_child_at_index(container, position);
        if (indicator.menu)
            this.menuManager.addMenu(indicator.menu);
        this.statusArea[role] = indicator;
        const destroyId = indicator.connect('destroy', emitter => {
            delete this.statusArea[role];
            emitter.disconnect(destroyId);
        });
    }

    addToStatusArea(role, indicator, position, box) {
        if (this.statusArea[role])
            throw new Error(`Extension point conflict: there is already a status indicator for role ${role}`);

        if (!(indicator instanceof PanelMenu.Button))
            throw new TypeError('Status indicator must be an instance of PanelMenu.Button');

        position ??= 0;
        const boxes = {
            left: this._leftBox,
            center: this._centerBox,
            right: this._rightBox,
        };
        const boxContainer = boxes[box] || this._rightBox;
        this.statusArea[role] = indicator;
        this._addToPanelBox(role, indicator, position, boxContainer);
        return indicator;
    }

    _getDraggableWindowForPosition(stageX) {
        const workspaceManager = global.workspace_manager;
        const windows = workspaceManager.get_active_workspace().list_windows();
        const allWindowsByStacking =
            global.display.sort_windows_by_stacking(windows).reverse();

        return allWindowsByStacking.find(metaWindow => {
            const rect = metaWindow.get_frame_rect();
            return metaWindow.get_monitor() === this.monitor.index &&
                metaWindow.showing_on_its_workspace() &&
                metaWindow.get_window_type() !== Meta.WindowType.DESKTOP &&
                metaWindow.maximized_vertically &&
                stageX > rect.x && stageX < rect.x + rect.width;
        });
    }

    // Credit: Dash to Panel https://github.com/home-sweet-gnome/dash-to-panel
    _setPanelMenu(propName, constr, container) {
        if (!this.statusArea[propName]) {
            this.statusArea[propName] = this._getPanelMenu(propName, constr);
            this.menuManager.addMenu(this.statusArea[propName].menu);
            container.insert_child_at_index(this.statusArea[propName].container, 0);
        }
    }

    // Credit: Dash to Panel https://github.com/home-sweet-gnome/dash-to-panel
    _removePanelMenu(propName) {
        if (this.statusArea[propName]) {
            const parent = this.statusArea[propName].container.get_parent();
            if (parent)
                parent.remove_child(this.statusArea[propName].container);

            // calling this.statusArea[propName].destroy(); is buggy for now, gnome-shell never
            // destroys those panel menus...
            // since we can't destroy the menu (hence properly disconnect its signals), let's
            // store it so the next time a panel needs one of its kind, we can reuse it instead
            // of creating a new one
            const panelMenu = this.statusArea[propName];

            this.menuManager.removeMenu(panelMenu.menu);
            TaskbarManager.persistentStorage[propName].push(panelMenu);
            this.statusArea[propName] = null;
        }
    }

    // Credit: Dash to Panel https://github.com/home-sweet-gnome/dash-to-panel
    _getPanelMenu(propName, constr) {
        TaskbarManager.persistentStorage[propName] = TaskbarManager.persistentStorage[propName] || [];

        if (!TaskbarManager.persistentStorage[propName].length)
            TaskbarManager.persistentStorage[propName].push(new constr(this));

        return TaskbarManager.persistentStorage[propName].pop();
    }

    disable() {
        this._removePanelMenu('quickSettings');
        this._removePanelMenu('activities');
        this._removePanelMenu('dateMenu');
    }
});
