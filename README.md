# Window Taskbar (GNOME Shell extension)

A bottom-panel taskbar for GNOME Shell 50: favourites on the left exactly like
[App Icons Taskbar](https://gitlab.com/AndrewZaech/aztaskbar) (this is a fork of
it), and after them **one button per open window, with the window title, never
grouped by application**.

Built for GNOME Shell 50.6 (Bazzite 44). Fork of aztaskbar 31.4, GPL-3.0-or-later,
see `AUTHORS`, `LICENSE` and `HACKING.md`.

## Install

GNOME Shell scans extension directories **at session start only**, so a fresh
install needs one logout/in before the extension can be enabled at all.

```
git clone https://github.com/italian-brainrot/gnome-window-taskbar.git
cd gnome-window-taskbar
scripts/install.sh          # builds, copies to ~/.local/share/gnome-shell/extensions
                            # and does a disable/enable for the already-installed case
# then: log out and back in (first install), enable it in the Extensions app
```

Without the scripts: copy the contents of `src/` into
`~/.local/share/gnome-shell/extensions/windowtaskbar@italian-brainrot.github.io/`,
then compile the schema in that directory
(`glib-compile-schemas <that>/schemas`) - `schemas/gschemas.compiled` is a build
artifact and is not in the repository. `scripts/build.sh` puts a built copy in
`dist/<uuid>` if you want to hand the tree to somebody.

Enable/disable/configure: the GNOME **Extensions** app (preferences live in the
app, via the extension's gsettings schema). `scripts/install.sh disable` and
`scripts/logs.sh` do the same from the command line.

## What it looks like / behaviour

See `HACKING.md` for the behaviour table and the list of new settings keys. When
there are too many windows for the panel, the titles give way to icons and the
favourites and the status area stay on screen; the title itself is cut to a length
you can set in the preferences.
