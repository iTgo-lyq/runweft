import assert from 'node:assert/strict';
import type { Page } from 'playwright';

// Shared by current-format browser fixtures and real native acceptance, within their own live case.
export async function openTaskHistory(page: Page, taskId: string, sessionId: string) {
    await page.locator('#console-navigation').getByRole('button', { name: '任务', exact: true }).click();
    await page.locator(`[data-task-id="${taskId}"]`).getByRole('button', { name: '查看任务详情' }).click();
    const popup = page.waitForEvent('popup');
    await page.getByRole('button', { name: '打开原生详情 / 审批', exact: true }).click();
    const tab = await popup;
    await tab.waitForURL(url => url.pathname === `/sessions/${sessionId}`);
    await tab.getByRole('link', { name: /返回 Runweft Hub/ }).waitFor();
    assert.equal(await tab.evaluate(() => sessionStorage.getItem('runweft.hub.identity')), null);
    assert.equal(await tab.evaluate(() => opener), null);
    return tab;
}
