import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';

// Current docs validate files and headings; archives validate local file targets only.
const root = process.cwd();
const documents = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.md'], { encoding: 'utf8' }).split('\0'))]
    .filter(file => file && !/^(\.agents\/|hapi\/)/.test(file) && existsSync(file));
const withoutFences = body => {
    let fence;
    return body.split('\n').map(line => {
        const marker = line.match(/^\s*(`{3,}|~{3,})/);
        if (marker) {
            if (!fence) fence = marker[1];
            else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = undefined;
            return '';
        }
        return fence ? '' : line;
    }).join('\n');
};
const headings = new Map();
function anchors(file) {
    if (headings.has(file)) return headings.get(file);
    const body = withoutFences(readFileSync(file, 'utf8')), seen = new Map(), ids = new Set();
    for (const match of body.matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
        const slug = match[1].replace(/<[^>]*>|`/g, '').toLowerCase().replace(/[^\p{L}\p{N}\p{M} _-]/gu, '').replaceAll(' ', '-');
        const occurrence = seen.get(slug) ?? 0;
        seen.set(slug, occurrence + 1); ids.add(slug + (occurrence ? '-' + occurrence : ''));
    }
    for (const match of body.matchAll(/(?:id|name)=["']([^"']+)["']/g)) ids.add(match[1]);
    headings.set(file, ids); return ids;
}
let checked = 0;
const errors = [];
for (const document of documents.sort()) {
    const body = withoutFences(readFileSync(document, 'utf8'));
    const archived = document.startsWith('docs/project/archive/');
    for (const match of body.matchAll(/!?\[[^\]\n]*\]\((?:<([^>\n]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\)/g)) {
        const href = match[1] ?? match[2];
        if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(href)) continue;
        const [path, fragment] = href.split('#');
        const target = path ? resolve(dirname(document), decodeURIComponent(path)) : resolve(document);
        const line = body.slice(0, match.index).split('\n').length;
        checked++;
        if (!existsSync(target)) errors.push(`${document}:${line}: missing file ${href}`);
        else if (!archived && fragment && extname(target) === '.md' && !anchors(target).has(decodeURIComponent(fragment))) errors.push(`${document}:${line}: missing heading ${href}`);
        else if (relative(root, target).startsWith('..')) errors.push(`${document}:${line}: local link leaves repository ${href}`);
    }
}
for (const error of errors) console.error(error);
console.log(`Documentation: ${documents.length} files, ${checked} local links, ${errors.length} errors.`);
if (errors.length) process.exitCode = 1;
