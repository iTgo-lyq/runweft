import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { hostname } from 'node:os';
import { z } from 'zod';
import { atomicWrite, loadConfig, setConfig } from '../../config';
import { RunweftError } from '../../errors';
import { fetchJson, HapiRequestError } from '../../hapi';
import { HubClient } from '../client';
import { createUserSecret } from '../accounts/credentials';
import { HubName } from '../types';
import { connectionFileLock, hubConnectionPaths, readMachineConnection } from '../resources/connection';
import { IdentityConnectionSchema, readIdentityConnection, type IdentityConnectionRecord } from './record';
import { PollingSecret, connectionOrigin } from './types';

const PendingSchema=z.object({schemaVersion:z.literal(2),requestId:z.uuid(),hub:connectionOrigin,label:HubName,secret:PollingSecret,
    priorDigest:z.string().nullable(),createdAt:z.number(),expiresAt:z.number()}).strict();
type Pending=z.infer<typeof PendingSchema>;
const RequestSchema=z.object({id:z.uuid(),origin:connectionOrigin,label:HubName,code:z.string().regex(/^[A-F0-9]{8}$/),
    expiresAt:z.number(),status:z.enum(['pending','confirmed','cancelled'])});
const PollSchema=z.discriminatedUnion('status',[
    z.object({status:z.literal('confirmed'),ownerId:z.uuid(),spaceId:z.uuid().nullable(),credentialId:z.uuid(),expiresAt:z.number()}),
    z.object({status:z.enum(['pending','cancelled']),expiresAt:z.number().optional()}),
]);
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const changed=()=>new RunweftError('hub_connection_changed','本机的连接请求或身份已改变，未覆盖现有记录。','核对 connect status，保留较新的连接。');
const invalid=()=>new RunweftError('hub_connection_response_invalid','Hub 连接响应无法验证。','核对地址和原请求，不重复创建账号。');
export type CompleteOptions={waitMs?:number;spaceId?:string;signal?:AbortSignal;chooseSpace?:(spaces:{id:string;name:string}[])=>Promise<string>};

