import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureCleanup, type Cleanup } from './fixture-cleanup';
import { fixture } from './helpers';
import { nativeFixture } from './native-fixture';

test('construction failure closes HTTP and database and removes its root despite another close failure', async () => {
    const cleanups: Cleanup[] = [], scope = fixtureCleanup(cleanups);
    const home = fixture('cleanup-failure');
    scope.resources.push(() => rmSync(home, { recursive: true, force: true }));
    const db = new Database(join(home, 'state.sqlite'), { create: true });
    scope.resources.push(() => db.close());
    const native = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('alive') });
    const url = native.url.origin;
    scope.resources.push(() => native.stop(true));
    scope.resources.push(() => { throw new Error('close fault'); });
    await expect(scope.failed(new Error('construction fault'))).rejects.toThrow('construction and cleanup failed');
    expect(existsSync(home)).toBe(false);
    expect(() => db.query('SELECT 1').get()).toThrow();
    await expect(fetch(url)).rejects.toThrow();
    await cleanups[0]!(); // Already consumed resources are not closed a second time.
});

test('native fixture JWT construction failure removes its new root immediately', async () => {
    const root = join(process.cwd(), '.dev-smoke', 'tests');
    mkdirSync(root, { recursive: true });
    const before = new Set(readdirSync(root));
    const cleanups: Cleanup[] = [];
    await expect(nativeFixture(cleanups, { namespaces: [1n as unknown as string] })).rejects.toThrow();
    expect(readdirSync(root).filter(name => !before.has(name) && name.startsWith('native-'))).toEqual([]);
    for (const close of cleanups.reverse()) await close();
});


test('an outer owner closes both resource fixtures even when the first close reports failure', async () => {
    const outer = fixtureCleanup([]), roots: string[] = [], databases: Database[] = [], servers: ReturnType<typeof Bun.serve>[] = [];
    for (let i = 0; i < 2; i++) {
        const owner = fixtureCleanup(outer.resources), root = fixture('outer-cleanup', owner.resources);
        roots.push(root);
        const db = new Database(join(root, 'state.sqlite')); databases.push(db); owner.resources.push(() => db.close());
        const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('alive') }); servers.push(server); owner.resources.push(() => server.stop(true));
        if (i === 1) owner.resources.push(() => { throw new Error('first fixture close failed'); });
    }
    await expect(outer.close()).rejects.toThrow(AggregateError);
    for (let i = 0; i < 2; i++) {
        expect(existsSync(roots[i])).toBe(false);
        expect(() => databases[i].query('SELECT 1').get()).toThrow();
        await expect(fetch(servers[i].url)).rejects.toThrow();
    }
});
