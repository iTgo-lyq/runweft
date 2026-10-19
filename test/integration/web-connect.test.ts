import { afterEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { accountWebFixture } from './account-web-fixture';
import { fixtureCleanup } from '../fixture-cleanup';
import { IdentityConnection } from '../../src/hub/connect/client';
import { HubStore } from '../../src/hub/store';
const owner=fixtureCleanup([]);afterEach(()=>owner.close());

test('one browser form registers and activates CLI authorization; a new tab signs in and a live tab only confirms',async()=>{
    const h=await accountWebFixture(owner.resources),session=new IdentityConnection(h.clientHome,h.url),request=await session.begin('测试电脑');
    const page=await h.browser.newPage({viewport:{width:1365,height:960}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(request.confirmationUrl);await page.locator('#auth-submit').getByText('注册并连接',{exact:true}).waitFor();
    await page.route('**/api/runweft/connect/*/confirm',async route=>{await route.fetch();await route.abort('failed');},{times:1});
    await page.locator('#account-username').fill('connect-user');await page.locator('#account-password').fill('an isolated connect passphrase');await page.locator('#auth-submit').click();
    await page.locator('#connection-success').waitFor();expect(await page.getByRole('heading',{name:'可以返回原对话了'}).isVisible()).toBe(true);
    const pending=JSON.parse(readFileSync(session.paths.pendingConnection,'utf8')),store=new HubStore(h.paths.state);owner.resources.push(()=>store.close());
    expect(store.authenticate(pending.secret).name).toBe('connect-user');expect((await h.cli(['hub','--url',h.url,'connect','complete'])).status).toBe('connected');
    const next=new IdentityConnection(join(h.root,'second-client'),h.url),second=await next.begin('第二个终端'),tab=await h.browser.newPage();
    await tab.goto(second.confirmationUrl);await tab.locator('#toggle-auth').click();await tab.locator('#account-username').fill('connect-user');await tab.locator('#account-password').fill('an isolated connect passphrase');await tab.locator('#auth-submit').click();await tab.locator('#connection-success').waitFor();
    expect((await next.complete()).status).toBe('connected');
    const same=new IdentityConnection(join(h.root,'same-tab-client'),h.url),third=await same.begin();await page.goto(third.confirmationUrl);await page.locator('#confirm-connection').waitFor();expect(await page.locator('#auth-form').isVisible()).toBe(false);
    await page.locator('#confirm-connection').click();await page.locator('#connection-success').waitFor();expect((await same.complete()).status).toBe('connected');
    const dead=new IdentityConnection(join(h.root,'expired-client'),h.url),expired=await dead.begin();store.db.query('UPDATE hub_connection_requests SET expiresAt=? WHERE id=?').run(Date.now()-1,expired.requestId);
    await page.goto(expired.confirmationUrl);await page.locator('#connect-status').getByText(/已过期|取消/).waitFor();await page.locator('#leave-connection').click();await page.locator('#workspace').waitFor();
    expect(errors).toEqual([]);
},60_000);
