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
   removed (it asks for aztaskbar releases, which is meaningless for a fork).
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

## New gsettings keys

`window-labels`, `window-button-icons`, `window-button-width` (0 = fit title),
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
* `insert_child_at_index` on an already parented child is only a warning and is
  ignored, so the permanent window list is unparented before being re-inserted.

## Dev loop

GNOME Shell 50.6 scans extension dirs **once, at session start**
(`ExtensionManager._loadExtensions()`), and it never rescans: there is no rescan
D-Bus method, and `gnome-extensions install` only drops files in place. Worse, an
extension whose `extension.js` failed to import keeps the failed module in the
GJS module cache for the rest of the session, so even a fixed copy is not
re-imported. Both problems mean: touching a *new* uuid or fixing an import error
needs a session restart.

So instead of restarting the session per code change, use the dev loader:

```
scripts/dev-setup.sh        # one-off: installs windowtaskbar-dev@local (a loader
                            # extension whose extension.js only imports the code
                            # from build/dev/iterN/), then ONE session restart
scripts/hotreload.sh        # build a new iteration + reload it live
scripts/hotreload.sh --prefs # also restart the prefs service (its module cache
                            # is dropped when the D-Bus activated service dies)
scripts/logs.sh 300         # read shell/daemon errors from the host journal
```

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
