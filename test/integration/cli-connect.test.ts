import { afterEach, beforeAll, expect, test } from 'bun:test';
import { existsSync, readFileSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWrite, loadConfig } from '../../src/config';
import { IdentityConnection } from '../../src/hub/connect/client';
import { HubClient } from '../../src/hub/client';
import { compiledCli } from './compiled-cli';
import { fixtureCleanup } from '../fixture-cleanup';
import { hubResourceFixture } from './hub-resources-fixture';

const owner=fixtureCleanup([]),cleanups=owner.resources;
afterEach(()=>owner.close());
let executable:string;
beforeAll(async()=>{executable=await compiledCli();},30_000);
const pending=(c:IdentityConnection)=>JSON.parse(readFileSync(c.paths.pendingConnection,'utf8'));
async function confirmed(h:Awaited<ReturnType<typeof hubResourceFixture>>,c:IdentityConnection){
    const value=pending(c),result=await h.request(`/api/runweft/connect/${value.requestId}/confirm`,h.a.token,'POST',{spaceId:h.a.personalSpace.id});
    expect(result.status).toBe(200);return value;
}
async function cli(home:string,url:string,args:string[]){
    const env={...process.env};delete env.RUNWEFT_IDENTITY_TOKEN;
    const child=Bun.spawn([executable,'--home',home,'--json','hub','--url',url,...args],{env,stdout:'pipe',stderr:'pipe'});
    const [exit,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
    return {exit,stdout,stderr,result:stdout.trim()?JSON.parse(stdout):undefined};
}

test('confirmation activates a distinct CLI credential before complete and compiled CLI saves it without ACK',async()=>{
    const h=await hubResourceFixture(cleanups),home=join(h.home,'client'),c=new IdentityConnection(home,h.url);
    const first=await cli(home,h.url,['connect','begin','--name','测试电脑']),repeat=await cli(home,h.url,['connect','begin','--name','测试电脑']);
    expect(first.exit).toBe(0);expect(first.result).toEqual(repeat.result);
    const before=pending(c);expect(statSync(c.paths.pendingConnection).mode&0o777).toBe(0o600);
    expect((await cli(home,h.url,['connect','complete'])).result.status).toBe('pending');
    await confirmed(h,c);await confirmed(h,c);
    expect(h.hub.authenticate(before.secret).id).toBe(h.a.identity.id);expect(before.secret).not.toBe(h.a.token);
    expect(h.hub.accounts.list(h.a.identity.id).filter(x=>x.kind==='cli')).toHaveLength(1);
    const done=await cli(home,h.url,['connect','complete']);expect(done.exit).toBe(0);expect(done.result.status).toBe('connected');
    expect(existsSync(c.paths.pendingConnection)).toBe(false);expect(statSync(c.paths.identityConnection).mode&0o777).toBe(0o600);
    expect((await cli(home,h.url,['identity'])).result.identity.id).toBe(h.a.identity.id);
    expect((await c.complete()).status).toBe('connected');expect(loadConfig(home,{}).config.hub.url).toBe(h.url);
    for(const output of [first,repeat,done])for(const secret of [before.secret,h.a.token])expect(output.stdout+output.stderr).not.toContain(secret);
    const row=h.access.db.query('SELECT * FROM hub_connection_requests').get() as any;
    expect(row.status).toBe('confirmed');expect(row.tokenDigest).not.toBe(before.secret);expect(row).not.toHaveProperty('ciphertext');
});

test('confirmed requests recover after original deadline and network failure using the same pending record',async()=>{
    const h=await hubResourceFixture(cleanups),c=new IdentityConnection(join(h.home,'client'),h.url);await c.begin();const value=await confirmed(h,c);
    h.access.db.query('UPDATE hub_connection_requests SET expiresAt=? WHERE id=?').run(Date.now()-1,value.requestId);
    const fetchOriginal=globalThis.fetch;globalThis.fetch=(async(input:any,init:any)=>{if(String(input).endsWith('/poll'))throw Error('offline');return fetchOriginal(input,init);}) as typeof fetch;
    try{await expect(c.complete()).rejects.toThrow();}finally{globalThis.fetch=fetchOriginal;}
    expect(pending(c).requestId).toBe(value.requestId);expect((await c.complete()).status).toBe('connected');
    expect(h.hub.accounts.list(h.a.identity.id).filter(x=>x.kind==='cli')).toHaveLength(1);
});

test('cancel before and after confirmation never leaves a credential active or affects the browser',async()=>{
    const h=await hubResourceFixture(cleanups),c=new IdentityConnection(join(h.home,'client'),h.url);await c.begin();let value=pending(c);
    await c.cancel();expect((await h.request(`/api/runweft/connect/${value.requestId}/confirm`,h.a.token,'POST',{spaceId:h.a.personalSpace.id})).status).toBe(410);
    await c.begin();value=await confirmed(h,c);await c.cancel();expect(()=>h.hub.authenticate(value.secret)).toThrow();
    expect(h.hub.authenticate(h.a.token).id).toBe(h.a.identity.id);
});

test('revoked grants never reactivate, pending expiry grants nothing, and newer local connections are not overwritten',async()=>{
    const h=await hubResourceFixture(cleanups),c=new IdentityConnection(join(h.home,'client'),h.url);await c.begin();const value=await confirmed(h,c);
    const grant=h.hub.accounts.authenticate(value.secret);h.hub.accounts.revoke(h.a.identity.id,grant.credential.id);
    await expect(c.complete()).rejects.toThrow();expect((await h.request(`/api/runweft/connect/${value.requestId}/confirm`,h.a.token,'POST',{spaceId:h.a.personalSpace.id})).status).toBe(410);
    await c.cancel();await c.begin();const expired=pending(c);h.access.db.query('UPDATE hub_connection_requests SET expiresAt=? WHERE id=?').run(Date.now()-1,expired.requestId);
    expect((await h.request(`/api/runweft/connect/${expired.requestId}/confirm`,h.a.token,'POST',{spaceId:h.a.personalSpace.id})).status).toBe(410);
    await c.cancel();await c.begin();await confirmed(h,c);
    atomicWrite(c.paths.identityConnection,JSON.stringify({schemaVersion:2,hub:h.url,ownerId:h.c.identity.id,spaceId:h.c.personalSpace.id,token:'rw_cli_'+'a'.repeat(43),requestId:crypto.randomUUID(),createdAt:Date.now()}));
    const before=readFileSync(c.paths.identityConnection,'utf8');await expect(c.complete()).rejects.toMatchObject({code:'hub_connection_changed'});expect(readFileSync(c.paths.identityConnection,'utf8')).toBe(before);
});

test('manual password authorization creates only a CLI environment and current records refuse legacy inputs',async()=>{
    const h=await hubResourceFixture(cleanups),c=new IdentityConnection(join(h.home,'client'),h.url);
    await c.password('human-user','a synthetic CLI passphrase',true);const before=pending(c);
    expect((await c.complete()).status).toBe('connected');const identity=h.hub.authenticate(before.secret);
    expect(h.hub.accounts.list(identity.id).map(x=>x.kind)).toEqual(['cli']);
    await c.logout();expect(()=>h.hub.authenticate(before.secret)).toThrow();expect(existsSync(c.paths.identityConnection)).toBe(false);
    expect(()=>new HubClient({url:h.url,home:c.paths.home,env:{RUNWEFT_IDENTITY_TOKEN:h.a.token}},'hubAccounts','unavailable')).toThrow('已移除');
    atomicWrite(c.paths.pendingConnection,JSON.stringify({schemaVersion:1,hub:h.url}));const raw=readFileSync(c.paths.pendingConnection,'utf8');
    expect(()=>c.status()).toThrow('当前格式');expect(readFileSync(c.paths.pendingConnection,'utf8')).toBe(raw);
});

test('machine ownership conflict cancels the new grant and preserves the existing machine file',async()=>{
    const h=await hubResourceFixture(cleanups),c=new IdentityConnection(join(h.home,'client'),h.url);await c.begin();const value=await confirmed(h,c);
    const machine=JSON.stringify({schemaVersion:1,hub:h.url,ownerId:h.c.identity.id,requestId:crypto.randomUUID(),active:{token:'rw_mc_'+'a'.repeat(43)},createdAt:Date.now()});
    atomicWrite(c.paths.machineConnection,machine);
    await expect(c.complete()).rejects.toMatchObject({code:'machine_connection_owner_mismatch'});
    expect(readFileSync(c.paths.machineConnection,'utf8')).toBe(machine);
    expect(existsSync(c.paths.identityConnection)).toBe(false);expect(()=>h.hub.authenticate(value.secret)).toThrow();
});


test('a configuration save failure retains the same grant and pending record for completion',async()=>{
    const h=await hubResourceFixture(cleanups),home=join(h.home,'client'),c=new IdentityConnection(home,h.url);await c.begin();const value=await confirmed(h,c);
    const blocked=join(home,'config.yaml');mkdirSync(blocked);
    await expect(c.complete()).rejects.toThrow();expect(pending(c).requestId).toBe(value.requestId);expect(existsSync(c.paths.identityConnection)).toBe(true);
    rmSync(blocked,{recursive:true});expect((await c.complete()).status).toBe('connected');
    expect(h.hub.accounts.list(h.a.identity.id).filter(x=>x.kind==='cli')).toHaveLength(1);
});
