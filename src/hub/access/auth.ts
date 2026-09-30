import { createHmac } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { hubUnauthorized } from '../types';
import { AccessStore } from './store';
import type { Principal } from './types';

const issuer = 'runweft-hub', audience = 'runweft-access';
export const ACCESS_JWT_SECONDS = 15 * 60;

export class AccessAuthority {
    private readonly key: Uint8Array;
    constructor(readonly store: AccessStore, deploymentSecret: Uint8Array) {
        this.key = createHmac('sha256', deploymentSecret).update('runweft/access-jwt/v1').digest();
    }
    async exchangeBrowser(token: string, spaceId?: string) {
        if (!token.includes('.')) return this.exchange(token, spaceId);
        if (spaceId !== undefined) throw hubUnauthorized();
        const actor = await this.verify(token);
        if (actor.kind !== 'user' || !actor.spaceId) throw hubUnauthorized();
        this.store.refresh(actor);
        return { token, user: { id: actor.userNumber, firstName: actor.name } };
    }
    async exchange(token: string, spaceId: string | null = null) {
        const actor = this.store.authenticate(token, spaceId);
        const jwt = await new SignJWT({ ref: actor.digest, kind: actor.kind, space: actor.kind === 'user' ? spaceId : null,
            uid: actor.userNumber, ns: `rw_user_${actor.ownerId}` })
            .setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuer(issuer).setAudience(audience)
            .setSubject(actor.id).setIssuedAt().setExpirationTime(`${ACCESS_JWT_SECONDS}s`).sign(this.key);
        // Signing is asynchronous; a concurrent rotation/removal must not get a successful exchange.
        this.store.refresh(actor);
        return { token: jwt, user: { id: actor.userNumber, firstName: actor.name } };
    }
    async verify(jwt: string): Promise<Principal> {
        try {
            const { payload } = await jwtVerify(jwt, this.key, { algorithms: ['HS256'], issuer, audience, requiredClaims: ['exp', 'iat', 'sub'] });
            if (!['user', 'machine', 'task'].includes(String(payload.kind)) || typeof payload.ref !== 'string'
                || (payload.space !== null && typeof payload.space !== 'string')) throw hubUnauthorized();
            const actor = this.store.resolve(payload.kind as Principal['kind'], payload.ref, payload.space as string | null);
            if (actor.id !== payload.sub) throw hubUnauthorized();
            return { ...actor, expiresAt: payload.exp! * 1000 };
        } catch { throw hubUnauthorized(); }
    }
}
