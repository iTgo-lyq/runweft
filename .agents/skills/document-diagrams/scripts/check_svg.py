#!/usr/bin/env python3
"""Check standalone SVG syntax, accessible naming, IDs and local resources.

Run the chosen type's geometry verifier separately. Render the SVG to inspect
text fit and contrast; this check does not measure either.
"""
import argparse
from collections import Counter
import math
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET

SVG = 'http://www.w3.org/2000/svg'
URL = re.compile(r'url\(\s*[\'\"]?([^\'\")]+)', re.I)


class SvgBuilder(ET.TreeBuilder):
    def __init__(self):
        super().__init__()
        self.processing_instructions = []

    def pi(self, target, data):
        # XML declarations are handled by the XML parser, not this callback.
        self.processing_instructions.append(target)


def local_name(name):
    return name.rsplit('}', 1)[-1]


def check(path):
    errors = []
    try:
        source = path.read_text(encoding='utf-8')
        if re.search(r'<!DOCTYPE|<!ENTITY', source, re.I):
            return ['DTD and entity declarations do not belong in a standalone diagram']
        builder = SvgBuilder()
        root = ET.fromstring(source, parser=ET.XMLParser(target=builder))
        if builder.processing_instructions:
            errors.append('processing instructions, including XML stylesheets, are outside standalone SVG')
    except (OSError, UnicodeError, ET.ParseError) as exc:
        return [str(exc)]
    if root.tag != f'{{{SVG}}}svg':
        return ['root must be an SVG element in the SVG namespace']
    try:
        box = [float(value) for value in re.split(r'[\s,]+', root.get('viewBox', '').strip())]
        if len(box) != 4 or not all(math.isfinite(v) for v in box) or min(box[2:]) <= 0:
            raise ValueError
    except ValueError:
        errors.append('viewBox needs four finite numbers and positive width/height')
    counts = Counter(e.get('id') for e in root.iter() if e.get('id'))
    errors.extend(f'duplicate id: {key}' for key, count in counts.items() if count > 1)
    title = root.find(f'{{{SVG}}}title')
    desc = root.find(f'{{{SVG}}}desc')
    if root.get('role') != 'img':
        errors.append('root needs role="img"')
    if len(root) == 0 or root[0].tag != f'{{{SVG}}}title':
        errors.append('title must be the first SVG child')
    names = []
    for node, name in [(title, 'title'), (desc, 'desc')]:
        if node is None or not ''.join(node.itertext()).strip():
            errors.append(f'non-empty {name} is required')
            continue
        ident = node.get('id', '')
        if not ident or ident in {'title', 'desc'}:
            errors.append(f'{name} needs a diagram-prefixed id')
        names.append(ident)
    if len(names) == 2 and root.get('aria-labelledby', '').split() != names:
        errors.append('aria-labelledby must reference title then desc')
    refs = []
    for element in root.iter():
        tag = local_name(element.tag)
        if tag in {'script', 'foreignObject', 'animate', 'animateMotion', 'animateTransform', 'set'}:
            errors.append(f'<{tag}> is outside static SVG output')
        for name, value in element.attrib.items():
            name = local_name(name)
            if name.lower().startswith('on'):
                errors.append(f'event handler {name} is outside static SVG output')
            if name == 'href' and value:
                if value.startswith('#'):
                    refs.append(value[1:])
                else:
                    errors.append(f'non-local reference on <{tag}>')
            for match in URL.findall(value):
                if match.startswith('#'):
                    refs.append(match[1:])
                else:
                    errors.append(f'non-local CSS resource on <{tag}>')
        if tag == 'style':
            css = ''.join(element.itertext())
            if '@import' in css.lower() or '@font-face' in css.lower():
                errors.append('external font/style loaders are outside standalone SVG')
            for value in URL.findall(css):
                if value.startswith('#'):
                    refs.append(value[1:])
                else:
                    errors.append('non-local CSS resource')
        if tag == 'use' and not any(local_name(key) == 'href' for key in element.attrib):
            errors.append('<use> needs a local href')
    errors.extend(f'unresolved local id: {ref}' for ref in sorted(set(refs)) if ref not in counts)
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('files', type=Path, nargs='+')
    args = parser.parse_args()
    failed = False
    for path in args.files:
        errors = check(path)
        for error in errors:
            print(f'FAIL {path}: {error}', file=sys.stderr)
        if errors:
            failed = True
        else:
            print(f'OK {path}')
    return int(failed)


if __name__ == '__main__':
    sys.exit(main())
