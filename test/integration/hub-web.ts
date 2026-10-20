import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright';

export const viewports = { desktop: { width: 1365, height: 960 }, tablet: { width: 820, height: 1180 }, phone: { width: 390, height: 844 } };

/** A Hub tab that records page errors and CSP violations; tests end by expecting the list to be empty. */
export async function hubTab(browser: Browser, viewport = viewports.desktop) {
    const page = await browser.newPage({ viewport }), problems: string[] = [];
    page.on('pageerror', error => problems.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && message.text().startsWith('[csp]')) problems.push(message.text()); });
    await page.addInitScript(() => document.addEventListener('securitypolicyviolation', event => console.error(`[csp] ${event.effectiveDirective} ${event.blockedURI}`)));
    return { page, problems };
}

export const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
export const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
export const alertText = (page: Page) => page.getByRole('alert').first().innerText();

export async function fillAccount(page: Page, username: string, password: string) {
    await field(page, '用户名').fill(username); await field(page, '密码').fill(password);
}

/** Submits the account form and waits for the workspace or an error, so a refused login fails with its message. */
export async function signIn(page: Page, username: string, password: string, action = '登录') {
    await fillAccount(page, username, password); await button(page, action).click();
    const workspace = page.getByRole('navigation', { name: '主导航' });
    await Promise.race([workspace.waitFor(), page.getByRole('alert').first().waitFor()]);
    if (!await workspace.isVisible()) throw new Error(await alertText(page));
}

export async function accountMenu(page: Page, item: string) {
    await page.getByRole('button', { name: /^账号：/ }).click();
    await page.getByRole('menuitem', { name: new RegExp(`^${item}`) }).click();
}

export async function confirmDialog(page: Page, action: string) {
    const dialog = page.getByRole('alertdialog');
    await dialog.getByRole('button', { name: action, exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
}

export const savedSession = async (page: Page) => JSON.parse(await page.evaluate(() => sessionStorage.getItem('runweft.hub.session') ?? 'null')) as { token: string; spaceId?: string } | null;

/** The page never scrolls sideways at the three supported sizes. */
export async function expectNoOverflow(page: Page) {
    for (const viewport of Object.values(viewports)) {
        await page.setViewportSize(viewport);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `horizontal overflow at ${viewport.width}px`);
    }
    await page.setViewportSize(viewports.desktop);
}
