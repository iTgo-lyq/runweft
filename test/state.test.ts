import { compiledCli } from './compiled-cli';
import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { chmodSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { openState, STATE_SCHEMA_VERSION, validateState } from '../src/state';
import { recordClaudeCall, consumeClaudeCall } from '../src/mcp/claude-hook';
import { fixture } from './helpers';
import { dataPaths, loadConfig } from '../src/config';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function location() { const root = fixture('current-state'); roots.push(root); return { root, path: join(root, 'state.sqlite') }; }
function files(root: string): unknown {
    return readdirSync(root).sort().map(name => { const path = join(root, name), stat = statSync(path);
        return [name, stat.mode, stat.isDirectory() ? files(path) : createHash('sha256').update(readFileSync(path)).digest('hex')]; });
}
function refuse(root: string, path: string, code: string) {
    const before = files(root);
    for (const read of [validateState, openState]) {
        expect(() => read(path)).toThrow(expect.objectContaining({ code, status: 503 }));
        expect(files(root)).toEqual(before);
    }
}
test('format validation accepts freshly closed empty WAL databases without changing original files', () => {
    for (const kind of ['hub', 'client'] as const) {
        const { root, path } = location(), db = openState(path, kind);
        db.close();
        const before = files(root);
        validateState(path, kind);
        expect(files(root)).toEqual(before);
        const reopened = openState(path, kind);
        expect(reopened.query('PRAGMA user_version').get()).toEqual({ user_version: kind === 'hub' ? STATE_SCHEMA_VERSION : 1 });
        reopened.close();
    }
});
test('unsupported versions, including a version present only in WAL, are refused without writes', () => {
    for (const version of [0, 18, STATE_SCHEMA_VERSION + 1]) {
        const { root, path } = location(); const db = new Database(path);
        db.exec(`CREATE TABLE keep(value TEXT); INSERT INTO keep VALUES ('untouched'); PRAGMA user_version=${version};`); db.close(); chmodSync(path, 0o640);
        refuse(root, path, 'state_format_unsupported');
    }
    const { root, path } = location(), db = openState(path);
    try { db.exec('PRAGMA wal_autocheckpoint=0; PRAGMA user_version=18;'); refuse(root, path, 'state_format_unsupported'); }
    finally { db.close(); }
});
test('bad headers, missing constraints or indexes and extra objects are refused without repairing them', () => {
    const bad = location(); writeFileSync(bad.path, 'not a SQLite database'); refuse(bad.root, bad.path, 'state_format_invalid');
    for (const damage of [
        'DROP TABLE hub_connection_requests',
        'DROP INDEX hub_agent_selection_scope',
        'CREATE TABLE sqlitex_unexpected(value TEXT)',
        'PRAGMA foreign_keys=OFF; DROP TABLE hub_users; CREATE TABLE hub_users (id TEXT PRIMARY KEY, name TEXT NOT NULL, tokenDigest TEXT NOT NULL, createdAt INTEGER NOT NULL)',
        "PRAGMA foreign_keys=OFF; DROP TABLE hub_memberships; CREATE TABLE hub_memberships (spaceId TEXT NOT NULL, userId TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'member')), joinedAt INTEGER NOT NULL, PRIMARY KEY(spaceId, userId)); CREATE INDEX hub_membership_user ON hub_memberships(userId)",
        'PRAGMA foreign_keys=OFF; DROP TABLE hub_memberships; CREATE TABLE hub_memberships (spaceId TEXT NOT NULL REFERENCES hub_spaces(id), userId TEXT NOT NULL REFERENCES hub_users(id), role TEXT NOT NULL, joinedAt INTEGER NOT NULL, PRIMARY KEY(spaceId, userId)); CREATE INDEX hub_membership_user ON hub_memberships(userId)',
    ]) {
        const { root, path } = location(), db = openState(path); db.exec(damage); db.close(); refuse(root, path, 'state_format_invalid');
    }
});
test('concurrent fresh creators keep every committed row and leave no construction files', async () => {
    const { root, path } = location();
    const module = resolve('src/state.ts');
    const children = Array.from({ length: 6 }, (_, i) => Bun.spawn([process.execPath, '-e',
        `import {openState} from ${JSON.stringify(module)}; const db=openState(process.argv[1]); db.query('INSERT INTO hub_users VALUES (?, ?, ?, ?)').run(process.argv[2], 'Owner', process.argv[2], 1); db.close();`, path, String(i)], { stdout: 'pipe', stderr: 'pipe' }));
    const results = await Promise.all(children.map(async child => ({ code: await child.exited, error: await new Response(child.stderr).text() })));
    expect(results).toEqual(Array.from({ length: 6 }, () => ({ code: 0, error: '' })));
    const db = openState(path); expect(db.query('SELECT COUNT(*) AS n FROM hub_users').get()).toEqual({ n: 6 }); db.close();
    expect(readdirSync(root).some(name => name.startsWith('.state-create-'))).toBe(false);
});
test('service start, serve and restart reject an unsupported database before changing the home', async () => {
    const binary = await compiledCli();
    for (const kind of ['state', 'clientState'] as const) {
    const { root } = location(); const config = loadConfig(root, {}), path = dataPaths(config)[kind];
    const { mkdirSync } = await import('node:fs'); const { dirname } = await import('node:path'); mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path); db.exec('CREATE TABLE keep(value TEXT); PRAGMA user_version=18;'); db.close();
    const before = files(root);
    for (const action of ['start', 'serve', 'restart']) {
        const child = Bun.spawn([binary, '--home', root, '--json', action], { stdout: 'pipe', stderr: 'pipe' });
        const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect(code).toBe(1); expect(out + err).toContain('state_format_unsupported'); expect(files(root)).toEqual(before);
    }
    }
});

test('Claude hook refuses existing unversioned or structurally different client databases before TTL cleanup or identity writes', () => {
    for (const initial of [
        'CREATE TABLE old_bindings (value TEXT); PRAGMA user_version=0;',
        'CREATE TABLE claude_mcp_calls (callId TEXT PRIMARY KEY, sessionId TEXT NOT NULL, cwd TEXT NOT NULL, agentId TEXT, createdAt INTEGER NOT NULL); PRAGMA user_version=0;',
        'CREATE TABLE claude_mcp_calls (callId TEXT PRIMARY KEY, sessionId TEXT NOT NULL, cwd TEXT NOT NULL, agentId TEXT, createdAt INTEGER NOT NULL); CREATE TABLE unexpected(value TEXT); PRAGMA user_version=1;',
    ]) {
        const { root } = location(), c = loadConfig(root, {}), path = dataPaths(c).clientState;
        const db = new Database(path); db.exec(initial); db.close(); const before = files(root);
        const event = { hook_event_name: 'PreToolUse', tool_name: 'mcp__runweft__wait', tool_use_id: 'call', session_id: 'session', cwd: root };
        expect(() => recordClaudeCall(c, event)).toThrow(expect.objectContaining({ status: 503 })); expect(files(root)).toEqual(before);
        expect(() => consumeClaudeCall(c, 'call')).toThrow(expect.objectContaining({ status: 503 })); expect(files(root)).toEqual(before);
    }
});
