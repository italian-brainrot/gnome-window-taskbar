#!/usr/bin/env python3
"""Summarize the dev probe's dump (build/dev/dump.json).

  scripts/treeshow.py [path]         # taskbar actor tree + window list
  scripts/treeshow.py --settings     # the live gsettings values
"""
import json
import sys

path = sys.argv[1] if len(sys.argv) > 1 else 'build/dev/dump.json'
flag = '--settings' in sys.argv
data = json.load(open(path))


def node(n, ind=0):
    if not n:
        return
    txt = f" {n.get('text')!r}" if n.get('text') else ''
    line = (f"{'  ' * ind}{n['actor']}.{n['name']} [{n.get('classes')}] "
            f"{n['w']}x{n['h']} min/nat={n.get('minW')}/{n.get('natW')} "
            f"n={n.get('n', '-')}{txt}")
    print(line)
    for c in n.get('children', []):
        node(c, ind + 1)


if flag:
    print(json.dumps(data['settings'], indent=1, sort_keys=True))
    sys.exit()

print('panel', data['panel']['w'], 'x', data['panel']['h'],
      'classes', data['panel']['classes'], 'location', data['panelLocation'])
print('leftBox ', data['leftBoxChildren'])
print('centerBox', data['centerBoxChildren'])
print('rightBox', data['rightBoxChildren'])
print('monitors', data['monitors'], 'workspace', data['workspace'])
for m in data['panelManagers']:
    print(f"\n=== {m['path']}")
    node(m['taskbar'])
    wl = m.get('windowsList')
    if wl is not None:
        print('  windowsList: children=%s' % wl['children'] if wl else '  windowsList: None')
        for w in (wl or {}).get('windows', []):
            print('     %-40r min=%-5s focus=%-5s ws=%s mon=%s' % (
                w.get('title'), w.get('minimized'), w.get('focused'),
                w.get('workspace'), w.get('onMonitor')))
print('\nworkspace windows:')
for w in data.get('windows') or []:
    print('   %-40r min=%s' % (w.get('title'), w.get('minimized')))
