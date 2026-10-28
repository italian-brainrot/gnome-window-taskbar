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
            '_commitOrder', '_compareWindows', '_pruneOrder', '_isSpacer', '_slot',
            '_indexOf', '_keepEnds']
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

/**
 * A window list: buttons at BUTTON_WIDTH each, and the two blank ends the real
 * row has (windowButtons.js _spacerLead / _spacer). `lead` is the width of the
 * blank end in front of the buttons, which is what centres the row; 0 means the
 * buttons fill the row, which is the case the x values below are written for.
 */
class List {
    constructor(names, lead = 0) {
        this._children = names.map(name => new Button(name, this));
        this._spacerLead = {label: 'lead', visible: true};
        this._spacer = {label: 'tail', visible: true};
        this._children.unshift(this._spacerLead);
        this._children.push(this._spacer);
        this._leadWidth = lead;
        this._order = [];
        for (const [name, method] of methods)
            this[name] = method;
        this.layout();
    }

    _widthOf(child) {
        if (child === this._spacerLead)
            return this._leadWidth;
        if (child === this._spacer)
            return 200;
        return 100;
    }

    layout() {
        const SPACING = 10, PADDING = 9;
        let x = PADDING;
        for (const child of this._children) {
            const width = this._widthOf(child);
            child.allocation = {x1: x, x2: x + width};
            // a shown child costs its width and the gap after it, blank ends
            // included - that is what _rowChrome counts
            x += width + SPACING;
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

    add_child(child) {
        if (this._children.includes(child))
            throw new Error('add_child: Clutter refuses an attached child');
        this._children.push(child);
    }

    get_n_children() {
        return this._children.length;
    }

    /** The row as it is laid out: both blank ends and the buttons between them. */
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

// the first button of the row: the child before it is the blank lead end
const first = list => list._children[1];
const row = (list, x) => (list.handleDragOver(first(list), null, x), list.row());

// --- where a drop lands ----------------------------------------------------
let l = new List(['A', 'B', 'C']);
check('A past the middle of B', row(l, 185), 'lead B A C tail');
check('  ... the order it commits', (l._commitOrder(), l._order.map(w => w.name).join('')), 'BAC');
check('A on its own middle stays', row(new List(['A', 'B', 'C']), 65), 'lead A B C tail');
check('A before the middle of B stays', row(new List(['A', 'B', 'C']), 125), 'lead A B C tail');
check('C at the front', (l = new List(['A', 'B', 'C']), l.handleDragOver(l._children[3], null, 10), l.row()), 'lead C A B tail');
check('A into the blank tail', row(new List(['A', 'B', 'C']), 430), 'lead B C A tail');
check('B onto the first button', (l = new List(['A', 'B', 'C']), l.handleDragOver(l._children[2], null, 22), l.row()), 'lead B A C tail');

// the blank lead end is not a drop target of its own: a drop inside it lands on
// the first button, and a button never moves in front of it (l._slot(0))
l = new List(['A', 'B', 'C'], 200);
check('A inside the lead end stays first', row(l, 100), 'lead A B C tail');
check('C inside the lead end goes first', (l = new List(['A', 'B', 'C'], 200), l.handleDragOver(l._children[3], null, 100), l.row()), 'lead C A B tail');
check('  ... and C onto the left half of B swaps them', (l = new List(['A', 'B', 'C'], 200), l.handleDragOver(l._children[3], null, 350), l.row()), 'lead A C B tail');

// the buttons the room has no space for (hidden, no allocation to trust) stay
// behind the ones it has, instead of swapping with the dragged one
l = new List(['A', 'B', 'C', 'D']);
l._children[4].visible = false;
check('A past the last shown button', row(l, 900), 'lead B C A D tail');
check('  ... and the hidden one is kept', (l._commitOrder(), l._order.map(w => w.name).join('')), 'BCAD');
l = new List(['A', 'B', 'C', 'D']);
l._children[4].visible = false;
check('A on the right edge of C', row(l, 330), 'lead B C A D tail');

// --- whose drag this is ----------------------------------------------------
l = new List(['A', 'B']);
check('an app dragged over the row', l.handleDragOver({app: {}}, null, 20), DND.DragMotionResult.CONTINUE);
check('  ... is not accepted here', l.acceptDrop({app: {}}, null, 20), false);
const otherList = new List(['A']);
const foreign = new WindowButton();
foreign._list = otherList;
l = new List(['A', 'B']);
check("another monitor's button", l.handleDragOver(foreign, null, 20), DND.DragMotionResult.CONTINUE);
check('this row\'s button', l.handleDragOver(first(l), null, 20), DND.DragMotionResult.MOVE_DROP);
check('  ... and the drop is accepted', l.acceptDrop(first(l), null, 20), true);

// --- the blank ends keep the ends ------------------------------------------
// (the split that centres the row is only a split if the blank ends are outside
// the buttons: a blank end between them hands the spare room to the middle)
check('a lead end pushed into the row comes back', (l = new List(['A', 'B']), l.remove_child(l._spacerLead), l.insert_child_at_index(l._spacerLead, 2), l._keepEnds(), l.row()), 'lead A B tail');
check('a tail end pushed into the row comes back', (l = new List(['A', 'B']), l.remove_child(l._spacer), l.insert_child_at_index(l._spacer, 1), l._keepEnds(), l.row()), 'lead A B tail');
check('  ... and the button order is untouched', (l = new List(['A', 'B']), l._keepEnds(), l._commitOrder(), l._order.map(w => w.name).join('')), 'AB');

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
