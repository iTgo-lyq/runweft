import { afterEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { accountWebFixture } from './account-web-fixture';
import { fixtureCleanup } from '../fixture-cleanup';
import { IdentityConnection } from '../../src/hub/connect/client';
import { HubStore } from '../../src/hub/store';
import { loadConfig } from '../../src/config';
import { forwardedHub } from './forwarded-hub';
import { button, field, fillAccount, hubTab } from './hub-web';
const owner=fixtureCleanup([]);afterEach(()=>owner.close());

test('one browser form registers and activates CLI authorization; a new tab signs in and a live tab only confirms',async()=>{
    const h=await accountWebFixture(owner.resources),session=new IdentityConnection(h.clientHome,h.url),request=await session.begin('测试电脑');
    const {page,problems:errors}=await hubTab(h.browser),authorized=()=>page.getByRole('heading',{name:'可以返回原对话了'}).waitFor();
    await page.goto(request.confirmationUrl);await button(page,'注册并连接').waitFor();
    const side=page.getByRole('complementary',{name:'核对连接请求'});await side.getByText(request.code,{exact:true}).waitFor();await side.getByText('测试电脑',{exact:true}).waitFor();
    await page.route('**/api/runweft/connect/*/confirm',async route=>{await route.fetch();await route.abort('failed');},{times:1});
    await fillAccount(page,'connect-user','an isolated connect passphrase');await button(page,'注册并连接').click();await authorized();
    const pending=JSON.parse(readFileSync(session.paths.pendingConnection,'utf8')),store=new HubStore(h.paths.state);owner.resources.push(()=>store.close());
    expect(store.authenticate(pending.secret).name).toBe('connect-user');expect((await h.cli(['hub','--url',h.url,'connect','complete'])).status).toBe('connected');
    const next=new IdentityConnection(join(h.root,'second-client'),h.url),second=await next.begin('第二个终端'),tab=await h.browser.newPage();
    await tab.goto(second.confirmationUrl);await button(tab,'已有账号？登录').click();await fillAccount(tab,'connect-user','an isolated connect passphrase');await button(tab,'登录并连接').click();await tab.getByRole('heading',{name:'可以返回原对话了'}).waitFor();
    expect((await next.complete()).status).toBe('connected');
    const same=new IdentityConnection(join(h.root,'same-tab-client'),h.url),third=await same.begin();await page.goto(third.confirmationUrl);await button(page,'确认连接此账号').waitFor();expect(await field(page,'用户名').count()).toBe(0);
    await button(page,'确认连接此账号').click();await authorized();expect((await same.complete()).status).toBe('connected');
    await button(page,'查看工作台').click();await page.getByRole('navigation',{name:'主导航'}).waitFor();expect(page.url()).not.toContain('connect=');
    const dead=new IdentityConnection(join(h.root,'expired-client'),h.url),expired=await dead.begin();store.db.query('UPDATE hub_connection_requests SET expiresAt=? WHERE id=?').run(Date.now()-1,expired.requestId);
    await page.goto(expired.confirmationUrl);await page.getByRole('heading',{name:'这个连接请求已不可用'}).waitFor();await page.getByText(/已过期|取消/).first().waitFor();
    await button(page,'查看工作台').click();await page.getByRole('navigation',{name:'主导航'}).waitFor();
    expect(errors).toEqual([]);
},60_000);

test('a browser reached through a different hostname and port registers, signs in and confirms the original CLI request',async()=>{
    const h=await accountWebFixture(owner.resources),forward=await forwardedHub(h.url,owner.resources);
    const session=new IdentityConnection(h.clientHome,h.url),request=await session.begin('转发连接测试');
    const {page,problems:errors}=await hubTab(h.browser);
    const link=forward.link(request.confirmationUrl);
    expect(new URL(link).host).not.toBe(new URL(h.url).host);
    expect(new URL(link).hostname).toBe('localhost');expect(new URL(h.url).hostname).toBe('127.0.0.1');
    expect(new URL(link).hash).toBe(new URL(request.confirmationUrl).hash);
    await page.goto(link);await fillAccount(page,'forwarded-user','an isolated forwarded passphrase');await button(page,'注册并连接').click();
    await page.getByRole('heading',{name:'可以返回原对话了'}).waitFor({timeout:5000});
    const done=await h.cli(['hub','--url',h.url,'connect','complete']);expect(done.status).toBe('connected');
    expect(loadConfig(h.clientHome,{}).config.hub.url).toBe(h.url);
    const store=new HubStore(h.paths.state);owner.resources.push(()=>store.close());
    const retry=await page.evaluate(async({id,spaceId})=>{
        const {token}=JSON.parse(sessionStorage.getItem('runweft.hub.session')!);
        return (await fetch(`/api/runweft/connect/${id}/confirm`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({spaceId})})).status;
    },{id:request.requestId,spaceId:done.spaceId});
    expect(retry).toBe(200);expect(store.accounts.list(done.ownerId).filter(value=>value.kind==='cli')).toHaveLength(1);

    const second=new IdentityConnection(join(h.root,'forwarded-second'),h.url),next=await second.begin('转发登录测试');
    const tab=await h.browser.newPage();await tab.goto(forward.link(next.confirmationUrl));await tab.getByText(next.code,{exact:true}).waitFor();
    const replacement=await forwardedHub(h.url,owner.resources);expect(replacement.url).not.toBe(forward.url);
    await tab.goto(replacement.link(next.confirmationUrl));await tab.getByText(next.code,{exact:true}).waitFor();
    expect(second.status().pending?.requestId).toBe(next.requestId);await button(tab,'已有账号？登录').click();
    await fillAccount(tab,'forwarded-user','an isolated forwarded passphrase');
    await button(tab,'登录并连接').click();await tab.getByRole('heading',{name:'可以返回原对话了'}).waitFor();expect((await second.complete()).status).toBe('connected');
    const third=new IdentityConnection(join(h.root,'forwarded-third'),h.url),pending=await third.begin('已登录标签确认');
    await page.goto(forward.link(pending.confirmationUrl));await button(page,'确认连接此账号').waitFor();
    expect(await field(page,'用户名').count()).toBe(0);
    const token=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('runweft.hub.session')!).token as string);
    for(const origin of ['https://other.example','null','not-an-origin']){
        const refused=await fetch(`${forward.url}/api/runweft/connect/${pending.requestId}/confirm`,{method:'POST',headers:{origin,authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({spaceId:done.spaceId})});
        expect(refused.status).toBe(403);expect((await refused.json() as any).error.code).toBe('account_origin_invalid');
    }
    expect((await fetch(`${forward.url}/api/runweft/connect/${pending.requestId}`)).status).toBe(200);
    expect((await fetch(`${forward.url}/api/runweft/connect/${crypto.randomUUID()}`)).status).toBe(404);
    const other=await h.api('/api/runweft/hub/accounts','',{username:'forwarded-outsider',password:'a different synthetic passphrase'});expect(other.status).toBe(201);
    const denied=await fetch(`${forward.url}/api/runweft/connect/${pending.requestId}/confirm`,{method:'POST',headers:{origin:forward.url,authorization:`Bearer ${other.body.token}`,'content-type':'application/json'},body:JSON.stringify({spaceId:done.spaceId})});
    expect(denied.status).toBe(404);
    await button(page,'确认连接此账号').click();await page.getByRole('heading',{name:'可以返回原对话了'}).waitFor();
    expect((await third.complete()).status).toBe('connected');expect(errors).toEqual([]);
},60_000);

