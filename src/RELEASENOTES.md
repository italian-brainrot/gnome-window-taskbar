<b><span size="large">Window Taskbar 40.4 (fork)</span></b>

- Window buttons: the buttons with titles no longer hang off the bottom of the panel.
  A line of title, the running/focused dash, and the theme's padding, border and margin
  around them ask for more height than the panel has, and a box
  layout hands a child the larger number rather than the smaller one - so the bottom of
  every titled button, its dash included, was drawn below the edge of the screen, and
  the rows of the panel the button no longer covered were presses on the panel itself,
  which GNOME Shell 50's panel answers by starting a window move: the click was taken
  and nothing appeared to happen until the cursor was moved onto the button.
- Window buttons: the button now spans the panel band, top edge to bottom edge - no
  vertical margin, no vertical padding - so every row of the panel is a row of the
  button, and the running/focused dash is visible again at the bottom of it.
- Window buttons: the indicator strip is sized to what the panel's height leaves over
  once the title has its line: it shrinks on a short panel and goes away when the panel
  is too short for a dash at all, instead of pushing the button off the screen.
- Preferences: changing the panel height restyles the window buttons, since the strip
  is now sized against it.


- Window buttons: the row is sized from what the buttons actually ask for instead of
  from a guess at what a button costs. The padding and the border are read off the
  theme (the shell's own `#panel .panel-button` outranks our class), the list's own
  padding, border and spacing are counted in, and the row's request is measured: if it
  is more than the panel has, the titles give way to icons and, if a row of icons does
  not fit either, the row stops at the last button there is room for. The clock, the
  quick settings and the favourites stay on the monitor whatever the theme spends.
- Window buttons: the room is worked out again when the panel's side boxes change size
  on their own - the clock's text, another extension's tray icons - instead of only
  when a window comes or goes.
- Window buttons: a preference change no longer styles the buttons before the room is
  re-worked out; the same pass does both, so the panel is never handed a row of
  uncapped buttons in between.
- Preferences: the spacing between taskbar items now reaches the window list as well
  as the favourites (it used to be applied to the list only when the panel was
  rebuilt).

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