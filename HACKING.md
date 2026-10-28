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
* The typelibs of this build, for asking questions of them without a running shell:
  `Clutter-18` and `Meta-18` are in `/usr/lib64/mutter-18/` (with the libraries),
  `St-18` and `Shell-18` in `/usr/lib64/gnome-shell/`. A type's properties can be
  enumerated without a Clutter context - the host's `python3 -c` with `gi.repository.GIRepository`
  (`Repository.dup_default().require('Clutter', None, 0)`, then `find_by_name('Clutter',
  'Actor').get_property(i)`); instantiating an actor instead aborts on
  `_clutter_context_get_default`.
* **Clutter 18 has no `max-width`/`max-height` property.** The Actor's size properties
  are `width`/`height` (a fixed size: min and natural together), `min-width`/`min-height`
  and `natural-width`/`natural-height`, each with a `-set` companion. Two consequences:
  - assigning `max_width` to an actor is **silently doing nothing** (GJS puts an
    ordinary JS property on the wrapper when the GObject has no such property), which
    is why `WindowButton.updateStyle()` caps the title with `max_width` and the panel
    still measures the row at its full title widths - the cap that works is the
    measured row and the ellipsization, see "When the panel runs out of room";
  - `min-width`/`min-height` are not floors, they *are* the request when set: `0` on a
    label means the box may hand the label less than a line of it, and a large value
    is the "minimum bigger than what the box has" that Clutter answers by giving the
    child more than the box has (see "Size requests" and "The panel's height").
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

* The safe direction is one-way only: keep the *minimum* small and let the natural
  size be what the content asks for. `WindowButton` keeps `min_width`/`min_height` at 0
  on the label and the icon (in this Clutter those properties *are* the request, not a
  floor: 0 means the box may hand the child less than a line of it), and what gives way
  is the indicator strip (`_fitVertical`) or the button's own visibility - never a
  minimum the panel cannot pay. `max_width`/`max_height` are not properties of Clutter
  18 at all, so the assignments in `updateStyle()` that read like caps do nothing; the
  caps that work are the measured row and the label's ellipsization (see "When the
  panel runs out of room").
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

## The panel's height: the button has to fit inside the band

The width of the row has a budget (`_roomWidth`); so does the height, and it is the
panel's own. A titled button did not fit it - it hung off the bottom of the screen, and
a click near the bottom of the panel did nothing at all.

**The band the button has to fit is not the number `main-panel-height` says.**
`theming.updateStylesheet()` writes `.azTaskbar-panel {height: Npx}` - a class the
shell's panel is given (`Main.panel.add_style_class_name('azTaskbar-panel')`) - and the
theme writes `#panel {height: 2.2em}`, an id selector, which outranks it: the same fight
as `#panel .panel-button` under "When the panel runs out of room". So the height the
preference asks for never reaches the panel. A screenshot of the 2560 px-wide panel here
(`main-panel-height` 40, layout scale 1.333, so 1920 px logical) measures the band as
the last 40 device rows of the screen: the work area ends at y=1560 and the panel's
background runs to y=1599 - about 30 CSS px, not the 40 the preference asks for.

What a button costs vertically, in CSS px: a line of the panel's title font ~18 px, the
running/focused strip 8 px (`INDICATOR_HEIGHT`), `#panel .panel-button`'s 3 px border
per side, `.azTaskbar-BaseIcon`'s 3 px of padding and 2 px of margin per side -
**18 + 8 + 6 + 6 + 4 = 42 px against a band of ~30 px**. Icons-only buttons (16 px
instead of a title) fit; a title does not, which is why the bug is a bug of "the buttons
with titles".

A box layout does not shrink a child below its *minimum*, it hands over the larger
number, so the button was allocated its full ~42 px starting just below the top of the
band and its bottom was off the screen. The screenshot says so: the `:active` pill of a
window button has its rounded top at y=1564, straight sides to y=1599 and no curve at
the bottom, and the focused window's dash - 8 px of `rgb(53, 132, 228)`, a quarter of
the button's width, at the bottom edge of the button - is **nowhere on the screen**. The
button's own icon and title centered at y≈1584.5 against the band's 1580.5.

