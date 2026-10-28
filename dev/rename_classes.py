#!/usr/bin/env python3
"""Uniquify GObject class names in a copied extension tree.

GJS registers one GType per JS class name ("Gjs_Foo") and refuses to register
the same name twice, so a hot-reloaded copy of the code can not keep its class
names: "Type name Gjs_Foo is already registered". This appends the iteration
number to every class declared in the tree, consistently across all files.

Usage: rename_classes.py <tree> <suffix>
"""
import pathlib
import re
import sys

tree, suffix = sys.argv[1], sys.argv[2]

CLASS_DECL = re.compile(r'\bclass\s+([A-Za-z_]\w*)')
files = list(pathlib.Path(tree).rglob('*.js'))

names = set()
for path in files:
    for match in CLASS_DECL.finditer(path.read_text()):
        names.add(match.group(1))

names.discard('extension')
pattern = re.compile(r'\b(%s)\b' % '|'.join(
    map(re.escape, sorted(names, key=len, reverse=True))))

total = 0
for path in files:
    text = path.read_text()
    replaced, count = pattern.subn(lambda match: f'{match.group(1)}_{suffix}', text)
    if count:
        path.write_text(replaced)
        total += count
        print(f'  {path}: {count}')

print(f'uniquified {len(names)} class names, {total} occurrences in {tree}')
