import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { openTaskHistory } from '../integration/console-history';
import { signIn } from '../integration/hub-web';
import { getSessionTitle } from '../../hapi/web/src/lib/sessionTitle';
import type { NativeFixture } from './native-fixture';

// The case retains its actual Hub/history; stopped Runners cannot dispatch more model work.
export async function nativeHistory(f: NativeFixture, result: any) {
    f.stopRunners();
    const api = f.runner.http;
    const before = (await api.request('/api/sessions')).sessions.map((s: any) => s.id).sort();
    const native = (await api.request(`/api/sessions/${result.session_id}`)).session;
    const history = await api.request(`/api/sessions/${result.session_id}/messages`);
    assert.equal(native.active, false); assert(history.messages.length > 0);
    const browser = await chromium.launch({ headless: true, executablePath: process.env.RUNWEFT_SMOKE_CHROMIUM });
    try {
        const context = await browser.newContext(), page = await context.newPage();
        const responses: string[] = [];
        context.on('response', response => { if (response.status() === 200) responses.push(new URL(response.url()).pathname); });
        await page.goto(`${f.url}/hub#space=${f.space}`);
        await signIn(page, f.account.username, f.account.password);
        const tab = await openTaskHistory(page, result.agent_id, result.session_id);
        await tab.getByText(getSessionTitle(native), { exact: true }).first().waitFor();
        assert(responses.includes(`/api/sessions/${result.session_id}/messages`));
        await tab.reload(); await tab.getByRole('link', { name: /返回 Runweft Hub/ }).waitFor();
        assert.deepEqual((await api.request(`/api/sessions/${result.session_id}/messages`)).messages, history.messages);
        assert.deepEqual((await api.request('/api/sessions')).sessions.map((s: any) => s.id).sort(), before);
        assert.equal(f.cli(['task', 'show', result.agent_id]).rounds.length, 2);
        return { sessionId: result.session_id, nativeSessionId: result.native_session_id, actualMessageCount: history.messages.length, unchanged: true };
    } finally { await browser.close(); }
}
