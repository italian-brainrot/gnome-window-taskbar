// Dev-only check of the row's reorder arithmetic (windowButtons.js: _dropIndex,
// _moveButton, _commitOrder, handleDragOver, acceptDrop, _compareWindows).
//
// Drag & drop is the one part of the taskbar the live harness cannot drive: no
// pointer events reach the shell (HACKING.md, "Looking at what is on screen"),
// and the dev loader is not worth the risk of a crashed session for an index
// that is off by one. So the methods are read out of the source and run against
// fake children: what is checked is the arithmetic - which button the pointer is
// over, where a button lands, which order a drop leaves behind - not Clutter.
//
//   node dev/reorder-check.mjs [path-to-windowButtons.js]
//
// It is a text extraction on purpose: the methods under test are not exported
// from a module the shell does not import outside the shell (windowButtons.js
// imports resource:///org/gnome/shell/...). If a method is renamed or indented
// differently, this says so rather than quietly checking nothing.

import fs from 'node:fs';
import path from 'node:path';

const SOURCE = process.argv[2] ??
    path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src', 'windowButtons.js');
const src = fs.readFileSync(SOURCE, 'utf8');

/** The source of one method of the list, by name (four-space indented). */
function extract(name) {
    const start = src.indexOf(`\n    ${name}(`);
    if (start < 0)
        throw new Error(`${name} not found in ${SOURCE} - the check is out of date`);

    let i = src.indexOf('{', start);
    let depth = 0;
    for (;; i++) {
        if (src[i] === '{')
            depth++;
        else if (src[i] === '}' && --depth === 0)
            break;
    }
    return src.slice(start, i + 1);
}

// The window button class and DND are only there to satisfy the guards the
// methods start with; the drag itself is not simulated.
class WindowButton {
}

const DND = {
    DragMotionResult: {NO_DROP: 0, COPY_DROP: 1, MOVE_DROP: 2, CONTINUE: 3},
};

const methods = Object.entries(
    new Function('WindowButton', 'DND', 'global',
        `return {${['handleDragOver', 'acceptDrop', '_dropIndex', '_moveButton',
            '_commitOrder', '_compareWindows', '_pruneOrder']
            .map(extract).join(',')}};`)(WindowButton, DND, {
            // a window that is gone has no actor left (HACKING.md, "API notes":
            // mutter 18 has no is_destroyed to ask a window with)
            get_window_actors: () => aliveActors,
        }),
);

class MetaWindow {
    constructor(name, seq) {
        this.name = name;
        this._seq = seq;
    }

    get_stable_sequence() {
        return this._seq;
    }
}

let aliveActors = [];

class Button extends WindowButton {
    constructor(name, list) {
        super();
        this.label = name;
        this.metaWindow = new MetaWindow(name, 0);
        this._list = list;
        this.visible = true;
        this.allocation = {x1: 0, x2: 0};
    }
}

/** A window list: buttons at BUTTON_WIDTH each, and the blank tail at the end. */
class List {
    constructor(names) {
        this._children = names.map(name => new Button(name, this));
        this._spacer = {label: 'tail'};
        this._children.push(this._spacer);
        this._order = [];
        for (const [name, method] of methods)
            this[name] = method;
        this.layout();
    }

    layout() {
        const BUTTON_WIDTH = 100, SPACING = 10, PADDING = 9;
        let x = PADDING;
        for (const child of this._children) {
            child.allocation = {x1: x, x2: x + (child === this._spacer ? 200 : BUTTON_WIDTH)};
            x += BUTTON_WIDTH + SPACING;
        }
    }

    get_children() {
        return [...this._children];
    }

    remove_child(child) {
        const i = this._children.indexOf(child);
        if (i < 0)
            throw new Error('remove_child: not a child');
        this._children.splice(i, 1);
    }

    insert_child_at_index(child, index) {
        if (this._children.includes(child))
            throw new Error('insert_child_at_index: Clutter refuses an attached child');
        this._children.splice(Math.min(index, this._children.length), 0, child);
    }

