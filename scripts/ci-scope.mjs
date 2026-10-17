import { appendFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const mainCases = ['N1', 'N4', 'N5', 'C-codex', 'C-claude'];
const integrationFiles = () => readdirSync(new URL('../test/integration/', import.meta.url))
    .filter(file => file.endsWith('.test.ts')).sort().map(file => 'test/integration/' + file);

export function selectChecks(files) {
    const all = integrationFiles(), selected = new Set(), native = new Set();
    const scope = { core: false, tools: false, kit: false, prototype: false, website: false, install: false,
        typecheck: false, managers: false, integration: [] };
    const select = pattern => all.filter(file => pattern.test(file)).forEach(file => selected.add(file));
    for (const file of files) {
        if (/^(website\/|docs\/usage\.md$)/.test(file)) { scope.website = true; continue; }
        if (file.startsWith('packages/prototype/')) { scope.prototype = true; continue; }
        if (/^(\.agents\/skills\/runweft-kit\/|scripts\/(check-runweft-kit\.mjs|sync-runweft-kit\.sh)$)/.test(file)) { scope.kit = scope.tools = true; continue; }
        if (/^(docs\/|\.agents\/skills\/spec-trail\/|\.githooks\/)/.test(file) || /(^|\/)(README|AGENTS)\.md$/.test(file) || /^scripts\/check-(docs|workflow)\.mjs$/.test(file)) continue;
        if (file.startsWith('scripts/tests/') && !file.endsWith('/ci-scope.test.mjs')) { scope.tools = true; continue; }
        if (file.startsWith('test/core/')) { scope.core = true; continue; }
        if (file.startsWith('test/integration/')) {
            if (all.includes(file)) selected.add(file); else select(/./); // shared helper or deleted test
            continue;
        }
        if (/^src\/hub\/(app|console|tasks-page|native-page|style|onboarding-page)/.test(file)) { scope.typecheck = true; select(/\/(web-|hub-console)/); continue; }
        if (/^src\/(tasks|artifacts|repositories)\//.test(file)) { scope.typecheck = true; select(/\/(task|remote|execution|workspace|files|artifact|web-)/); continue; }
        if (/^src\/mcp\//.test(file)) { scope.typecheck = true; select(/mcp|cli-consumers/); mainCases.forEach(c => native.add(c)); continue; }
        if (file === 'hapi' || /protocol/.test(file) || ['src/hapi.ts', 'src/execution.ts', 'scripts/ci-scope.mjs', '.github/workflows/checks.yml'].includes(file)) scope.managers = true;
        // Shared inputs and unknown paths select every consumer rather than silently omit checks.
        scope.core = scope.tools = scope.kit = scope.prototype = scope.website = scope.install = scope.typecheck = true;
        select(/./);
        [...mainCases, 'R-codex', 'R-claude', 'L-claude'].forEach(c => native.add(c));
    }
    scope.integration = [...selected].sort();
    scope.native = [...native];
    scope.hapi = scope.typecheck || scope.managers || selected.size > 0;
    scope.build = scope.integration.some(file => /\/(files-(access|artifacts|inputs|outputs|prune)\.|hub-(configuration|lifecycle|.*-live)\.|web-|workspace-(export|import|results|preparation|delegation)\.)/.test(file));
    scope.clients = scope.integration.some(file => /cli-mcp-install|hub-configuration|hub-resources-live|hub-delegation-live|workspace-|web-console/.test(file));
    scope.browser = scope.integration.some(file => /\/web-/.test(file));
    scope.checks = scope.core || scope.tools || scope.kit || scope.hapi || scope.install;
    return scope;
}

export function changedFiles({ base, head = 'HEAD', defaultBranch = 'origin/main', mergeBase = false, workingTree = false, cwd = process.cwd() }) {
    const git = (...args) => {
        const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
        if (result.status !== 0) throw new Error(`Cannot determine scope: git ${args[0]} failed`);
        return result.stdout.trimEnd();
    };
    const revision = ref => git('rev-parse', '--verify', `${ref}^{commit}`);
    const resolvedHead = revision(head);
    let comparison;
    if (!base || /^0+$/.test(base)) {
        // A first push has no before commit. Prefer a proven default-branch merge base.
        const available = spawnSync('git', ['rev-parse', '--verify', `${defaultBranch}^{commit}`], { cwd, encoding: 'utf8' });
        if (available.status !== 0) return { base: null, head: resolvedHead, files: ['unknown'], reason: 'No trusted comparison base; full checks selected' };
        comparison = git('merge-base', available.stdout.trim(), resolvedHead);
    } else {
        comparison = revision(base); // An explicitly unavailable ref is an error, never an empty successful selection.
        if (mergeBase) comparison = git('merge-base', comparison, resolvedHead);
    }
    // --no-renames includes both the deleted and added paths for moves.
    const files = git('diff', '--name-only', '--no-renames', '-z', comparison, resolvedHead, '--').split('\0').filter(Boolean);
    if (workingTree) {
        files.push(...git('diff', '--name-only', '--no-renames', '-z', resolvedHead, '--').split('\0').filter(Boolean));
        files.push(...git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean));
    }
    return { base: comparison, head: resolvedHead, files: [...new Set(files)].sort() };
}

export function verifyJobs(scope, jobs) {
    for (const name of ['scope', 'checks', 'prototype', 'install']) {
        const required = name === 'scope' || scope[name];
        if (required ? jobs[name]?.result !== 'success' : !['success', 'skipped'].includes(jobs[name]?.result)) {
            throw new Error(`Required check did not succeed: ${name} (${jobs[name]?.result ?? 'missing'})`);
        }
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const { values } = parseArgs({ options: { base: { type: 'string' }, head: { type: 'string' }, 'default-branch': { type: 'string' },
        'merge-base': { type: 'boolean' }, 'working-tree': { type: 'boolean' } } });
    const change = changedFiles({ base: values.base ?? process.env.CI_BASE, head: values.head ?? process.env.CI_HEAD ?? 'HEAD',
        defaultBranch: values['default-branch'] ?? process.env.CI_DEFAULT_BRANCH ?? 'origin/main',
        mergeBase: values['merge-base'] || process.env.GITHUB_EVENT_NAME === 'pull_request', workingTree: values['working-tree'] });
    const scope = selectChecks(change.files);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
        Object.entries(scope).map(([key, value]) => `${key}=${JSON.stringify(value)}\n`).join('') + `selection=${JSON.stringify(scope)}\n`);
    console.log(JSON.stringify({ ...change, ...scope }, null, 2));
}
