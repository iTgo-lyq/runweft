import assert from 'node:assert/strict';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export function checkRunweftKit(directory) {
    const root = resolve(directory), files = [];
    function walk(path) {
        const stat = lstatSync(path);
        assert(!stat.isSymbolicLink(), `Skill must not contain symlinks: ${path}`);
        if (stat.isDirectory()) for (const name of readdirSync(path)) walk(join(path, name));
        else { assert(stat.isFile(), `Skill must contain ordinary files: ${path}`); files.push(path); }
    }
    walk(root);
    const entry = readFileSync(join(root, 'SKILL.md'), 'utf8');
    const frontmatter = entry.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    assert(frontmatter, 'SKILL.md must contain YAML frontmatter');
    const metadata = parse(frontmatter[1]);
    assert.equal(metadata?.name, 'runweft-kit', 'Skill name must be runweft-kit');
    assert(typeof metadata.description === 'string' && metadata.description.trim(), 'Skill description must be nonempty');
    assert(metadata.metadata?.internal !== true, 'Product Skill must be publicly discoverable');
    for (const name of ['onboarding', 'configuration', 'delegation', 'maintenance']) {
        assert(lstatSync(join(root, 'references', `${name}.md`)).isFile(), `Missing reference: ${name}`);
    }
    for (const file of files.filter(path => path.endsWith('.md'))) {
        const body = readFileSync(file, 'utf8');
        for (const match of body.matchAll(/!?\[[^\]\n]*\]\(([^\s)]+)(?:\s+["'][^\n]*?["'])?\)/g)) {
            const href = match[1];
            if (/^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(href)) continue;
            const target = resolve(dirname(file), decodeURIComponent(href.split('#')[0]));
            const path = relative(root, target);
            assert(!path.startsWith('..') && !isAbsolute(path), `Skill link leaves its directory: ${href}`);
            assert(lstatSync(target).isFile(), `Skill link must resolve to a file: ${href}`);
        }
    }
    return files.map(file => relative(root, file)).sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const files = checkRunweftKit(process.argv[2] ?? '.agents/skills/runweft-kit');
    console.log(`Runweft Kit: ${files.length} files, metadata and local references passed.`);
}
