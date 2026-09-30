import { createPublicKey, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AccessStore } from '../access/store';
import { fingerprint } from '../access/transport';
import { tokenDigest } from '../store';
import { HubError, hubNotFound } from '../types';
import { BeginConnection, ConfirmConnection, PollingSecret, connectionInput, type ConnectionRequest } from './types';

type Row = ConnectionRequest & { fingerprint: string; pollingDigest: string; ownerId: string | null; spaceId: string | null; identityDigest: string | null; ciphertext: string | null };
const expired = () => new HubError(410, 'connection_request_expired', '连接请求已过期或取消。', '让 Agent 重新执行 hub connect begin。');
const conflict = () => new HubError(409, 'connection_request_conflict', '此连接请求已使用其他参数或身份。', '核对原请求；不要代替别人确认连接。');
export class ConnectionRequestStore {
    constructor(readonly access: AccessStore) {}
    private get(id: string): Row {
        connectionInput(z.uuid(), id);
        const row = this.access.db.query('SELECT * FROM hub_connection_requests WHERE id=?').get(id) as Row | null;
        if (!row) throw hubNotFound(); return row;
    }
    private active(row: Row) { if (row.expiresAt <= Date.now() || row.status === 'cancelled') throw expired(); }
    private view(row: Row): ConnectionRequest {
        const { id, origin, label, publicKey, code, createdAt, expiresAt, status } = row;
        return { id, origin, label, publicKey, code, createdAt, expiresAt, status };
    }
    private authorized(row: Row) {
        if (row.status !== 'confirmed' && row.status !== 'consumed') return;
        const current = this.access.db.query('SELECT tokenDigest FROM hub_users WHERE id=?').get(row.ownerId) as { tokenDigest: string } | null;
        if (!current || current.tokenDigest !== row.identityDigest || !this.access.member(row.ownerId!, row.spaceId)) {
            throw new HubError(410, 'connection_authorization_changed', '确认连接后身份 token 或空间资格已改变。', '重新发起连接，并在当前身份下确认。');
        }
    }
    begin(value: unknown): ConnectionRequest {
        const body = connectionInput(BeginConnection, value);
        try {
            const key = createPublicKey({ key: Buffer.from(body.publicKey, 'base64url'), format: 'der', type: 'spki' });
            if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails?.modulusLength !== 2048) throw new Error();
        } catch { throw new HubError(400, 'connection_key_invalid', '连接公钥必须是 RSA 2048 SPKI 公钥。'); }
        return this.access.db.transaction(() => {
            this.access.db.query('DELETE FROM hub_connection_requests WHERE expiresAt<?').run(Date.now() - 86_400_000);
            const prior = this.access.db.query('SELECT * FROM hub_connection_requests WHERE id=?').get(body.requestId) as Row | null;
            if (prior) { if (prior.fingerprint !== fingerprint(body)) throw conflict(); this.active(prior); return this.view(prior); }
            const now = Date.now();
            this.access.db.query(`INSERT INTO hub_connection_requests (id, fingerprint, origin, label, publicKey, pollingDigest, code, createdAt, expiresAt, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`).run(body.requestId, fingerprint(body), body.origin, body.label, body.publicKey,
                    body.pollingDigest, randomBytes(4).toString('hex').toUpperCase(), now, now + 600_000);
            return this.view(this.get(body.requestId));
        }).immediate();
    }
    show(id: string) { const row = this.get(id); this.active(row); return this.view(row); }
    confirm(id: string, identityToken: string, value: unknown) {
        const body = connectionInput(ConfirmConnection, value);
        return this.access.db.transaction(() => {
            const actor = this.access.authenticate(identityToken, body.spaceId);
            if (actor.kind !== 'user') throw hubNotFound();
            const row = this.get(id); this.active(row);
            if (row.status !== 'pending') {
                this.authorized(row);
                if (row.ownerId !== actor.ownerId || row.spaceId !== body.spaceId || row.ciphertext !== body.ciphertext) throw conflict();
                return this.view(row);
            }
            this.access.db.query("UPDATE hub_connection_requests SET status='confirmed', ownerId=?, spaceId=?, identityDigest=?, ciphertext=? WHERE id=?")
                .run(actor.ownerId, body.spaceId, tokenDigest(identityToken), body.ciphertext, id);
            return this.view(this.get(id));
        }).immediate();
    }
    poll(id: string, secret: string, action: 'poll' | 'acknowledge' | 'cancel' = 'poll') {
        connectionInput(PollingSecret, secret);
        return this.access.db.transaction(() => {
            const row = this.get(id);
            if (!timingSafeEqual(Buffer.from(row.pollingDigest, 'hex'), Buffer.from(tokenDigest(secret), 'hex'))) throw hubNotFound();
            if (action === 'cancel') {
                if (row.status !== 'consumed') this.access.db.query("UPDATE hub_connection_requests SET status='cancelled', ciphertext=NULL WHERE id=?").run(id);
                return { status: row.status === 'consumed' ? 'consumed' as const : 'cancelled' as const };
            }
            this.active(row); this.authorized(row);
            if (action === 'acknowledge') {
                if (row.status === 'pending') throw new HubError(409, 'connection_confirmation_required', '请先在 Hub 页面确认连接。');
                this.access.db.query("UPDATE hub_connection_requests SET status='consumed', ciphertext=NULL WHERE id=?").run(id);
                return { status: 'consumed' as const };
            }
            return { status: row.status, expiresAt: row.expiresAt, ...(row.status === 'confirmed' ? { ownerId: row.ownerId!, spaceId: row.spaceId!, ciphertext: row.ciphertext! } : {}) };
        }).immediate();
    }
}
