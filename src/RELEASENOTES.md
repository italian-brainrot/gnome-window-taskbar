<b><span size="large">Window Taskbar 40.2 (fork)</span></b>

- Window buttons: the blank tail that keeps the buttons from jumping is always the
  last item of the list, so the room the buttons do not use stays behind them instead
  of between the favourites and the first button.
- Window buttons: no more "widget is not in the stage" about styles in the log at
  session start; the list styles itself only once it is in the panel.
- Window buttons: the window menu closes itself, and its items go quiet, when the
  window is closed while that menu is open.
- Secondary monitors: the window list sizes itself to the room the panel it lives in
  can really give it, rather than to the room the top panel gives it.
- Preferences: the options that did nothing any more are out of the settings schema
  (the update notifier, and the switch for the running/window indicator).

<b><span size="large">Upstream, App Icons Taskbar (aztaskbar) - fork base 31.4</span></b>

<b><span size="large">v31.4</span></b>

- Add GNOME 51 support.

<b><span size="large">v31.3</span></b>

- Add GNOME 50 support.
- Fix transparent panel bug on login/startup.

<b><span size="large">v31.2</span></b>

- Add GNOME 50 support.
- Fix transparent panel bug on login/startup.

<b><span size="large">v31.1</span></b>

- Panel: fix drag maximized window from panel for GNOME Shell 49.
- Extension: Prevent creation of a taskbar when primary monitor is null.

<b><span size="large">v31.0</span></b>

- Window Previews: add option to display window previews in a grid layout.
- Window Previews: use PointerWatcher to determine when the mouse leaves a window preview.
- Window Previews: allow events to pass to AppIcon while window preview is opened.
- Window Previews: ensure endPeekTimeout is removed on destroy.
- App Icons: fix mouse scroll window cycle.
- Fix bug causing intellihide to not work when 'panel-on-all-monitors' settting disabled.
- ArcMenu hotkey now properly reveals the panel when intellihide enabled and 'panel-on-all-monitors' setting disabled.