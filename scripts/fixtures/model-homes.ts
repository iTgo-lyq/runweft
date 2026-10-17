import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { configureSmokeCodexModel } from './codex-model';
import { closeSmoke } from '../../test/lifecycle';

/** Copy only native configuration into this invocation's actual model homes. */
export function modelHomes(root: string, env: NodeJS.ProcessEnv, requireClaude = true) {
    const sources = new Map<string, string>(), copies: string[] = [];
    const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
    function copy(source: string, destination: string) {
        if (!existsSync(source)) return;
        sources.set(source, hash(source)); mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
        copies.push(destination); copyFileSync(source, destination); chmodSync(destination, 0o600);
    }
    try {
    const codex = join(root, 'codex-home'), claude = join(root, 'claude-home');
    for (const dir of [codex, claude]) mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (const name of ['config.toml', 'auth.json']) copy(join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), name), join(codex, name));
    if (requireClaude) {
    const claudeSource = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
    copy(process.env.CLAUDE_CONFIG_DIR ? join(claudeSource, '.claude.json') : join(homedir(), '.claude.json'), join(claude, '.claude.json'));
    for (const name of ['settings.json', '.credentials.json']) copy(join(claudeSource, name), join(claude, name));
    }
    const codexModel = existsSync(join(codex, 'config.toml')) ? configureSmokeCodexModel(join(codex, 'config.toml')) : {};
    env.CODEX_HOME = codex; env.CLAUDE_CONFIG_DIR = claude;
    const nativeClaude = process.env.RUNWEFT_SMOKE_CLAUDE ?? Bun.which('iclaude') ?? Bun.which('claude');
    if (requireClaude) assert(nativeClaude, 'Claude Code is required for the explicit dual-runtime smoke');
    if (nativeClaude) env.HAPI_CLAUDE_PATH = nativeClaude;
    return { async waitHosts(pids: Iterable<number>) {
        const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
        const deadline = Date.now() + 10_000; while ([...pids].some(alive) && Date.now() < deadline) await Bun.sleep(100);
        assert(![...pids].some(alive), 'Model host still running; configuration copies retained');
    }, codexModel, nativeClaude, copies, verify() { for (const [path, before] of sources) assert.equal(hash(path), before, 'Source model configuration changed'); },
        async remove() { await closeSmoke(copies.map(path => () => rmSync(path, { force: true }))); } };
    } catch (error) {
        const errors: unknown[] = [error]; for (const path of copies) try { rmSync(path, { force: true }); } catch (cleanup) { errors.push(cleanup); }
        if (errors.length > 1) throw new AggregateError(errors, 'Model home setup and cleanup failed'); throw error;
    }
}