    /** The row as it is laid out, titles and the blank tail. */
    row() {
        return this.get_children().map(c => c.label).join(' ');
    }
}

let failures = 0;
function check(what, got, want) {
    const ok = String(got) === String(want);
    if (!ok)
        failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}: ${got}${ok ? '' : `  (want ${want})`}`);
}

const row = (list, x) => (list.handleDragOver(list._children[0], null, x), list.row());

// --- where a drop lands ----------------------------------------------------
let l = new List(['A', 'B', 'C']);
check('A past the middle of B', row(l, 175), 'B A C tail');
check('  ... the order it commits', (l._commitOrder(), l._order.map(w => w.name).join('')), 'BAC');
check('A on its own middle stays', row(new List(['A', 'B', 'C']), 55), 'A B C tail');
check('A before the middle of B stays', row(new List(['A', 'B', 'C']), 115), 'A B C tail');
check('C at the front', (l = new List(['A', 'B', 'C']), l.handleDragOver(l._children[2], null, 10), l.row()), 'C A B tail');
check('A into the blank tail', row(new List(['A', 'B', 'C']), 420), 'B C A tail');
check('B onto the first button', (l = new List(['A', 'B', 'C']), l.handleDragOver(l._children[1], null, 12), l.row()), 'B A C tail');

// the buttons the room has no space for (hidden, no allocation to trust) stay
// behind the ones it has, instead of swapping with the dragged one
l = new List(['A', 'B', 'C', 'D']);
l._children[3].visible = false;
check('A past the last shown button', row(l, 900), 'B C A D tail');
check('  ... and the hidden one is kept', (l._commitOrder(), l._order.map(w => w.name).join('')), 'BCAD');
l = new List(['A', 'B', 'C', 'D']);
l._children[3].visible = false;
check('A on the right edge of C', row(l, 320), 'B C A D tail');

// --- whose drag this is ----------------------------------------------------
l = new List(['A', 'B']);
check('an app dragged over the row', l.handleDragOver({app: {}}, null, 20), DND.DragMotionResult.CONTINUE);
check('  ... is not accepted here', l.acceptDrop({app: {}}, null, 20), false);
const otherList = new List(['A']);
const foreign = new WindowButton();
foreign._list = otherList;
l = new List(['A', 'B']);
check("another monitor's button", l.handleDragOver(foreign, null, 20), DND.DragMotionResult.CONTINUE);
check('this row\'s button', l.handleDragOver(l._children[0], null, 20), DND.DragMotionResult.MOVE_DROP);
check('  ... and the drop is accepted', l.acceptDrop(l._children[0], null, 20), true);

// --- the order the row keeps ----------------------------------------------
const w = (name, seq) => new MetaWindow(name, seq);
l = new List([]);
const [a, b, c, d] = [w('A', 1), w('B', 2), w('C', 3), w('D', 4)];
const sorted = windows => [...windows].sort((x, y) => l._compareWindows(x, y)).map(x => x.name).join('');

l._order = [];
check('nobody has dragged: creation order', sorted([c, b, a]), 'ABC');
l._order = [c, a, b];
check('the dragged places win', sorted([a, b, c]), 'CAB');
check('a new window waits at the end', sorted([d, b, c, a]), 'CABD');
l._order = [c];
check('some windows have a place, the rest do not', sorted([a, d, c, b]), 'CABD');
l._order = [];
check('an empty order is creation order again', sorted([c, b, a]), 'ABC');

// --- what the order forgets ------------------------------------------------
aliveActors = [{metaWindow: a}, {metaWindow: c}];
l._order = [c, a, b];
l._pruneOrder();
check('a window with no actor (closed) is dropped', l._order.map(x => x.name).join(''), 'CA');
check('  ... and the others keep their places', sorted([a, c]), 'CA');
l._order = [];
l._pruneOrder();
check('nothing to prune stays nothing to prune', l._order.length, 0);

console.log(failures ? `\n${failures} FAILING` : '\nall good');
if (failures)
    throw new Error('reorder check failed');
