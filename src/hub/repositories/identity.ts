import { createHash } from 'node:crypto';
import { z } from 'zod';
import { HubError } from '../types';

export const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const invalid = () => new HubError(400, 'repository_url_invalid', '仓库地址不能规范化。', '使用不含密码、查询参数或歧义路径的 HTTP(S)、git、ssh 或 SCP 地址；本地 remote 请显式绑定。');
export const RemoteDescriptor = z.object({
    kind: z.literal('remote'), version: z.literal(1), transport: z.enum(['http', 'https', 'ssh', 'git']),
    host: z.string().min(1).max(255), port: z.number().int().min(1).max(65535).nullable(),
    path: z.string().min(1).max(4096), pathMode: z.enum(['absolute', 'relative']), sshUserHash: hash.nullable(),
}).strict();
export const UnmatchedDescriptor = z.object({ kind: z.enum(['local', 'unsupported']), digest: hash }).strict();
export const RemoteCandidate = z.union([RemoteDescriptor, UnmatchedDescriptor]);
export type RemoteDescriptor = z.infer<typeof RemoteDescriptor>;
export type RemoteCandidate = z.infer<typeof RemoteCandidate>;
export type RepositoryAlias = { canonicalKey: string; displayUrl: string; descriptor: RemoteDescriptor };
const defaults = { http: 80, https: 443, ssh: 22, git: 9418 };
const unsafe = /[\x00-\x20\x7f\\?#]/;

function cleanPath(raw: string, mode: 'absolute' | 'relative', stripGit = false) {
    // Examine before URL() can erase dot segments. Encoded separators have ambiguous server semantics.
    if (unsafe.test(raw) || /%(?:2f|5c)/i.test(raw)) throw invalid();
    let path: string;
    try { path = decodeURIComponent(raw); } catch { throw invalid(); }
    if (unsafe.test(path) || path.includes('%')) throw invalid();
    if (mode === 'absolute') { if (!path.startsWith('/')) throw invalid(); path = path.slice(1); }
    else if (path.startsWith('/')) throw invalid();
    path = path.replace(/\/+$/, '');
    if (stripGit && path.endsWith('.git')) path = path.slice(0, -4);
    if (!path || path.split('/').some(part => !part || part === '.' || part === '..')) throw invalid();
    return path.split('/').map(part => encodeURIComponent(part)).join('/');
}

/** Versioned, salt-free identity shared by URL registration and local observation. No raw userinfo survives. */
export function repositoryAlias(input: unknown): RepositoryAlias {
    let descriptor: RemoteDescriptor;
    if (typeof input === 'string') {
        if (input.length > 8192 || unsafe.test(input) || /^file:/i.test(input)) throw invalid();
        const absolute = /^([a-z][a-z0-9+.-]*):\/\/([^/]+)(\/.*)$/i.exec(input);
        if (absolute) {
            const [, scheme, , rawPath] = absolute;
            const transport = scheme.toLowerCase() as RemoteDescriptor['transport'];
            if (!Object.hasOwn(defaults, transport)) throw invalid();
            let url: URL;
            try { url = new URL(input); } catch { throw invalid(); }
            if (url.search || url.hash || (transport === 'ssh' && url.password) || (transport === 'git' && (url.username || url.password))) throw invalid();
            let user: string;
            try { user = decodeURIComponent(url.username); } catch { throw invalid(); }
            if (transport === 'ssh' && /[\x00-\x20\x7f\\/:@]/.test(user)) throw invalid();
            descriptor = { kind: 'remote', version: 1, transport, host: url.hostname.toLowerCase(),
                port: url.port && Number(url.port) !== defaults[transport] ? Number(url.port) : null,
                path: cleanPath(rawPath, 'absolute', true), pathMode: 'absolute', sshUserHash: transport === 'ssh' && user ? digest(user) : null };
        } else {
            const scp = /^(?:([^@/:]+)@)?(\[[^\]]+\]|[^@/:]+):(.+)$/.exec(input);
            if (!scp || /^[a-z]:[\\/]/i.test(input)) throw invalid();
            const [, user, host, rawPath] = scp;
            if (user && /[\x00-\x20\x7f\\%]/.test(user)) throw invalid();
            const mode = rawPath.startsWith('/') ? 'absolute' : 'relative';
            descriptor = { kind: 'remote', version: 1, transport: 'ssh', host: host.toLowerCase(), port: null,
                path: cleanPath(rawPath, mode, true), pathMode: mode, sshUserHash: user ? digest(user) : null };
        }
    } else {
        const parsed = RemoteDescriptor.safeParse(input); if (!parsed.success) throw invalid(); descriptor = parsed.data;
    }
    if (!RemoteDescriptor.safeParse(descriptor).success) throw invalid();
    // Recompute all derived fields; callers cannot supply canonicalKey or a display URL.
    let host: URL;
    try { host = new URL(`http://${descriptor.host}/`); } catch { throw invalid(); }
    if (host.hostname !== descriptor.host || host.port || host.username || host.password || host.pathname !== '/' || host.search || host.hash) throw invalid();
    if (descriptor.transport !== 'ssh' && (descriptor.sshUserHash !== null || descriptor.pathMode !== 'absolute')) throw invalid();
    const path = cleanPath(descriptor.path, 'relative');
    if (path !== descriptor.path || descriptor.port === defaults[descriptor.transport]) throw invalid();
    const canonical = { kind: 'remote' as const, version: 1 as const, transport: descriptor.transport, host: descriptor.host,
        port: descriptor.port, path, pathMode: descriptor.pathMode, sshUserHash: descriptor.sshUserHash };
    const displayUrl = canonical.pathMode === 'relative' ? `${canonical.host}:${canonical.path}`
        : `${canonical.transport}://${canonical.host}${canonical.port ? `:${canonical.port}` : ''}/${canonical.path}`;
    return { canonicalKey: digest(JSON.stringify(canonical)), displayUrl, descriptor: canonical };
}

export function observeRemote(value: string): RemoteCandidate {
    // Local paths have no portable key. Keep only a one-way fingerprint for drift detection.
    if (/^(?:[./~]|[a-z]:[\\/]|file:)/i.test(value) || !value.includes(':')) return { kind: 'local', digest: digest(value) };
    try { return repositoryAlias(value).descriptor; }
    catch { return { kind: 'unsupported', digest: digest(value) }; }
}
export function canonicalCandidate(value: unknown): RemoteCandidate {
    const parsed = RemoteCandidate.safeParse(value); if (!parsed.success) throw invalid();
    return parsed.data.kind === 'remote' ? repositoryAlias(parsed.data).descriptor : parsed.data;
}
