import { validateState } from '../../src/state';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { Database } from 'bun:sqlite';
import { chromium } from 'playwright';
import { freePort } from '../../src/services';
import { closeSmoke } from '../../test/lifecycle';
import { installedBinaries } from '../installed-binaries.mjs';
import { getSessionTitle } from '../../hapi/web/src/lib/sessionTitle';

// Current completed acceptance data is copied into an isolated service, never upgraded or edited at its source.
export async function consoleHistory(options: { binary: string; hapiBinary: string; sources: string[]; record?(result: { sourceFixture: string; evidencePath: string; success: boolean }): void }) {
    for (const source of options.sources) {
        const sourceFile = resolve(source), previous = JSON.parse(readFileSync(sourceFile, 'utf8'));
        assert(previous.kind === 'collaboration-current' && previous.success && previous.handoff && !previous.consumed);
        assert.deepEqual(installedBinaries(options.binary), previous.candidate.binaries);
        const cases = previous.cases.map((item: any) => ({ detail: item.rounds.at(-1).view }));
        assert.deepEqual(previous.cleanupErrors, []);
        const paths = previous.serverPaths;
        assert(paths && paths.state === join(previous.serverHome, 'server/runweft/state.sqlite'));
        assert(sourceFile.startsWith(resolve('.dev-smoke') + sep));
        validateState(paths.state);
        const sourceFiles = [paths.state, join(paths.hapiServer, 'hapi.db')].flatMap(path => [path, path + '-wal', path + '-shm']);
        const snapshot = () => sourceFiles.map(path => { if (!existsSync(path)) return { path, exists: false }; const stat = statSync(path); return { path, exists: true, mode: stat.mode, size: stat.size, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }; });
        const before = snapshot();
        const root = mkdtempSync(resolve('.dev-smoke/console-history-')), home = join(root, 'home');
        const evidence: any = { root, candidate: { command: options.binary, core: installedBinaries(options.binary).runweft, hapi: { path: options.hapiBinary, sha256: createHash('sha256').update(readFileSync(options.hapiBinary)).digest('hex') } }, sourceFixture: sourceFile, sourceServerHome: previous.serverHome, sourceBefore: before,
            scope: 'compiled isolated current center and real archived HAPI history, Chromium; no models', checks: [], success: false, cleanupErrors: [] };
        const env = { ...process.env };
        for (const key of Object.keys(env)) if (key.startsWith('HAPI_') || key.startsWith('RUNWEFT_') || ['CLI_API_TOKEN', 'DB_PATH', 'TELEGRAM_BOT_TOKEN'].includes(key)) delete env[key];
        async function cli(args: string[]) {
            const child = Bun.spawn([options.binary, '--home', home, '--json', ...args], { env, stdout: 'pipe', stderr: 'pipe' });
            const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
            assert.equal(code, 0, stderr); return JSON.parse(stdout);
        }
        let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined, started = false, stopped = false;
        try {
            await cli(['init']); await cli(['config', 'set', 'server.runner', 'false']);
            await cli(['config', 'set', 'server.port', String(await freePort())]); await cli(['config', 'set', 'hapi.executable', options.hapiBinary]);
            mkdirSync(join(home, 'server'), { recursive: true });
            cpSync(paths.runweftServer, join(home, 'server/runweft'), { recursive: true });
            cpSync(paths.hapiServer, join(home, 'server/hapi'), { recursive: true });
            const state = new Database(join(home, 'server/runweft/state.sqlite'), { readonly: true });
            const sessions: string[] = [];
            try {
                for (const item of cases) {
                    const detail = item.detail;
                    const row = state.query('SELECT data FROM delegation_tasks WHERE id=?').get(detail.agent_id) as { data: string };
                    assert(row); const task = JSON.parse(row.data);
                    assert.equal(task.hub.ownerId, previous.ownerId); assert.equal(task.hub.spaceId, previous.spaceId);
                    const round = state.query('SELECT data FROM delegation_rounds WHERE id=?').get(detail.round_id) as { data: string };
                    assert(round); const value = JSON.parse(round.data);
                    assert.equal(value.phase, 'finished'); assert.equal(value.stop, 'stopped'); assert.equal(value.sessionId, detail.session_id);
                    sessions.push(value.sessionId);
                }
            } finally { state.close(); }
            const runner = previous.runners.find((runner: any) => runner.clientHome === previous.cases[0].clientHome);
            assert(runner, 'History needs the actual case client identity');
            const identity = JSON.parse(readFileSync(runner.paths.identityConnection, 'utf8'));
            assert.equal(identity.ownerId, previous.ownerId); assert.equal(identity.spaceId, previous.spaceId);
            started = true; const service = await cli(['start']); const origin = service.url;
            const auth = await fetch(origin + '/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessToken: identity.token, spaceId: previous.spaceId }) });
            assert.equal(auth.status, 200); const jwt = (await auth.json() as any).token;
            const api = async (path: string) => { const response = await fetch(origin + path, { headers: { authorization: `Bearer ${jwt}` } }); assert.equal(response.status, 200); return await response.json() as any; };
            const inventory = (await api('/api/sessions')).sessions.map((item: any) => item.id).sort();
            browser = await chromium.launch({ headless: true, executablePath: process.env.RUNWEFT_SMOKE_CHROMIUM });
            const context = await browser.newContext({ viewport: { width: 1200, height: 900 } }), page = await context.newPage();
            const errors: string[] = [], requests: string[] = [];
            const reads: string[] = [];
            context.on('response', response => { if (response.status() === 200) reads.push(new URL(response.url()).pathname); });
            context.on('page', tab => { tab.on('pageerror', error => errors.push(error.message)); tab.on('request', request => { const url = new URL(request.url()); assert(!url.searchParams.has('token')); requests.push(url.pathname); }); });
            await page.goto(origin + '/hub'); await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#logout')?.disabled);
            await page.locator('#import-token').fill(identity.token); await page.locator('#import-identity button').click();
            await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#logout')?.disabled);
            // The source identity's saved space is selected explicitly, without changing its authoritative records.
            await page.evaluate(spaceId => { const key = 'runweft.hub.identity'; const saved = JSON.parse(sessionStorage.getItem(key)!); saved.spaceId = spaceId; sessionStorage.setItem(key, JSON.stringify(saved)); }, previous.spaceId);
            await page.reload(); await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#logout')?.disabled);
            assert.equal(await page.locator('#space-id').innerText(), previous.spaceId);
            for (const item of cases) {
                const detail = item.detail, session = (await api(`/api/sessions/${detail.session_id}`)).session;
                const history = await api(`/api/sessions/${detail.session_id}/messages`); assert(history.messages.length > 0);
                assert.equal(session.active, false); assert.equal(session.metadata.lifecycleState, 'archived');
                await page.locator('#console-navigation').getByRole('button', { name: '任务', exact: true }).click();
                await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#logout')?.disabled);
                const card = page.locator(`[data-task-id="${detail.agent_id}"]`);
                if (!await card.count()) { await page.getByLabel('每页任务数').selectOption('100'); await page.getByRole('button', { name: '应用筛选' }).click(); await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#logout')?.disabled); }
                await card.getByRole('button', { name: '查看任务详情' }).click(); await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#logout')?.disabled);
                const popup = context.waitForEvent('page'); await page.getByRole('button', { name: '打开原生详情 / 审批', exact: true }).click(); const tab = await popup;
                await tab.waitForURL(new RegExp(`/sessions/${detail.session_id}`)); await tab.getByRole('link', { name: /返回 Runweft Hub/ }).waitFor();
                await tab.getByText(getSessionTitle(session), { exact: true }).first().waitFor();
                assert(reads.includes(`/api/sessions/${detail.session_id}`));
                assert.equal(await tab.evaluate(() => sessionStorage.getItem('runweft.hub.identity')), null);
                assert.equal(await tab.evaluate(() => opener), null);
                await tab.reload(); await tab.getByRole('link', { name: /返回 Runweft Hub/ }).waitFor();
                await tab.getByText(getSessionTitle(session), { exact: true }).first().waitFor();
                await tab.screenshot({ path: join(root, `history-${detail.session_id}.png`) }); await tab.close();
                evidence.checks.push({ taskId: detail.agent_id, roundId: detail.round_id, sessionId: detail.session_id, nativeId: detail.native_session_id, archived: true, messageCount: history.messages.length, messagesHash: createHash('sha256').update(JSON.stringify(history.messages)).digest('hex') });
            }
            assert.deepEqual((await api('/api/sessions')).sessions.map((item: any) => item.id).sort(), inventory);
            assert.deepEqual(errors, []); evidence.sessionInventory = inventory; evidence.requests = requests; evidence.success = true;
        } catch (error) { evidence.error = String(error); throw error; }
        finally {
            try { await closeSmoke([async () => { if (started) { await cli(['stop']); const status = await cli(['status']); assert(!status.service.running && !status.runner.running); } stopped = true; }, async () => { await browser?.close(); }]); }
            catch (error) { evidence.cleanupErrors.push(String(error)); }
            try { evidence.sourceAfter = snapshot(); assert.deepEqual(evidence.sourceAfter, before); evidence.sourceUnchanged = true; } catch (error) { evidence.cleanupErrors.push(String(error)); }
            if (stopped) try { rmSync(home, { recursive: true, force: true }); evidence.copiedHomeRecycled = true; } catch (error) { evidence.cleanupErrors.push(String(error)); }
            if (evidence.cleanupErrors.length) evidence.success = false;
            const evidencePath = join(root, 'evidence.json'); writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
            options.record?.({ sourceFixture: sourceFile, evidencePath, success: evidence.success });
            if (evidence.cleanupErrors.length) throw new AggregateError(evidence.cleanupErrors, 'Console history cleanup failed');
        }
    }
}