What that costs a click: the rows of the band the button no longer covers are presses on
the **panel**, not on the button - and GNOME 50's `Main.panel` carries a
`Clutter.ClickGesture({recognize_on_press: true})` bound to the target phase
(`add_action_full('window-drag', TARGET, ...)` in the shell's own panel.js) which answers
a press on itself by `begin_grab_op(MOVING)` on the window underneath. The press is
taken, the button never sees a release, and the click looks like nothing happened;
nudging the cursor up was what got it onto the button.

Both halves of the fix are needed - the stylesheet alone leaves the request over the band:

* `stylesheet.css` gives `.azTaskbar-window-button` **no vertical margin and no vertical
  padding** (the horizontal 8 px stays, and with it `themeChrome()` and all the width
  arithmetic), so the button's box can span the band from its top edge to its bottom one;
* `WindowButton._fitVertical()` spends the band: `room = band - themeChromeHeight()`
  (padding, border and margin, read off the theme node), the row of icon and title keeps
  its line but has its floor taken away (`min_height = 0` - in this Clutter that *is* the
  request, so the box may give the row less than a line of text rather than hand the
  button more than the band), and the indicator strip takes what that leaves:
  `INDICATOR_HEIGHT` when the band can pay for it, less when it cannot, hidden below
  `INDICATOR_MIN_HEIGHT` (the radius the dash is drawn with; below that it is not a dash,
  and an invisible child asks for nothing).

With the button's minimum under the band, the box's FILL alignment gives it the band and
nothing more: every row of the band is a row of the button, nothing hangs off the screen,
and the dash is visible again - thinner than the designed 8 px on a 2.2em panel, by
whatever the band leaves once the title has its line.

* `_bandHeight()` is the vertical counterpart of `_roomWidth()` and is asked of the panel
  that does the allocating - the allocation, not the preference, for the reason at the top
  of this section. An actor that has never been allocated answers with its natural
  request, so the number is honest before the first pass too;
* `_fitVertical()` asks the box for its preferred height, and asking an off-stage widget
  for a size is the shout described under "Style writes to an actor that has no panel
  yet": the pass returns when `get_stage()` is null, as every other measuring pass here
  does;
* `main-panel-height` is now one of the keys that redisplay the list: the panel changing
  its own height is not a change in the measured *room width*, so `_watchPanelRoom` would
  never notice it and the buttons would keep a strip sized for the old height;
* check it by eye: the dash should be visible at the bottom of the button, inside the
  panel, and the title should be about on the middle line of the band rather than below
  it.

Left alone for now, and worth knowing: the *favourites* keep `.azTaskbar-BaseIcon`'s
2 px vertical margin, so an icon-only button still costs 16 + 6 + 6 + 4 = 32 px against
the ~30 px band and sits a couple of px low - the same mechanism, a few px of dead band
above the favourites rather than a whole dash off the screen. Zeroing that margin (or
making the height preference win: `#panel.azTaskbar-panel` in the custom stylesheet) is
the follow-up.

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

The guards cover the writes the fork makes, not every *request* St makes: the same six
lines also come and go at every `gnome-extensions disable`/`enable` cycle, where the
actor being unparented is asked for its size on the way out. Six lines per cycle is the
state of things here, before and after sizing the buttons to the band - the check when
touching this is that the number does not grow.

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
repository's `.gitignore` and drops most of our files. The `gnome-extensions
disable`/`enable` pair at the end of the script re-runs `disable()`/`enable()` in the
running shell, which rebuilds the panel items - it does **not** load edited files,
because the shell imports an extension's module once per session and the module cache
answers for the rest of it (see the API note "An extension's code is imported once per
shell session"). So an install takes effect at the next session start; the pair is what
makes an *already loaded* extension rebuild itself with its new settings and
stylesheet.

There is deliberately no `ReloadExtension` D-Bus call in the script. When no
`org.gnome.Shell.Extensions` instance is running, that call *activates* one, and the
request lands on an instance that has not exported its interface yet: it answers
`Missing handler for DBus method ReloadExtension`, and the reload never happens (the
failure was hidden behind an `|| true` the whole time). Do not add it back - and even
where it does answer, it unloads and loads the same cached module, so it can not pick
up a code change either.

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
