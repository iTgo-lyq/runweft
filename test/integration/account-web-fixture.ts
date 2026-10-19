import { chromium } from 'playwright';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { fixture } from '../helpers';
import { fixtureCleanup } from '../fixture-cleanup';
import { freePort } from '../../src/services';
import { dataPaths, loadConfig } from '../../src/config';
import { integrationBinaries } from './binaries';

export async function accountWebFixture(cleanups:(()=>void|Promise<void>)[]){
    const cleanup=fixtureCleanup(cleanups),root=fixture('account-web'),home=join(root,'hub'),clientHome=join(root,'client');let started=false;
    cleanup.resources.push(()=>{if(started)throw Error('Hub still running; preserve isolated fixture');rmSync(root,{recursive:true,force:true});});
    const binary=integrationBinaries().runweft.path,port=await freePort(),url=`http://127.0.0.1:${port}`;
    const env={...process.env,HOME:root,CODEX_HOME:join(root,'codex'),CLAUDE_CONFIG_DIR:join(root,'claude')};
    for(const name of Object.keys(env))if(name.startsWith('RUNWEFT_')||name.startsWith('HAPI_'))delete (env as NodeJS.ProcessEnv)[name];
    const run=async(selectedHome:string,args:string[])=>{
        const child=Bun.spawn([binary,'--home',selectedHome,'--json',...args],{env,stdout:'pipe',stderr:'pipe'});
        const [exit,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
        if(exit!==0)throw Error(`Fixture CLI failed (${exit}): ${stderr}`);return JSON.parse(stdout);
    };
    cleanup.resources.push(async()=>{if(started){await run(home,['stop']);started=false;}});
    try{
        await run(home,['init']);await run(home,['config','set','server.port',String(port)]);started=true;await run(home,['start']);
        const browser=await chromium.launch({headless:true,...(process.env.RUNWEFT_SMOKE_CHROMIUM?{executablePath:process.env.RUNWEFT_SMOKE_CHROMIUM}:{})});
        cleanup.resources.push(()=>browser.close());
        const api=async(path:string,token='',body?:object,method=body?'POST':'GET')=>{
            const response=await fetch(url+path,{method,headers:{...(token?{authorization:`Bearer ${token}`} :{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
            return {status:response.status,body:await response.json() as any};
        };
        return {root,home,clientHome,url,browser,api,paths:dataPaths(loadConfig(home,{})),cli:(args:string[],selectedHome=clientHome)=>run(selectedHome,args),service:(args:string[])=>run(home,args)};
    }catch(error){return cleanup.failed(error);}
}
