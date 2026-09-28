import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { dataPaths, ensureDirectory, type ResolvedConfig } from './config';
import { RunweftError } from './errors';

export type Workspace = { id: string; path: string; repositoryRoot: string | null; createdAt: string };

function openStore(resolved: ResolvedConfig) {
    ensureDirectory(resolved.home);
    const db = new Database(dataPaths(resolved).bindings, { create: true });
    db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    db.exec('CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, repositoryRoot TEXT, createdAt TEXT NOT NULL)');
    return db;
}

export function bindWorkspace(resolved: ResolvedConfig, directory: string): Workspace {
    let path: string;
    try {
        path = realpathSync(resolve(directory));
        if (!statSync(path).isDirectory()) throw new Error('not a directory');
    } catch { throw new RunweftError('invalid_workspace', '工作区必须是已存在的目录。', `检查路径：${resolve(directory)}`); }
    const git = spawnSync('git', ['-C', path, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
    if (git.error) throw new RunweftError('git_unavailable', '无法运行 Git 来检查工作区。', '安装 Git 后重试。');
    const repositoryRoot = git.status === 0 ? realpathSync(git.stdout.trim()) : null;
    const db = openStore(resolved);
    try {
        db.query('INSERT INTO workspaces VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET repositoryRoot=excluded.repositoryRoot')
            .run(randomUUID(), path, repositoryRoot, new Date().toISOString());
        return db.query('SELECT * FROM workspaces WHERE path = ?').get(path) as Workspace;
    } finally { db.close(); }
}

export function listWorkspaces(resolved: ResolvedConfig): Workspace[] {
    if (!existsSync(dataPaths(resolved).bindings)) return [];
    const db = openStore(resolved);
    try { return db.query('SELECT * FROM workspaces ORDER BY createdAt, path').all() as Workspace[]; }
    finally { db.close(); }
}
