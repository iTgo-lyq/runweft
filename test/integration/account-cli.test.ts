import { afterEach, beforeAll, expect, test } from 'bun:test';
import { existsSync, readFileSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from '../helpers';
import { dataPaths, loadConfig } from '../../src/config';
import { HubStore } from '../../src/hub/store';
import { compiledCli } from './compiled-cli';
import { fixtureCleanup } from '../fixture-cleanup';
import { hubResourceFixture } from './hub-resources-fixture';
const owner=fixtureCleanup([]),cleanups=owner.resources;
afterEach(()=>owner.close());let binary:string;
beforeAll(async()=>{binary=await compiledCli();},30_000);
async function terminal(home:string,args:string[],answers:[string,string][]){
    let output='',index=0;const decoder=new TextDecoder();
    await using tty=new Bun.Terminal({cols:160,rows:30,data(t,data){output+=decoder.decode(data,{stream:true});
        if(index<answers.length&&output.includes(answers[index][0])){const answer=answers[index++][1];t.write(answer+'\r');}}});
    const env={...process.env,HOME:home,CODEX_HOME:join(home,'codex'),CLAUDE_CONFIG_DIR:join(home,'claude')};delete (env as NodeJS.ProcessEnv).RUNWEFT_IDENTITY_TOKEN;
    const child=Bun.spawn([binary,'--home',home,...args],{env,terminal:tty});
    const timer=setTimeout(()=>child.kill(),15_000);
    try{const exit=await child.exited;expect(exit).toBe(0);expect(index).toBe(answers.length);for(const [,answer] of answers)expect(output).not.toContain(answer);}
    finally{clearTimeout(timer);if(child.exitCode===null)child.kill();}
}

test('human CLI register, login, password change and recovery use hidden input and preserve the same identity',async()=>{
    const h=await hubResourceFixture(cleanups),home=join(h.home,'human');
    await terminal(home,['auth','register','--url',h.url,'--username','tty-user','--interactive'],[['密码：','a synthetic terminal passphrase']]);
    const account=h.hub.accounts.account('tty-user')!;
    await terminal(home,['account','password'],[['当前密码：','a synthetic terminal passphrase'],['新密码：','a changed terminal passphrase']]);
    await terminal(home,['auth','login','--url',h.url,'--username','tty-user','--interactive'],[['密码：','a changed terminal passphrase']]);
    const reset=h.hub.accounts.resetCode('tty-user');
    await terminal(home,['account','recover','--url',h.url,'--username','tty-user'],[['一次性重置码：',reset.code],['新密码：','a recovered terminal passphrase']]);
    expect((await h.hub.accounts.login('tty-user','a recovered terminal passphrase')).identity.id).toBe(account.userId);
},30_000);

test('deployer reset writes a fresh 0600 file and refuses an absent Hub database',async()=>{
    const home=fixture('account-admin');cleanups.push(()=>rmSync(home,{recursive:true,force:true}));
    const paths=dataPaths(loadConfig(home,{})),output=join(home,'reset-code.txt');
    const missing=Bun.spawn([binary,'--home',home,'account','reset-password','alice','--output',output],{stdout:'pipe',stderr:'pipe'});
    expect(await missing.exited).toBe(1);expect(existsSync(paths.state)).toBe(false);expect(existsSync(output)).toBe(false);
    const store=new HubStore(paths.state);cleanups.push(()=>store.close());await store.accounts.register('alice','an isolated admin passphrase');
    const child=Bun.spawn([binary,'--home',home,'--json','account','reset-password','alice','--output',output],{stdout:'pipe',stderr:'pipe'});
    const [exit,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
    expect(exit).toBe(0);const code=readFileSync(output,'utf8').trim();expect(statSync(output).mode&0o777).toBe(0o600);expect(stdout+stderr).not.toContain(code);
    await store.accounts.recover('alice',code,'a recovered admin passphrase');
});
