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

## Dev loop

```
scripts/install.sh            # build + copy to the host user dir + enable
scripts/logs.sh 300           # gnome-shell/GJS errors from the host journal
```

`src/schemas/gschemas.compiled` is generated at build time (never committed),
which is why `install.sh` runs `glib-compile-schemas` with the **host's** glib.

Reloading code into the running shell uses the `org.gnome.Shell.Extensions`
D-Bus methods: `Disable`/`Enable`, and `ReloadExtension` (unloads, evicting the
GJS module cache, then re-reads the extension directory).

**Caveat — new extension directories are only scanned at session start.** On
GNOME 50 the shell enumerates extension dirs once in
`ExtensionManager._loadExtensions()`; there is no rescan D-Bus API. So the first
install of a brand new uuid needs one session restart (log out, log back in),
after which `ReloadExtension` and `Enable`/`Disable` work fine for iteration.
