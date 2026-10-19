import { expect, test } from 'bun:test';
import { accountPassword, accountUsername, hashAccountPassword, verifyAccountPassword } from '../../src/hub/accounts/password';
import { activeUserCredential, browserIdleMs, createUserSecret, publicUserCredential, userCredentialKind,
    type UserCredential } from '../../src/hub/accounts/credentials';

test('login names keep one uniqueness key without length or character restrictions', () => {
    expect(accountUsername('  Alice.Dev-1  ')).toBe('alice.dev-1');
    for (const input of ['a', '.alice', 'A B', '名字测试', '🧵@!', 'a'.repeat(300)]) expect(accountUsername(input)).toBe(input.toLowerCase());
    for (const input of [null, 1, '', '   ']) expect(() => accountUsername(input)).toThrow();
});

test('passwords require a value and retain arbitrary length, characters and whitespace', () => {
    for (const input of ['x', ' ', '  keep these spaces  ', '🧵', '🧵'.repeat(300), 'e\u0301', '\uD800']) expect(accountPassword(input)).toBe(input);
    for (const input of [null, 1, '']) expect(() => accountPassword(input)).toThrow();
});

test('Argon2id hashes use a salt and verify exact passwords without trimming', async () => {
    const password = '  a memorable demo passphrase  ';
    const hash = await hashAccountPassword(password), other = await hashAccountPassword(password);
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(hash).not.toBe(other);
    expect(hash).not.toContain(password);
    expect(await verifyAccountPassword(password, hash)).toBe(true);
    expect(await verifyAccountPassword(password.trim(), hash)).toBe(false);
    expect(await verifyAccountPassword('a different long passphrase', hash)).toBe(false);
    for (const value of ['x', ' ', '🧵'.repeat(300)]) {
        const unrestricted = await hashAccountPassword(value);
        expect(await verifyAccountPassword(value, unrestricted)).toBe(true);
        expect(await verifyAccountPassword(value + '!', unrestricted)).toBe(false);
    }
});

test('an absent account never authenticates, including the synthetic comparison phrase', async () => {
    expect(await verifyAccountPassword('synthetic unknown-account comparison', null)).toBe(false);
    expect(await verifyAccountPassword('another phrase to check', null)).toBe(false);
    expect(await verifyAccountPassword('short', null)).toBe(false);
    expect(await verifyAccountPassword(null, null)).toBe(false);
    expect(await verifyAccountPassword('x'.repeat(129), null)).toBe(false);
});

test('hash concurrency is bounded and capacity is released after completed work', async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => hashAccountPassword('a synthetic capacity test phrase')));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(4);
    const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.code).toBe('account_password_busy');
    const hash = await hashAccountPassword('a fresh synthetic test phrase');
    expect(await verifyAccountPassword('a fresh synthetic test phrase', hash)).toBe(true);
});

test('login secrets are distinct from legacy, machine and task credentials', () => {
    const browser = createUserSecret('browser'), cli = createUserSecret('cli');
    expect(userCredentialKind(browser.token)).toBe('browser');
    expect(userCredentialKind(cli.token)).toBe('cli');
    expect(browser.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(cli.digest).not.toBe(browser.digest);
    for (const prefix of ['rw_id_', 'rw_mc_', 'rw_task_']) expect(userCredentialKind(prefix + 'a'.repeat(43))).toBeNull();
    expect(userCredentialKind(browser.token + 'x')).toBeNull();
    expect(userCredentialKind('Bearer ' + cli.token)).toBeNull();
});

const now = 1_000_000;
const credential = (kind: 'browser' | 'cli'): UserCredential => ({ id: 'credential-id', userId: 'owner-id', kind,
    tokenDigest: 'digest-must-not-be-public', label: '我的电脑', createdAt: now, lastUsedAt: now, expiresAt: now + 12 * 3_600_000, revokedAt: null });

test('browser idle and absolute expiration have independent exact boundaries', () => {
    const browser = credential('browser');
    expect(activeUserCredential(browser, now + browserIdleMs - 1)).toBe(true);
    expect(activeUserCredential(browser, now + browserIdleMs)).toBe(false);
    browser.lastUsedAt = browser.expiresAt - 1;
    expect(activeUserCredential(browser, browser.expiresAt - 1)).toBe(true);
    expect(activeUserCredential(browser, browser.expiresAt)).toBe(false);
    browser.revokedAt = now;
    expect(activeUserCredential(browser, now)).toBe(false);
});

test('CLI credentials ignore browser idle timeout but respect expiry and revocation', () => {
    const cli = credential('cli');
    expect(activeUserCredential(cli, now + browserIdleMs)).toBe(true);
    expect(activeUserCredential(cli, cli.expiresAt)).toBe(false);
    cli.revokedAt = now;
    expect(activeUserCredential(cli, now)).toBe(false);
});

test('public credential metadata omits secrets and owner IDs through an explicit projection', () => {
    const value = publicUserCredential(credential('cli'));
    expect(value).not.toHaveProperty('tokenDigest');
    expect(value).not.toHaveProperty('userId');
    expect(value.label).toBe('我的电脑');
    expect(JSON.stringify(value)).not.toContain('digest-must-not-be-public');
});
