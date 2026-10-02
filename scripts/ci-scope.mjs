import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function integrationGroups(files) {
    const groups = new Set();
    for (const file of files) {
        if (/^(docs\/(?!usage\.md)|test\/|scripts\/tests\/|website\/|\.agents\/)/.test(file) || /(^|\/)(README|AGENTS)\.md$/.test(file)) continue;
        if (/^scripts\/(npm-publish|check-npm-trust)\.mjs$/.test(file) || file.startsWith('.github/')) continue;
        if (/^src\/hub\/(app|console|tasks-page|native-page|style|onboarding-page)/.test(file) || /scripts\/(fixtures\/)?(hub-console|smoke-hub-console|smoke-hub-connect|smoke-hub\.ts)/.test(file)) groups.add('web');
        else if (/^src\/hub\//.test(file)) return ['access', 'storage', 'web', 'service'];
        else if (/^src\/(tasks|artifacts|repositories)\//.test(file)) { groups.add('storage'); groups.add('web'); }
        else if (/^src\/mcp\//.test(file)) { groups.add('access'); groups.add('storage'); }
        else return ['access', 'storage', 'web', 'service'];
    }
    return ['access', 'storage', 'web', 'service'].filter(group => groups.has(group));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const { CI_BASE: base, CI_HEAD: head, GITHUB_OUTPUT: output } = process.env;
    let files = ['unknown'];
    if (/^[a-f0-9]{40}$/.test(base ?? '') && !/^0+$/.test(base) && /^[a-f0-9]{40}$/.test(head ?? '')) {
        const result = spawnSync('git', ['diff', '--name-only', '-z', base, head, '--'], { encoding: 'utf8' });
        if (result.status !== 0) throw new Error('Cannot determine changed files; refusing to silently skip integration');
        files = result.stdout.split('\0').filter(Boolean);
    }
    const groups = JSON.stringify(integrationGroups(files));
    if (output) appendFileSync(output, `groups=${groups}\n`);
    console.log(groups);
}
