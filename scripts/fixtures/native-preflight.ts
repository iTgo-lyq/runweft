import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { nativeUserSmoke } from './native-user-smoke';

/** Actual compiled local and Hub client setup, with empty native config and no model dispatch. */
export async function preflightNativeSetup(binary: string) {
    mkdirSync('.dev-smoke', { recursive: true });
    const root = mkdtempSync(resolve('.dev-smoke/native-preflight-'));
    const env = { ...process.env, CODEX_HOME: join(root, 'codex'), CLAUDE_CONFIG_DIR: join(root, 'claude') };
    for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_') || key.startsWith('HAPI_') || ['CLI_API_TOKEN', 'DB_PATH'].includes(key)) delete (env as NodeJS.ProcessEnv)[key];
    for (const directory of [env.CODEX_HOME, env.CLAUDE_CONFIG_DIR]) mkdirSync(directory, { mode: 0o700 });
    writeFileSync(join(env.CODEX_HOME, 'config.toml'), ''); writeFileSync(join(env.CLAUDE_CONFIG_DIR, '.claude.json'), '{}');
    const fixture = await nativeUserSmoke(root, binary, env);
    let passed = false;
    try {
        for (const mode of ['local', 'hub']) {
            const home = mode === 'local' ? fixture.server : join(root, 'client');
            const runner = await fixture.runner(home);
            assert.equal(fixture.cli(home, ['config', 'show']).config.mode, mode);
            fixture.cli(home, ['mcp', 'install', '--client', 'all']);
            const checked = fixture.cli(home, ['mcp', 'check', '--client', 'all']);
            assert(checked.ok); assert.equal(checked.mode, mode);
            assert.deepEqual((await runner.http.request('/api/sessions')).sessions, [], 'Preflight must not dispatch models');
        }
        passed = true;
    } finally { await fixture.close(passed); }
}
