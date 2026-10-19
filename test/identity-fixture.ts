import { randomUUID } from 'node:crypto';
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
export function replaceTestCredential(store: HubStore, identity: {id: string}, previous: string, next: string) {
    const row = store.accounts.authenticate(previous); if(row.identity.id!==identity.id) throw new Error('fixture owner mismatch');
    store.accounts.revoke(identity.id,row.credential.id);
    const issued = store.accounts.issue(identity.id,'browser','测试替换');
    store.db.query('UPDATE hub_user_credentials SET tokenDigest=? WHERE id=?').run(Bun.CryptoHasher.hash('sha256',next,'hex'),issued.credential.id);
    return store.authenticate(next);
}
