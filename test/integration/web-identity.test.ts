import { afterEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import type { Page } from 'playwright';
import { accountWebFixture } from './account-web-fixture';
import { fixtureCleanup } from '../fixture-cleanup';
const owner=fixtureCleanup([]);afterEach(()=>owner.close());
test('remote plaintext Web login refuses to transmit account passwords',async()=>{
    const h=await accountWebFixture(owner.resources),page=await h.browser.newPage(),origin='http://runweft-account.invalid';let writes=0;
    await page.route(origin+'/**',async route=>{
        const request=route.request(),url=new URL(request.url());
        if(request.method()!=='GET'){writes++;await route.fulfill({status:500,body:'Unexpected write'});return;}
        const response=await fetch(h.url+url.pathname+url.search);await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
    });
    await page.goto(origin+'/hub');await page.locator('#account-username').fill('plaintext-user');await page.locator('#account-password').fill('a synthetic plaintext test passphrase');await page.locator('#auth-submit').click();
    await page.locator('#notice[data-error=true]').waitFor();expect(await page.locator('#notice').innerText()).toContain('HTTPS');expect(writes).toBe(0);
},30_000);
async function login(page:Page,username:string,password:string){
    await page.locator('#account-username').fill(username);await page.locator('#account-password').fill(password);await page.locator('#auth-submit').click();await page.waitForFunction(()=>!document.getElementById('workspace')?.hidden||document.getElementById('notice')?.dataset.error==='true');if(!await page.locator('#workspace').isVisible())throw Error(await page.locator('#notice').innerText());
}

test('Web account lifecycle keeps identity, isolates browser environments and supports password recovery',async()=>{
    const h=await accountWebFixture(owner.resources),a=await h.browser.newPage({viewport:{width:1365,height:960}}),b=await h.browser.newPage();
    const errors:string[]=[];a.on('pageerror',error=>errors.push(error.message));b.on('pageerror',error=>errors.push(error.message));
    await a.goto(h.url+'/hub');await a.locator('#toggle-auth').click();await login(a,'alice','an isolated browser passphrase');
    const id=await a.locator('#identity-id').innerText(),saved=JSON.parse(await a.evaluate(()=>sessionStorage.getItem('runweft.hub.session')) as string);
    expect(saved.token).toMatch(/^rw_web_/);expect(await a.locator('#secret-dialog').isVisible()).toBe(false);expect(await a.locator('body').innerText()).not.toContain(saved.token);
    await b.goto(h.url+'/hub');await login(b,'alice','an isolated browser passphrase');const other=JSON.parse(await b.evaluate(()=>sessionStorage.getItem('runweft.hub.session')) as string);
    await a.locator('#logout').click();await a.locator('#entry').waitFor();
    expect((await h.api('/api/runweft/hub/identity',saved.token)).status).toBe(401);expect((await h.api('/api/runweft/hub/identity',other.token)).status).toBe(200);
    await login(a,'alice','an isolated browser passphrase');expect(await a.locator('#identity-id').innerText()).toBe(id);
    const active=JSON.parse(await a.evaluate(()=>sessionStorage.getItem('runweft.hub.session')) as string);
    const envs=await h.api('/api/runweft/hub/credentials',other.token),otherId=envs.body.currentCredentialId;
    await a.locator('#show-settings').click();await a.locator(`[data-credential-id="${otherId}"]`).getByRole('button',{name:'断开环境'}).click();
    await a.locator('#confirm-dialog button[value=yes]').click();await a.locator(`[data-credential-id="${otherId}"] button`).waitFor({state:'hidden'});
    await b.reload();await b.locator('#entry').waitFor();
    await a.locator('#current-password').fill('the wrong current passphrase');await a.locator('#next-password').fill('a changed browser passphrase');await a.locator('#change-password button[type=submit]').click();await a.locator('#notice[data-error=true]').waitFor();expect(await a.locator('#account-settings').isVisible()).toBe(true);await a.locator('#current-password').fill('an isolated browser passphrase');await a.locator('#change-password button[type=submit]').click();await a.locator('#entry').waitFor();
    expect((await h.api('/api/runweft/hub/identity',active.token)).status).toBe(401);
    await login(a,'alice','a changed browser passphrase');expect(await a.locator('#identity-id').innerText()).toBe(id);await a.locator('#logout').click();
    await a.locator('#forgot-password').click();await a.locator('#reset-username').fill('alice');
    const file=join(h.root,'reset-code.txt');await h.service(['account','reset-password','alice','--output',file]);
    await a.locator('#reset-code').fill(readFileSync(file,'utf8').trim());await a.locator('#reset-password').fill('a recovered browser passphrase');await a.locator('#reset-form button[type=submit]').click();
    await a.locator('#auth-form').waitFor();await login(a,'alice','a recovered browser passphrase');expect(await a.locator('#identity-id').innerText()).toBe(id);
    await a.setViewportSize({width:390,height:844});expect(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
},60_000);
