import assert from 'node:assert/strict';
import type { Page } from 'playwright';

// Shared by current-format browser fixtures and real native acceptance, within their own live case.
export async function openTaskHistory(page: Page, taskId: string, sessionId: string) {
    await page.getByRole('link', { name: '任务', exact: true }).click();
    await page.locator(`.row[data-key="${taskId}"]`).click();
    const inspector = page.getByRole('complementary', { name: '任务详情' });
    const popup = page.waitForEvent('popup');
    await inspector.getByRole('button', { name: '打开原生会话', exact: true }).click();
    const tab = await popup;
    await tab.waitForURL(url => url.pathname === `/sessions/${sessionId}`);
    await tab.getByRole('link', { name: /返回 Runweft Hub/ }).waitFor();
    assert.equal(await tab.evaluate(() => sessionStorage.getItem('runweft.hub.session')), null);
    assert.equal(await tab.evaluate(() => opener), null);
    return tab;
}