test('an account with several spaces picks the default space before connecting, or leaves without connecting',async()=>{
    const h=await accountWebFixture(owner.resources),password='a synthetic multi-space passphrase';
    const account=await h.api('/api/runweft/hub/accounts','',{username:'multi-space',password});expect(account.status).toBe(201);
    const team=await h.api('/api/runweft/hub/spaces',account.body.token,{name:'第二个空间'});expect(team.status).toBe(200);
    const session=new IdentityConnection(h.clientHome,h.url),request=await session.begin('多空间终端');
    const {page,problems}=await hubTab(h.browser);await page.goto(request.confirmationUrl);
    await button(page,'已有账号？登录').click();await fillAccount(page,'multi-space',password);await button(page,'登录并连接').click();
    await button(page,'确认连接此账号').waitFor();await field(page,'连接后默认使用的空间').selectOption({label:'第二个空间'});
    await button(page,'确认连接此账号').click();await page.getByRole('heading',{name:'可以返回原对话了'}).waitFor();
    const done=await session.complete();expect(done.status).toBe('connected');expect(session.status().spaceId).toBe(team.body.space.id);
    const later=new IdentityConnection(join(h.root,'declined-client'),h.url),declined=await later.begin('不连接的终端');
    await page.goto(declined.confirmationUrl);await button(page,'不连接，前往工作台').click();
    await page.getByRole('navigation',{name:'主导航'}).waitFor();expect(page.url()).not.toContain('connect=');
    expect((await h.api(`/api/runweft/connect/${declined.requestId}`)).body.status).toBe('pending');expect(problems).toEqual([]);
},60_000);
