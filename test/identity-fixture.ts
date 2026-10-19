import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { atomicWrite } from '../src/config';
import { hubConnectionPaths } from '../src/hub/resources/connection';
import type { HubStore } from '../src/hub/store';
import { createUserSecret } from '../src/hub/accounts/credentials';

/** Isolated fixtures only; product registration always validates and hashes the supplied password. */
const hash = '$argon2id$v=19$m=19456,t=2,p=1$2DDrleWSDR0H2dyqO6sDDzyl1J1xgUqihXr+Nat/JAU$xu8yhA0ezXfjeDgVeXhq8gEIlbD03pKmqSjihQrI3tc';
export function createTestIdentity(store: HubStore, name: string) {
    const value = store.accounts.create('fixture-'+randomUUID().slice(0,20),hash,name);
    const credential = store.accounts.issue(value.identity.id,'browser','测试浏览器');
    return { ...value, token: credential.token! };
}
export const createIdentityToken = () => createUserSecret('browser').token;
/** Test setup only: activate a genuine CLI grant and install its current-format local fixture record. */
export async function saveTestConnection(home: string, hub: string, browserToken: string, spaceId?: string) {
    hub = new URL(hub).origin;
    const api = async (path: string, token?: string, body?: object) => {
        const response = await fetch(hub + path, { method: body ? 'POST' : 'GET', headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {}) });
        if (!response.ok) throw new Error(`Synthetic connection setup failed: ${path} (${response.status})`);
        return response.json() as Promise<any>;
    };
    const { identity } = await api('/api/runweft/hub/identity', browserToken);
    spaceId ??= (await api('/api/runweft/hub/spaces', browserToken)).spaces[0]?.id;
    if (!spaceId) throw new Error('Synthetic fixture requires a space');
    const paths = hubConnectionPaths(home, hub);
    try {
        const old = JSON.parse(readFileSync(paths.identityConnection, 'utf8'));
        if (old.schemaVersion === 2 && old.ownerId === identity.id && old.spaceId === spaceId) return paths.identityConnection;
    } catch {}
    const requestId = randomUUID(), token = createUserSecret('cli').token;
    await api('/api/runweft/connect', undefined, { requestId, origin: hub, label: 'Synthetic CLI fixture', tokenDigest: Bun.CryptoHasher.hash('sha256', token, 'hex') });
    await api(`/api/runweft/connect/${requestId}/confirm`, browserToken, { spaceId });
    atomicWrite(paths.identityConnection, JSON.stringify({ schemaVersion: 2, hub, ownerId: identity.id, spaceId, token, requestId, createdAt: Date.now() }));
    return paths.identityConnection;
}
export function fixtureCredential(file: string) {
    const value=readFileSync(file,'utf8'), token=value.match(/rw_(?:web|cli)_[A-Za-z0-9_-]{43}/)?.[0];
    if(!token)throw new Error('missing synthetic fixture credential');
    return {token};
}
export function replaceTestCredential(store: HubStore, identity: {id: string}, previous: string, next: string) {
    const row = store.accounts.authenticate(previous); if(row.identity.id!==identity.id) throw new Error('fixture owner mismatch');
    store.accounts.revoke(identity.id,row.credential.id);
    const issued = store.accounts.issue(identity.id,'browser','测试替换');
    store.db.query('UPDATE hub_user_credentials SET tokenDigest=? WHERE id=?').run(Bun.CryptoHasher.hash('sha256',next,'hex'),issued.credential.id);
    return store.authenticate(next);
}