export class IdentityConnection {
    readonly paths:ReturnType<typeof hubConnectionPaths>;
    constructor(home:string,url:string){
        const parsed=connectionOrigin.safeParse(url);
        if(!parsed.success)throw new RunweftError('hub_connect_https_required','请选择 HTTPS 或 localhost Hub 地址。');
        this.paths=hubConnectionPaths(home,parsed.data);
    }
    private pending():Pending|undefined{
        if(!existsSync(this.paths.pendingConnection))return;
        try{const value=PendingSchema.parse(JSON.parse(readFileSync(this.paths.pendingConnection,'utf8')));if(value.hub!==this.paths.hub)throw invalid();return value;}
        catch{throw new RunweftError('hub_connect_record_invalid','待连接记录不是当前格式，原文件已保留。','检查 connect.json；不会自动清理。');}
    }
    private identity(){return readIdentityConnection(this.paths.home,this.paths.hub);}
    private currentDigest(){return existsSync(this.paths.identityConnection)?digest(readFileSync(this.paths.identityConnection,'utf8')):null;}
    private summary(record:IdentityConnectionRecord){return {hub:record.hub,ownerId:record.ownerId,spaceId:record.spaceId,requestId:record.requestId,identityFile:this.paths.identityConnection};}
    status(){const pending=this.pending(),record=this.identity();return {hub:this.paths.hub,connected:!!record,...(record?this.summary(record):{}),
        ...(pending?{pending:{requestId:pending.requestId,label:pending.label,expiresAt:pending.expiresAt}}:{})};}
    private async request(path:string,body?:object,secret?:string,secrets:string[]=[],signal?:AbortSignal){
        try{
            const health=await fetchJson(this.paths.hub+'/api/runweft/health',{redirect:'error',signal});
            if(health?.service!=='runweft'||health?.capabilities?.hubConnect!==2||health?.capabilities?.hubAccounts!==1)throw new RunweftError('hub_connect_unavailable','Hub 与当前账号连接协议不匹配。','升级配套 Hub。');
            return await fetchJson(this.paths.hub+'/api/runweft/connect'+path,{method:'POST',redirect:'error',signal,
                headers:{...(secret?{authorization:`Bearer ${secret}`} :{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
        }catch(error){
            signal?.throwIfAborted();
            if(!(error instanceof RunweftError))throw new RunweftError('hub_connect_failed','Hub 请求结果未确认。','恢复网络后使用原请求续接，本地待连接记录已保留。');
            const clean=(value?:string)=>[secret,...secrets].filter((x):x is string=>!!x).reduce((result,x)=>result?.split(x).join('[redacted]'),value);
            throw new HapiRequestError(error instanceof HapiRequestError?error.status:503,clean(error.code)!,clean(error.message)!,clean(error.hint));
        }
    }
    async begin(label?:string){
        if(label!==undefined&&!HubName.safeParse(label).success)throw new RunweftError('hub_connect_label_invalid','连接名称无效。');
        const pending=connectionFileLock(this.paths,()=>{
            const current=this.pending();if(current){if(label!==undefined&&current.label!==label.trim())throw changed();return current;}
            const now=Date.now(),value:Pending={schemaVersion:2,hub:this.paths.hub,label:label?.trim()??hostname(),requestId:randomUUID(),
                secret:createUserSecret('cli').token,priorDigest:this.currentDigest(),createdAt:now,expiresAt:now+600_000};
            atomicWrite(this.paths.pendingConnection,JSON.stringify(value,null,2)+'\n');return value;
        });
        const parsed=RequestSchema.safeParse(await this.request('',{requestId:pending.requestId,origin:pending.hub,label:pending.label,tokenDigest:digest(pending.secret)},undefined,[pending.secret]));
        if(!parsed.success||parsed.data.id!==pending.requestId||parsed.data.origin!==pending.hub||parsed.data.label!==pending.label)throw invalid();
        return {requestId:pending.requestId,hub:pending.hub,label:pending.label,code:parsed.data.code,expiresAt:parsed.data.expiresAt,status:parsed.data.status,
            confirmationUrl:`${pending.hub}/hub#connect=${pending.requestId}`};
    }
    async password(username:string,password:string,register=false){
        await this.begin();const pending=this.pending()!;
        // A response may have been lost after authorization; query it before requesting another password-based grant.
        const current=PollSchema.parse(await this.request(`/${pending.requestId}/poll`,undefined,pending.secret,[],undefined));
        if(current.status==='confirmed')return {status:'confirmed'};
        await this.request(`/${pending.requestId}/password`,{username,password,register},pending.secret,[password]);
        return {status:'confirmed'};
    }
    async complete(options:CompleteOptions={}){
        const pending=this.pending();
        if(!pending){const record=this.identity();if(!record)throw new RunweftError('hub_connect_required','没有待完成的连接，请先发起登录。');
            await new HubClient({url:record.hub,home:this.paths.home,credential:record},'hubAccounts','hub_accounts_unavailable').connection();
            return {status:'connected' as const,...this.summary(record)};}
        const end=Date.now()+Math.min(Math.max(options.waitMs??0,0),300_000);
        let reply:z.infer<typeof PollSchema>;
        while(true){
            options.signal?.throwIfAborted();
            const parsed=PollSchema.safeParse(await this.request(`/${pending.requestId}/poll`,undefined,pending.secret,[],options.signal));
            if(!parsed.success)throw invalid();reply=parsed.data;
            if(reply.status!=='pending'||Date.now()>=end)break;
            await new Promise<void>((resolve,reject)=>{const done=()=>{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);};
                const abort=()=>{done();reject(options.signal?.reason);};const timer=setTimeout(()=>{done();resolve();},Math.min(1000,end-Date.now()));options.signal?.addEventListener('abort',abort,{once:true});});
        }
        if(reply.status==='pending')return {status:'pending' as const,requestId:pending.requestId,expiresAt:reply.expiresAt,confirmationUrl:`${pending.hub}/hub#connect=${pending.requestId}`};
        if(reply.status!=='confirmed')throw new RunweftError('hub_connect_cancelled','连接请求已取消。');
        const client=new HubClient({url:pending.hub,home:this.paths.home,credential:{token:pending.secret,ownerId:reply.ownerId}},'hubAccounts','hub_accounts_unavailable');
        if((await client.identity()).id!==reply.ownerId)throw invalid();
        const spaces=(await client.user('/spaces')).spaces as {id:string;name:string}[];
        let spaceId=options.spaceId??reply.spaceId??this.identity()?.spaceId;
        if(!spaces.some(space=>space.id===spaceId))spaceId=spaces.length===1?spaces[0].id:options.chooseSpace?await options.chooseSpace(spaces):undefined;
        if(!spaceId||!spaces.some(space=>space.id===spaceId))throw new RunweftError('hub_space_required','请选择一个可访问的默认空间。','使用 complete --space <id> 或人工交互登录；待连接记录已保留。');
        const record:IdentityConnectionRecord={schemaVersion:2,hub:pending.hub,ownerId:reply.ownerId,spaceId,token:pending.secret,requestId:pending.requestId,createdAt:Date.now()};
        await new HubClient({url:record.hub,home:this.paths.home,credential:record},'hubAccounts','hub_accounts_unavailable').connection();
        try{
            connectionFileLock(this.paths,()=>{
                const current=this.identity(),same=current?.requestId===pending.requestId&&current.token===pending.secret;
                if(!same&&(this.pending()?.requestId!==pending.requestId||this.currentDigest()!==pending.priorDigest))throw changed();
                const machine=readMachineConnection(this.paths.home,pending.hub);
                if(machine&&machine.ownerId!==record.ownerId)throw new RunweftError('machine_connection_owner_mismatch','此 Hub 的机器记录属于另一身份，已保留原连接。');
                if(!same)atomicWrite(this.paths.identityConnection,JSON.stringify(IdentityConnectionSchema.parse(record),null,2)+'\n');
                setConfig(loadConfig(this.paths.home,{}),'hub.url',record.hub);
                if(this.pending()?.requestId===pending.requestId)unlinkSync(this.paths.pendingConnection);
            });
        }catch(error){if(error instanceof RunweftError&&error.code==='machine_connection_owner_mismatch')await this.cancel();throw error;}
        return {status:'connected' as const,...this.summary(record)};
    }
    async cancel(){
        const pending=this.pending();if(pending){
            const reply=await this.request(`/${pending.requestId}/cancel`,undefined,pending.secret);
            if(reply?.status!=='cancelled')throw invalid();
            connectionFileLock(this.paths,()=>{if(this.pending()?.requestId===pending.requestId)unlinkSync(this.paths.pendingConnection);});
        }
        return {hub:this.paths.hub,status:'cancelled',requestId:pending?.requestId};
    }
    async logout(){
        const record=this.identity();if(!record)return {loggedOut:true};
        const before=this.currentDigest();
        try{await new HubClient({url:record.hub,home:this.paths.home,credential:record},'hubAccounts','hub_accounts_unavailable').user('/sessions/logout','POST',{});}
        catch(error){if(!(error instanceof HapiRequestError)||error.status!==401)throw error;}
        connectionFileLock(this.paths,()=>{if(this.currentDigest()!==before)throw changed();unlinkSync(this.paths.identityConnection);});
        return {loggedOut:true};
    }
}
