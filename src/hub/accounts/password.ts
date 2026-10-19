import { HubError } from '../types';

const algorithm = { algorithm: 'argon2id' as const, memoryCost: 19_456, timeCost: 2 };
// Synthetic comparison only. It belongs to no account and grants no access.
const absentAccountHash = '$argon2id$v=19$m=19456,t=2,p=1$2DDrleWSDR0H2dyqO6sDDzyl1J1xgUqihXr+Nat/JAU$xu8yhA0ezXfjeDgVeXhq8gEIlbD03pKmqSjihQrI3tc';
const invalidPassword = () => new HubError(400, 'account_password_invalid', '密码须为 15–128 个字符，允许空格。');

export function accountUsername(value: unknown): string {
    if (typeof value !== 'string') throw new HubError(400, 'account_username_invalid', '请输入有效的用户名。');
    const name = value.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/.test(name)) {
        throw new HubError(400, 'account_username_invalid', '用户名须为 3–32 位字母、数字、点、下划线或短横线，首位为字母或数字。');
    }
    return name.toLowerCase();
}

/** Validate new passwords without trimming, normalization, or UTF-16 truncation. */
export function accountPassword(value: unknown): string {
    if (typeof value !== 'string' || value.length > 256 || /[\uD800-\uDFFF]/u.test(value)) throw invalidPassword();
    const length = [...value].length;
    if (length < 15 || length > 128) throw invalidPassword();
    return value;
}

/** One shared process budget for account hashes and comparisons; never queue passwords. */
let working = 0;
async function passwordWork<T>(action: () => Promise<T>): Promise<T> {
    if (working >= 4) throw new HubError(429, 'account_password_busy', '登录服务正忙，请稍后重试。');
    working++;
    try { return await action(); }
    finally { working--; }
}

export function hashAccountPassword(value: unknown): Promise<string> {
    const password = accountPassword(value);
    return passwordWork(() => Bun.password.hash(password, algorithm));
}

/** Missing accounts take the same expensive comparison path, but can never authenticate. */
export async function verifyAccountPassword(value: unknown, hash: string | null): Promise<boolean> {
    if (typeof value !== 'string' || value.length > 256 || [...value].length > 128 || /[\uD800-\uDFFF]/u.test(value)) return false;
    const matched = await passwordWork(() => Bun.password.verify(value, hash ?? absentAccountHash));
    return hash !== null && matched;
}
