import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { configureSmokeCodexModel } from './codex-model';
import { closeSmoke } from '../../test/lifecycle';

/** Copy only native configuration into this invocation's actual model homes. */
export function modelHomes(root: string, env: NodeJS.ProcessEnv, requireClaude = true) {
    const copies: string[] = [];
    function copy(source: string, destination: string) {
        if (!existsSync(source)) return;
        mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
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
    const config = join(codex, 'config.toml');
    if (!copies.includes(config)) copies.push(config);
    const codexModel = configureSmokeCodexModel(config);
    env.CODEX_HOME = codex; env.CLAUDE_CONFIG_DIR = claude;
    const nativeClaude = process.env.RUNWEFT_NATIVE_CLAUDE ?? Bun.which('claude');
    if (requireClaude) assert(nativeClaude, 'Claude Code is required for the explicit dual-runtime smoke');
    if (nativeClaude) env.HAPI_CLAUDE_PATH = nativeClaude;
    const settingsPath = join(claude, 'settings.json');
    const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {};
    const claudeModel = { model: process.env.RUNWEFT_NATIVE_CLAUDE_MODEL || settings.model,
        reasoningEffort: process.env.RUNWEFT_NATIVE_CLAUDE_EFFORT || settings.effortLevel || settings.modelSettings?.[settings.model]?.effortLevel };
    return { claudeModel, async waitHosts(pids: Iterable<number>) {
        const alive = (pid: number) => { try { if (process.platform === 'linux' && /\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'))) return false; process.kill(pid, 0); return true; } catch { return false; } };
        const deadline = Date.now() + 10_000; while ([...pids].some(alive) && Date.now() < deadline) await Bun.sleep(100);
        assert(![...pids].some(alive), 'Model host still running; configuration copies retained');
    }, codexModel, nativeClaude, copies,
        async remove() { await closeSmoke(copies.map(path => () => rmSync(path, { force: true }))); } };
    } catch (error) {
        const errors: unknown[] = [error]; for (const path of copies) try { rmSync(path, { force: true }); } catch (cleanup) { errors.push(cleanup); }
        if (errors.length > 1) throw new AggregateError(errors, 'Model home setup and cleanup failed'); throw error;
    }
}
