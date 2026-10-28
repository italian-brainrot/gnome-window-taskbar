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
            f"{n['w']}x{n['h']} w-min/nat={n.get('minW')}/{n.get('natW')} "
            f"h-min/nat={n.get('minH')}/{n.get('natH')} "
            f"n={n.get('n', '-')}{txt}")
    if n.get('violation'):
        line += '   <== min > natural: this asserts and kills the session'
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
band = None
for m in data['panelManagers']:
    print(f"\n=== {m['path']}")
    node(m['taskbar'])
    wl = m.get('windowsList')
    if wl is not None:
        print('  windowsList: children=%s' % wl['children'] if wl else '  windowsList: None')
        if wl and wl.get('order') is not None:
            # the order a drop committed, and the button a drag is holding still
            print('   order: %s%s' % (
                wl['order'],
                '   <== dragging %r' % wl['dragging'] if wl.get('dragging') else ''))
        sizing = (wl or {}).get('sizing') or {}
        band = sizing.get('band')
        if band is not None:
            print('   band (panel height) %s, list asks h-min/nat=%s' % (
                band, (wl or {}).get('bandNat')))
        for b in (wl or {}).get('buttonWidths', []):
            over = ''
            if band and b.get('natH') and b['natH'] > band:
                over = '   <== taller than the band: hangs off the screen'
            print('     %-30r w=%-5s h=%-5s h-min/nat=%-3s/%-3s chrome=%-3s '
                  'row=%-3s dash=%s vis=%s%s' % (
                      b.get('title'), b.get('w'), b.get('h'), b.get('minH'),
                      b.get('natH'), b.get('chromeH'), b.get('rowNatH'),
                      b.get('indicatorH'), b.get('indicatorVisible'), over))
        for w in (wl or {}).get('windows', []):
            print('     %-40r min=%-5s focus=%-5s ws=%s mon=%s' % (
                w.get('title'), w.get('minimized'), w.get('focused'),
                w.get('workspace'), w.get('onMonitor')))
print('\nworkspace windows:')
for w in data.get('windows') or []:
    print('   %-40r min=%s' % (w.get('title'), w.get('minimized')))
