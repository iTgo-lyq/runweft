import type { Command } from 'commander';
import { closeSync, openSync, writeFileSync } from 'node:fs';
import { dataPaths, localUrl, type ResolvedConfig } from '../../config';
import { RunweftError } from '../../errors';
import { fetchJson } from '../../hapi';
import { validateState } from '../../state';
import { HubClient } from '../client';
import { IdentityConnection } from '../connect/client';
import { connectionOrigin } from '../connect/types';
import { HubStore } from '../store';
import { terminalInput } from './terminal';

type Output=(value:unknown,human:string)=>void;
export function addAccountCommands(program:Command,context:()=>ResolvedConfig,output:Output){
    const url=(override?:string)=>connectionOrigin.parse(override??context().config.hub.url??localUrl(context().config));
    const connection=()=>new IdentityConnection(context().home,url());
    const client=()=>new HubClient({url:url(),home:context().home,space:program.opts().space},'hubAccounts','hub_accounts_unavailable');
    const auth=program.command('auth').description('账号登录及当前命令行环境的授权');
    auth.command('status').action(async()=>{const value=await client().connection();output(value,JSON.stringify(value,null,2));});
    for(const register of [false,true])auth.command(register?'register':'login').description(register?'注册账号并连接本机':'登录账号并连接本机')
        .option('--url <url>','Hub HTTPS 或 localhost 地址').option('--username <name>','用户名').option('--interactive','用户在自己的终端隐藏输入密码')
        .action(async options=>{
            const target=url(options.url),session=new IdentityConnection(context().home,target);
            if(!options.interactive){const value=await session.begin();output(value,`请打开并核对：${value.confirmationUrl}\n核对码：${value.code}\nAgent 可用 hub connect complete --wait 60 继续。`);return;}
            if(!process.stdin.isTTY||!process.stderr.isTTY)throw new RunweftError('account_interaction_required','此操作需要用户在自己的终端输入。',`请在 ${target}/hub 完成登录，Agent 不应代收密码。`);
            process.stderr.write(`Hub：${target}\n此命令行环境将以你的账号使用有权访问的资源。\n`);
            const username=options.username??await terminalInput('用户名'),password=await terminalInput('密码',true);
            await session.password(username,password,register);
            const value=await session.complete({spaceId:program.opts().space,chooseSpace:async spaces=>{
                for(let i=0;i<spaces.length;i++)process.stderr.write(`${i+1}. ${spaces[i].name}\n`);
                const selected=Number(await terminalInput('默认空间编号'));return spaces[selected-1]?.id??'';
            }});output(value,'账号已连接，本机凭据已保存。');
        });
    auth.command('logout').description('撤销当前 CLI 授权；Runner 与任务保持独立').action(async()=>{output(await connection().logout(),'当前命令行环境已退出。');});
    const account=program.command('account').description('账号设置与部署者本机恢复操作');
    account.command('show').action(async()=>{const value=await client().user('/account');output(value,JSON.stringify(value,null,2));});
    account.command('rename <name>').action(async name=>{output(await client().user('/identity','PATCH',{name}),'显示名称已更新。');});
    account.command('password').description('隐藏输入当前密码和新密码，更新后退出全部用户环境').action(async()=>{
        const password=await terminalInput('当前密码',true),newPassword=await terminalInput('新密码',true);
        const value=await client().user('/account/password','POST',{password,newPassword});await connection().logout();output(value,'密码已更新，请重新登录。');
    });
    account.command('logout-all').action(async()=>{const password=await terminalInput('当前密码',true);
        const value=await client().user('/credentials/revoke-all','POST',{password});await connection().logout();output(value,'所有浏览器与命令行登录已退出。');});
    const credentials=account.command('credentials').description('查看或撤销本人登录环境，不输出秘密');
    credentials.command('list').action(async()=>{const value=await client().user('/credentials');output(value,JSON.stringify(value,null,2));});
    credentials.command('revoke <id>').action(async id=>{const c=client(),current=await c.user('/credentials');
        const value=await c.user('/credentials/'+encodeURIComponent(id),'DELETE');if(current.currentCredentialId===id)await connection().logout();output(value,'登录环境已撤销。');});
    account.command('recover').option('--url <url>','Hub 地址').option('--username <name>','用户名').description('隐藏输入部署者提供的一次性重置码及新密码').action(async options=>{
        const target=url(options.url),username=options.username??await terminalInput('用户名'),code=await terminalInput('一次性重置码',true),password=await terminalInput('新密码',true);
        const health=await fetchJson(target+'/api/runweft/health',{redirect:'error'});
        if(health?.service!=='runweft'||health?.capabilities?.hubAccounts!==1)throw new RunweftError('hub_accounts_unavailable','Hub 不支持当前账号协议。');
        try{const value=await fetchJson(target+'/api/runweft/hub/account/password-reset',{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({username,code,password})});output(value,'密码已重置，请重新登录。');}
        catch(error){if(error instanceof RunweftError)throw new RunweftError(error.code,[code,password].reduce((s,v)=>s.split(v).join('[redacted]'),error.message));throw new RunweftError('account_recovery_unknown','重置结果尚未确认，请先用新密码核对登录。');}
    });
    account.command('reset-password <username>').description('部署者本机签发重置码；不走远端用户 API，不创建缺失数据库')
        .requiredOption('--output <file>','明确的新文件位置（0600），不覆盖已有文件').action((username,options)=>{
            const path=dataPaths(context()).state;validateState(path); // validateState allows an absent fresh path; require existence before opening it.
            const fd=openSync(path,'r');closeSync(fd);
            const store=new HubStore(path);let out:number;try{out=openSync(options.output,'wx',0o600);}catch(error){store.close();throw error;}
            try{const value=store.accounts.resetCode(username);writeFileSync(out,value.code+'\n');output({username,expiresAt:value.expiresAt,file:options.output},`重置码已写入：${options.output}\n有效期 15 分钟，请通过可信渠道交给该用户。`);}
            finally{store.close();closeSync(out);}
        });
}
