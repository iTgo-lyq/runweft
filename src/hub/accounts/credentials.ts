import { createHash, randomBytes } from 'node:crypto';

export type UserCredentialKind = 'browser' | 'cli';
export type UserCredential = {
    id: string; userId: string; kind: UserCredentialKind; tokenDigest: string; label: string;
    createdAt: number; lastUsedAt: number; expiresAt: number; revokedAt: number | null;
};
export type PublicUserCredential = Omit<UserCredential, 'userId' | 'tokenDigest'>;

const hour = 3_600_000;
export const browserIdleMs = 2 * hour;
export const credentialLifetimeMs = { browser: 12 * hour, cli: 90 * 24 * hour } as const;

export function userCredentialKind(token: unknown): UserCredentialKind | null {
    if (typeof token !== 'string') return null;
    if (/^rw_web_[A-Za-z0-9_-]{43}$/.test(token)) return 'browser';
    if (/^rw_cli_[A-Za-z0-9_-]{43}$/.test(token)) return 'cli';
    return null;
}

export function createUserSecret(kind: UserCredentialKind): { token: string; digest: string } {
    const token = `${kind === 'browser' ? 'rw_web_' : 'rw_cli_'}${randomBytes(32).toString('base64url')}`;
    return { token, digest: createHash('sha256').update(token).digest('hex') };
}

export function activeUserCredential(value: UserCredential, now = Date.now()): boolean {
    return value.revokedAt === null && now < value.expiresAt
        && (value.kind !== 'browser' || now < value.lastUsedAt + browserIdleMs);
}

/** Login-environment listings never serialize a digest or another user's identifier. */
export function publicUserCredential(value: UserCredential): PublicUserCredential {
    const { id, kind, label, createdAt, lastUsedAt, expiresAt, revokedAt } = value;
    return { id, kind, label, createdAt, lastUsedAt, expiresAt, revokedAt };
}
