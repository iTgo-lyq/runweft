import { afterEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { hubDelegationFixture } from './hub-delegation-fixture';
import { fixtureCleanup } from '../fixture-cleanup';
import { IdentityConnection } from '../../src/hub/connect/client';
import { integrationBinaries } from './binaries';
import { until } from '../helpers';
import { forwardedHub } from './forwarded-hub';
import { hubTab, savedSession, signIn } from './hub-web';
const owner=fixtureCleanup([]);afterEach(()=>owner.close());

for(const forwarded of [false,true])test(`CLI task links restore the task space after browser login (${forwarded?'TCP forwarding':'direct'}) and keep the report from other members`,async()=>{
    const h=await hubDelegationFixture(owner.resources),accepted=await h.post('spawn',h.payload());
    const entry=forwarded?await forwardedHub(h.url,owner.resources):{url:h.url,link:(value:string)=>value};
    const active=await until(()=>h.post('read',{id:accepted.agent_id}),value=>value.inputs[0]?.observation?.phase==='accepted');
    h.complete(active.session_id,'A private task report for the link');await until(()=>h.post('read',{id:accepted.agent_id}),value=>value.status==='completed');
    const username=(h.hub.db.query('SELECT username FROM hub_accounts WHERE userId=?').get(h.owner.identity.id) as {username:string}).username;
    const home=join(h.home,'query-only-client'),session=new IdentityConnection(home,h.url);
    await session.password(username,'synthetic unknown-account comparison');await session.complete();
    const child=Bun.spawn([integrationBinaries().runweft.path,'--home',home,'--json','task','open',accepted.agent_id,'--round',accepted.round_id,'--print'],{stdout:'pipe',stderr:'pipe'});
    const [exit,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);expect(exit).toBe(0);expect(stderr).toBe('');
    const original=JSON.parse(stdout).url as string,link=entry.link(original);expect(new URL(original).origin).toBe(h.url);
    expect(new URL(link).hash).toBe(new URL(original).hash);expect(link).toContain('/hub#space=');expect(link).toContain(accepted.agent_id);expect(link).not.toContain(h.owner.token);
    // The task inspector and native handoff return with the new tasks page (T11); the link already restores the space.
    const browser=await chromium.launch({headless:true});owner.resources.push(()=>browser.close());const {page,problems}=await hubTab(browser);
    await page.goto(link);await signIn(page,username,'synthetic unknown-account comparison');
    expect(new URL(page.url()).hash).toBe(new URL(original).hash);expect(await page.getByRole('link',{name:'任务',exact:true}).getAttribute('aria-current')).toBe('page');
    expect((await savedSession(page))!.spaceId).toBe(new URLSearchParams(new URL(original).hash.slice(1)).get('space')!);
    const other=(h.hub.db.query('SELECT username FROM hub_accounts WHERE userId=?').get(h.other.identity.id) as {username:string}).username;
    // Another member of the space reaches it but never the private report; T11 checks the task itself is refused.
    const outsider=await hubTab(browser);await outsider.page.goto(link);await signIn(outsider.page,other,'synthetic unknown-account comparison');
    expect(await outsider.page.locator('body').innerText()).not.toContain('A private task report for the link');expect([...problems,...outsider.problems]).toEqual([]);
},30_000);
