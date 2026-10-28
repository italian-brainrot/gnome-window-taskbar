# HACKING — fork notes

This is a fork of **App Icons Taskbar (aztaskbar) 31.4**, GPL-3.0-or-later,
Copyright azaech (https://gitlab.com/AndrewZaech/aztaskbar). `src/` is the
vendored upstream tree (commit 1 of history), and every change on top of it is a
named commit. Upstream is not tracked as a submodule, so rebasing on a new
aztaskbar release means re-vendoring and cherry-picking our commits.

## What the fork changes

1. **Identity** (`fork: rebrand…`): new uuid `windowtaskbar@italian-brainrot.github.io`,
   new settings schema `org.gnome.shell.extensions.windowtaskbar` (new dconf path,
   so the fork never touches aztaskbar's settings), upstream's update notifier
   removed (it asks for aztaskbar releases, which is meaningless for a fork), and the
   keys that went with it (`update-notifier-*`) out of the schema - along with
   `multi-window-indicator`, the boolean that switched the running/focused dash on:
   the fork always shows that dash on the window buttons, and only its style
   (`multi-window-indicator-style`) is a choice. Keys are dropped rather than left
   unused, because a prefs page full of options that do nothing is worse than a
   stale dconf entry.
2. **No grouping + window titles** (`windowButtons.js`): a `WindowsList`
   (`St.BoxLayout`) lives inside aztaskbar's `mainBox`, inserted right after the
   favourite `AppIcon`s. Every window on the current workspace (also minimized
   ones) gets one button: window icon + title + the aztaskbar indicator dash.
   `appIconsTaskbar._redisplay()` is patched so the list survives a redisplay and
   the grouped "running apps" list is skipped (`showRunningApps` forced to false;
   the `show-running-apps` key now shows/hides the window list instead).
3. **Favourites are launchers** (`appIcon.js`): a click on a favourite AppIcon
   always opens a new window (`favorites-always-new-window`, default true).
4. **Prefs** (`settings/generalPage.js`): "Window Buttons" group with title
   visibility, icon visibility, button width, title font size. Panel height stays
   on the existing Panel page (`main-panel-height`).

## Window button behaviour

* left click: raise/activate; on the already-focused, unminimized window: minimize
* middle click / shift+click: close the window
* right click: window menu (Minimize, Maximize, Keep above, Move to this workspace, Close)
* scroll wheel over a button: cycle through the windows of this workspace
* ordering: `Meta.Window.get_stable_sequence()` (creation order)
* room: the titles give way to icons when the panel has no room for them, and the
  list never asks for more than the panel has - see "When the panel runs out of room"

## New gsettings keys

`window-labels`, `window-labels-auto-hide` (titles give way to icons when the room
per window is too small), `window-title-max-chars` (0 = the whole title),
`window-button-icons`, `window-button-width` (a maximum; 0 = no cap),
`window-label-font-size` (0 = panel default), `favorites-always-new-window`.

## API notes (verified on the host, not from memory)

* GNOME Shell 50.6, GJS 1.88, mutter 18 (`libmutter-18`), Bazzite 44 Silverblue.
* `Meta.Window` signals on this version: `focus`, `unmanaged`, `unmanaging`,
  `workspace-changed`, `raised`, `shown`, `configure`, `position-changed`,
  `size-changed` + `notify::` on the GObject properties (`title`, `minimized`,
  `demands-attention`, `skip-taskbar`, `above`, `maximized-*`).
  Verified with: `distrobox-host-exec env GI_TYPELIB_PATH=/usr/lib64/mutter-18 python3 -c …`
  (`Meta.Window.__info__.get_signals()`).
* `Meta.Display`: `window-created`, `restacked`, `notify::focus-window`,
  `window-entered-monitor`, `window-left-monitor`, `workareas-changed`.
* `Meta.Window`: `minimize()`, `unminimize()`, `maximize(Meta.MaximizeFlags.BOTH)`,
  `unmaximize()`, `is_maximized()`, `delete(time)`, `change_workspace()`,
  `get_stable_sequence()`. No `change_max_state` on this version.
* The shell's own JS sources of this exact build can be extracted for reference:
  `objcopy --dump-section .gresource.shell_js_resources=shell.gresource
   /usr/lib64/gnome-shell/libshell-18.so /dev/null` then
  `gresource list shell.gresource` / `gresource extract shell.gresource <path>`.
* `org.gnome.Shell.Eval` is refused (unsafe-mode is off, and Wayland can not
  restart the shell in place), so errors are read from the journal:
  `scripts/logs.sh`.
* The same refusal is what makes `global.context.unsafe_mode` the only way to get
  `Eval` (it is set from Looking Glass, or from `Eval` itself - no use from outside),
  and no signal of Clutter's can be reached from outside the shell either: what is
  readable from a container is the journal, the gsettings, and the extension
  directories on disk.
* **An extension's code is imported once per shell session.** The shell does
  `await import(extensionJs.get_uri())` (extensionSystem.js, `_callExtensionInit`) and
  notes `extension.isImported = true` - a plain GJS module import, with no cache
  buster in the URI, so the module cache answers for the rest of the session.
  Consequences, both verified on this host:
  - a fresh install needs a session restart to be imported at all (the extension
    directory scan is a second, earlier gate: see "Dev loop");
  - `gnome-extensions disable` + `enable` re-runs `disable()`/`enable()` - it rebuilds
    the actors, it does *not* load edited files. `scripts/install.sh` therefore
    installs the code for the *next* session, and the only in-session reload there is
    is the dev loader, whose iteration directories are new module URIs;
  - because the class names of an already-imported module stay registered, a copy of
    the tree loaded next to it has to rename them (`dev/rename_classes.py`).
* `St.ThemeNode` is readable from JS and is how the theme's numbers are got at
  honestly: `get_padding(side)`, `get_border_width(side)`, `get_margin(side)`,
  `get_min_width()`, `get_max_width()` (verified against the `St-18` typelib; St lives
  in `/usr/lib64/gnome-shell/`, so `GI_TYPELIB_PATH` and `LD_LIBRARY_PATH` both have
  to point there for a host `gjs` to load it).
* Clutter 18 (mutter 18) actor signals, from the same typelib: `allocate`,
  `queue-relayout`, `destroy`, the button/scroll/motion events. There is **no**
  `size-change` any more, and `Clutter.init()` does not exist either - the Clutter
  context belongs to mutter, so St cannot be run standalone to measure the theme's
  numbers: they have to be read inside the shell.

## Size requests: these can kill the session

A Clutter container that has to fit a child whose **minimum** size is bigger
than its **natural** size does not warn politely: it asserts
(`ClutterBoxLayout child ... natural width: 140 < minimum 220`) and the shell
aborts with SIGABRT, taking the session with it - and the login after that
starts with *every* user extension disabled, because mutter finds
`gnome-shell-disable-extensions` in the runtime directory and sets
`disable-user-extensions=true` in `org.gnome.shell`. A rejected property value
(`value "-1" is invalid or out of range for property 'min-height'`) is the same
class of mistake.

* Do not set `min_width`/`min_height` on a taskbar child: `WindowButton`
  applies the width preference as `max_width` on the label plus a small
  `min_width` (so the button fits the title, is capped there and shrinks with
  the panel), and `updateStyle()` re-checks min <= natural afterwards and drops
  the request when that does not hold.
* `scripts/treeshow.py` marks an actor with `min > natural` in the dump, and
  `scripts/hotreload.sh` greps the journal for those complaints right after a
  reload and unloads the build again (writing `build/dev/FAILED`).
* If a session ever comes back with all extensions off, that key is the switch:
  `dconf write /org/gnome/shell/disable-user-extensions false` turns it off
  live (the shell watches it), and the user's own `enabled-extensions` list is
  left alone by the crash mitigation.
* `add_child` refuses a child that still has a parent (Clutter asserts, and the
  request is dropped), so moving the window list between panel boxes means
  removing it from its old parent first.
* Clutter 14 has no `get_natural_width()`: measure sizes with
  `get_preferred_width(-1)`, which returns `[min, natural]`.

## Where the window list lives, and how much room titles have

The shell (and aztaskbar, which copies it) allocates the panel's left and right
boxes the *same* width, so the centre box stays centred: `sideWidth = (panel -
centreBox) / 2`. A taskbar in the left box is therefore capped at half the
monitor, and with a dozen favourites plus a few windows the window titles
collapsed to a few characters. So the window list (`WindowsList`) reparents
itself into the panel's **centre box** (`_placeInPanel`), where the room between
the favourites and the status area is, and shares that room out:

* `_roomWidth()` asks the panel that does the allocating - the two panels leave
  different amounts of room, and the list has to know what it is going to get:
  on the primary monitor (where the fork does not build a panel) it is the
  shell's own panel, `monitor.width - 2 * max(leftBox, rightBox)` natural widths,
  exactly what the centre box may take without squeezing the clock; on every other
  monitor it is the fork's own panel, which does *not* keep the two side boxes the
  same width (its `vfunc_allocate` hands a box the room the other one does not
  need), so there `Panel.centerBoxRoom()` says what the panel can spare: its width,
  less what both side boxes insist on keeping, less the rest of the centre box
  (the date menu lives in that box). Guessing the symmetric formula over there
  sizes the list to something other than what it is allocated, and the panel then
  hands a side box less than that box asks for - the favourites get clipped, not the
  titles, and the layout numbers in `scripts/dump.sh` start lying;
* each button's width cap = `window-button-width` preference, or the room
  divided by the number of windows, whichever is smaller (`_shareRoom`), so many
  windows means ellipsized titles rather than a squeezed status area;
* a blank tail (`_spacer`, a fixed `width` and nothing more) brings the list's
  natural width up to the full room, so the buttons do not jump as windows come and
  go - and it is always the *last* child: `redisplay` inserts the buttons at their
  own index instead of appending, which would put the tail in front of the buttons
  and hand the unused room to the middle of the taskbar.

Numbers from a 1920 px panel (2560x1600 at 1.333x): left box 308 px (Show-Apps +
10 favourite icons at 16 px), centre box 1056 px, right box 432 px (clock, quick
settings). The window list gets the full 1056 px.

## When the panel runs out of room

Too many windows and a naive taskbar pushes the favourites and the status area off
the monitor: the shell allocates the centre box exactly the natural width it is
asked for (`#panel vfunc_allocate` in the shell's own panel.js - `sideWidth =
(panel - centreBox) / 2`, and each side box then gets `min(sideWidth, its natural)`),
so a window list that asks for more than the room makes the side boxes narrower than
their own content, and the clock and quick settings are laid out past the edge of the
screen. Everything here therefore works off the room the centre box has
(`_roomWidth`) and off what the buttons *actually* ask for:

* **measured, not assumed**: what a row costs is its buttons plus the row's own
  padding, border and spacing (`_rowPaddingBorder`, `_rowChrome`) plus what the theme
  spends around each button (`WindowButton.themeChrome`, which reads the padding and
  the border off the theme node). These numbers are not knowable from the fork's own
  stylesheet: `#panel .panel-button` (an id selector, so it outranks our class) puts a
  3px border on every panel button, and the box around the list is a CSS margin, which
  is not part of the width the list reports for itself. The constants are only a
  fallback for the pass with no theme node to read.
* **room per window**: `_shareRoom` divides what the room leaves over by the number of
  buttons, and that is what each button may ask for at most (`window-button-width`
  stays the cap it shares, so the preference is never what overflows).
* **the row is measured after it is styled**: `_rowWidth` adds up what the buttons
  really request. If that is more than the room, the pass does not simply accept it -
  it works down, and it only ever works *down*:
  1. **the titles give way to icons** (`window-labels-auto-hide`; nothing gives way
     when `window-button-icons` is off, because there would be nothing left to show),
     and
  2. **the row stops at the last button the room holds** (`_fitsCount` on the measured
     widths; the buttons past it are hidden, and hidden children ask for nothing).
     The windows left over are the overview's business.
* **a limit on how many buttons there are**: `_maxButtonCount` works out how many
  buttons the room can hold at their smallest (icons only) and `redisplay` stops
  adding buttons past that. It is the cheap first cut; the measured `_fitsCount` above
  is what decides, so an estimate that is a button too generous costs a hidden button
  at the end of the row, not the clock.

  Both are limits on the *count*, not caps on what the list asks for, and that
  distinction is the whole point: capping the list below the minimum its buttons must
  have is the one request Clutter does not forgive ("natural width ... < minimum"
  aborts the shell, which is how a session was lost before). A *maximum* on the title
  (`max_width`) is fine; a *minimum* on that same label is fatal. A scroll wrapper was
  tried instead of the count limit and is out: the wrapper would be the list's parent,
  and a child tearing down its own parent aborts the shell (see "Tearing down"
  below). A wrapper the fork owns outright could be added back, but it has to be
  tested against a real disable.

* **the room is re-measured when it moves**: the room is what the panel's side boxes
  are not using, and they change on their own account - the clock's text, the message
  indicator, another extension's tray icons. `_watchPanelRoom` listens for a relayout
  of either side box and re-shares the room when the measured room has actually moved
  (the comparison is what keeps the relayout our own pass causes from feeding the
  loop). Clutter 18 has no `size-change` signal any more - the typelib knows `allocate`
  and `queue-relayout` only.

* **a setting change is a redisplay, not a restyle**: the buttons are styled by the
  same pass that works the room out, because styling them straight from the settings
  signal hands the panel a row of uncapped buttons for the 30 ms before the next
  `_shareRoom`.

The title is cut to `window-title-max-chars` characters before the layout sees it,
which is what stops a browser with a long tab title in it from making the buttons
enormous. Clutter never gets a minimum on the label, only a maximum: a box child
that asks for more than it can get is fatal, and that is covered above in "Size
requests: these can kill the session".

## Style writes to an actor that has no panel yet

The window list is created before it has a panel to sit in (`AppIconsTaskbar` builds
it, and `_placeInPanel` is what puts it in a centre box). Writing a `style` to an actor
that is not on the stage makes St shout `st_widget_get_theme_node called on the widget
… which is not in the stage` - the answer is a NULL theme node, so nothing breaks, but
it is this fork's own signature in the journal, six entries deep, at every session
start, and `scripts/hotreload.sh` used to grep right past it.

So the list measures and styles itself only while it is on the stage: `_isStaged()`
checks that, `updateStyle()` and `_shareRoom()` skip the pass when it is not, and
`_placeInPanel()` makes the writes again the moment there is a panel to hold them.
`_naturalWidth()` has the same guard for the measuring side.

## The window menu, and a window that goes away

The items of the window button's menu capture the `Meta.Window`, and a window can be
closed - by its own application, or from the keyboard - while that menu is open.
There is no `is_destroyed` in the `Meta.Window` API of mutter 18 to ask with
(verified with introspection, see the API notes above), so the button keeps the state
itself: `unmanaging` fires while the window is still reachable, and it sets
`_windowGone` and closes the menu. Every menu action (`_menuItem`) and every click
(`_activate`, the middle-click close) is a no-op after that. The button is destroyed
one signal later, on `unmanaged`, and something that fires in between still holds this
window - which is why closing the menu is not the whole guard.

## Tearing down: never destroy the panel item from the list's own teardown

`clutter_actor_destroy_all_children` aborts the shell (the assertion
`self->priv->n_children < prev_n_children`, followed by a `Bail out!` and a
session) when an actor's teardown destroys an *ancestor* of itself: Clutter walks
the children and expects their number to drop, and an unparenting from inside that
walk does not make it drop. Concretely: do not call `parent.destroy()` from the
child's `destroy` handler. Whoever owns the panel item does the destroying, in
`AppIconsTaskbar._destroy()`, and the list's own `_destroy()` only disconnects
signals and drops its own references.

That is why the window list has no `St.ScrollView` wrapper at the moment: the
wrapper would be the list's parent, and a wrapper owned by the list is exactly the
setup that aborted twice. A scroll wrapper that is safe to teardown can be added
back when the fork owns it outright (and it has to be tested against a *real*
disable, not a reload of a dev build).

## Dev loop

GNOME Shell 50.6 scans extension dirs **once, at session start**
(`ExtensionManager._loadExtensions()`), and it never rescans: there is no rescan
D-Bus method, and `gnome-extensions install` only drops files in place. Worse, an
extension whose `extension.js` failed to import keeps the failed module in the
GJS module cache for the rest of the session, so even a fixed copy is not
re-imported. Both problems mean: touching a *new* uuid or fixing an import error
needs a session restart.

So instead of restarting the session per code change there is the dev loader below.
Know its price first: every iteration loads another taskbar instance into the *live*
session, and a bad size request or a broken teardown takes the shell - and with it
the session - down. It happened repeatedly in this harness, and the complaint "the
dev loader keeps crashing me out, I disabled it" is fair. The loader is not part of
the shipped product, so it should be set up only when it is actually needed and
taken away again as soon as the round of checking is done.

```
scripts/dev-setup.sh        # sets it up: installs windowtaskbar-dev@local (a
                            # loader whose extension.js only imports the code in
                            # build/dev/iterN/); needs ONE session restart
scripts/dev-teardown.sh     # and takes it away again (disable, then remove the
                            # directory) so the session is not asked to load it
scripts/hotreload.sh        # build an iteration + reload it live - risky: another
                            # instance goes into the running session
scripts/logs.sh 300         # read shell/daemon errors from the host journal
```
```

### Looking at what is on screen

There is no `org.gnome.Shell.Eval` (unsafe mode is off, and a Wayland session
cannot restart the shell in place), so the harness asks the shell itself:

```
scripts/dump.sh             # dev/probe.js writes build/dev/dump.json: the live
                            # actor tree (size, min/natural, on-screen position,
                            # min>nat marker), gsettings, Meta window details
python3 scripts/treeshow.py # a readable summary of that dump
scripts/shot.sh             # a screenshot -> build/shot.png
python3 scripts/pview.py    # crop the panel band -> build/panel.png (--runs, --box=)
scripts/devclick.sh 'Brave' # run a window button's click handler from the probe
```

Why those routes and not the obvious ones: the screenshot D-Bus service refuses a
container client (its `DBusSenderChecker` allowlist is gsd-media-keys and the
portal), and `xdotool` over XWayland delivers input to X clients, never to
mutter's keybindings, so `Print` did nothing. `dev/probe.js` calls
`Shell.Screenshot.composite_to_stream` the way the shell's own screenshot UI
does, which needs no permission and writes `build/dev/shot.png`. Mouse clicks
cannot be injected into the shell at all, so `devclick.sh` calls the button's
handler (`_onClick`, `_activate`, `_popupMenu`) from inside the shell and reports
how the window state changed - which is also how the click behaviour is tested.

The loader (`dev/loader.js`) reads `build/dev/current` (an iteration number),
imports `build/dev/iterN/extension.js` from that directory, and passes metadata
with `dir`/`path` of the iteration directory so the fork finds its own schemas.

`dev/rename_classes.py` appends the iteration number to every GObject class name
in the copied tree. This is required, not cosmetic: GJS registers a GType
(`Gjs_Foo`) per JS class name and refuses a second registration of the same name,
so without unique names the reloaded copy fails with `Type name Gjs_Foo is
already registered`. 38 names are uniquified per iteration; the renamed tree is
still valid JavaScript.

The loader extension itself never changes code, so its own import is cached and
unproblematic. To ship: `scripts/install.sh` (real uuid `windowtaskbar@…`), and
after the next session restart both the fork and the dev loader are usable.

An enable that throws used to leave the half-built instance's actors in the panel
(two taskbars side by side competing for the same 960 px, which makes the layout
numbers lie): `dev/loader.js` tears the instance down again when `enable()`
throws, and `dev/probe.js` removes panel children whose GObject type name ends
with the number of an older iteration.

## Shipping it: what `scripts/install.sh` does, and what it does not

```
scripts/install.sh            # build + copy into ~/.local/share/gnome-shell/extensions
scripts/install.sh disable    # and take it out of the session
scripts/install.sh prefs      # the preferences window
```

The install is a plain copy, never `gnome-extensions pack`: `pack` honours the
repository's `.gitignore` and drops most of our files. What reloads the extension in
the running shell is the `gnome-extensions disable`/`enable` pair - and there is
deliberately no `ReloadExtension` D-Bus call in the script. When no
`org.gnome.Shell.Extensions` instance is running, that call *activates* one, and the
request lands on an instance that has not exported its interface yet: it answers
`Missing handler for DBus method ReloadExtension`, and the reload never happens (the
failure was hidden behind an `|| true` the whole time). Do not add it back.

The three steps by hand, on a machine that does not run this repository:

1. copy `dist/<uuid>/` (or `src/`, built with `scripts/build.sh`) to
   `~/.local/share/gnome-shell/extensions/<uuid>/` - the uuid is in `src/metadata.json`
   and the directory must be called that, or the shell will not find the schema;
2. make sure `schemas/gschemas.compiled` is there (it is a binary, and the Extensions
   app reads the keys through it - `glib-compile-schemas <that schemas directory>`
   if it is missing);
3. log out and back in (GNOME Shell scans extension directories at session start
   only), then enable it: the Extensions app, or
   `gnome-extensions enable <uuid>` from a shell in the session.
