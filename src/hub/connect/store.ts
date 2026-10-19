import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AccessStore } from '../access/store';
import { fingerprint } from '../access/transport';
import { tokenDigest } from '../store';
import { HubError, hubNotFound, hubUnauthorized } from '../types';
import { accountUsername, hashAccountPassword } from '../accounts/password';
import { BeginConnection, ConfirmConnection, PollingSecret, connectionInput, type ConnectionRequest } from './types';

type Row = ConnectionRequest & { fingerprint: string; tokenDigest: string; ownerId: string | null; spaceId: string | null; credentialId: string | null };
const expired = () => new HubError(410,'connection_request_expired','连接请求已过期或取消。','取消原请求后让 Agent 重新发起连接。');
const conflict = () => new HubError(409,'connection_request_conflict','此连接请求已使用其他参数或身份。','请使用原请求，不要改绑身份。');
export class ConnectionRequestStore {
    constructor(readonly access: AccessStore) {}
    private get(id: string): Row {
        connectionInput(z.uuid(),id);
        const row = this.access.db.query('SELECT * FROM hub_connection_requests WHERE id=?').get(id) as Row | null;
        if (!row) throw hubNotFound(); return row;
    }
    private active(row: Row) { if (row.status === 'cancelled' || (row.status === 'pending' && row.expiresAt <= Date.now())) throw expired(); }
    private view(row: Row): ConnectionRequest {
        const {id,origin,label,code,createdAt,expiresAt,status}=row; return {id,origin,label,code,createdAt,expiresAt,status};
    }
    private authorized(row: Row) {
        if (row.status !== 'confirmed') return;
        try {
            const credential = this.access.accounts.credential(row.credentialId!);
            if (credential.userId !== row.ownerId || (row.spaceId && !this.access.member(row.ownerId!,row.spaceId))) throw hubUnauthorized();
        } catch { throw new HubError(410,'connection_authorization_changed','这次授权已失效，请重新登录授权。'); }
    }
    private secret(row: Row, value: string) {
        connectionInput(PollingSecret,value);
        if (!timingSafeEqual(Buffer.from(row.tokenDigest,'hex'),Buffer.from(tokenDigest(value),'hex'))) throw hubNotFound();
    }
    begin(value: unknown) {
        const body=connectionInput(BeginConnection,value);
        return this.access.db.transaction(() => {
            const prior=this.access.db.query('SELECT * FROM hub_connection_requests WHERE id=?').get(body.requestId) as Row | null;
            if(prior){if(prior.fingerprint!==fingerprint(body))throw conflict();this.active(prior);this.authorized(prior);return this.view(prior);}
            const now=Date.now();
            this.access.db.query(`INSERT INTO hub_connection_requests
                (id,fingerprint,origin,label,tokenDigest,code,createdAt,expiresAt,status) VALUES (?,?,?,?,?,?,?,?,'pending')`)
                .run(body.requestId,fingerprint(body),body.origin,body.label,body.tokenDigest,randomBytes(4).toString('hex').toUpperCase(),now,now+600_000);
            return this.view(this.get(body.requestId));
        }).immediate();
    }
    show(id: string) {const row=this.get(id);this.active(row);this.authorized(row);return this.view(row);}
    private activate(row: Row,ownerId: string,spaceId: string | null) {
        this.active(row);
        if(spaceId && !this.access.member(ownerId,spaceId))throw hubNotFound();
        if(row.status==='confirmed'){
            this.authorized(row);if(row.ownerId!==ownerId || row.spaceId!==spaceId)throw conflict();return this.view(row);
        }
        const issued=this.access.accounts.issue(ownerId,'cli',row.label,row.tokenDigest);
        this.access.db.query("UPDATE hub_connection_requests SET status='confirmed',ownerId=?,spaceId=?,credentialId=? WHERE id=?")
            .run(ownerId,spaceId,issued.credential.id,row.id);
        return this.view(this.get(row.id));
    }
    confirm(id: string,token: string,value: unknown) {
        const body=connectionInput(ConfirmConnection,value);
        return this.access.db.transaction(()=>{
            const actor=this.access.accounts.authenticate(token),row=this.get(id);
            if(actor.credential.kind!=='browser')throw hubUnauthorized();
            return this.activate(row,actor.identity.id,body.spaceId);
        }).immediate();
    }
    async password(id: string,secret: string,value: unknown) {
        const body=connectionInput(z.object({username:z.unknown(),password:z.unknown(),register:z.boolean()}).strict(),value);
        const row=this.get(id);this.secret(row,secret);this.active(row);
        if(row.status==='confirmed'){this.authorized(row);return this.view(row);}
        if(body.register){
            const username=accountUsername(body.username),hash=await hashAccountPassword(body.password);
            return this.access.db.transaction(()=>{
                const current=this.get(id);this.active(current);
                if(current.status!=='pending')throw conflict();
                const account=this.access.accounts.create(username,hash);
                return this.activate(current,account.identity.id,null);
            }).immediate();
        }
        const account=await this.access.accounts.verify(body.username,body.password);
        return this.access.db.transaction(()=>{
            if(this.access.accounts.account(account.username)?.passwordHash!==account.passwordHash)throw hubUnauthorized();
            return this.activate(this.get(id),account.userId,null);
        }).immediate();
    }
    poll(id: string,secret: string,action:'poll'|'cancel'='poll') {
        return this.access.db.transaction(()=>{
            const row=this.get(id);this.secret(row,secret);
            if(action==='cancel'){
                if(row.credentialId)this.access.accounts.revoke(row.ownerId!,row.credentialId);
                this.access.db.query("UPDATE hub_connection_requests SET status='cancelled' WHERE id=?").run(id);
                return {status:'cancelled' as const};
            }
            this.active(row);this.authorized(row);
            return {status:row.status,expiresAt:row.expiresAt,...(row.status==='confirmed'?{ownerId:row.ownerId!,spaceId:row.spaceId,credentialId:row.credentialId!}:{})};
        }).immediate();
    }
}
