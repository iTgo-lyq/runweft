import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const env = process.env, slot = process.argv[2] ?? '0';
assert(env.RUNNER_TEMP && env.GITHUB_ENV, 'This directory preparation requires a CI runner');
for (const value of [env.GITHUB_RUN_ID, env.GITHUB_RUN_ATTEMPT, env.GITHUB_JOB, slot]) assert(/^[\w-]+$/.test(value ?? ''), 'Invalid CI operation identity');
const root = join(env.RUNNER_TEMP, 'runweft', [env.GITHUB_RUN_ID, env.GITHUB_RUN_ATTEMPT, env.GITHUB_JOB, slot].join('-'));
mkdirSync(root, { recursive: true, mode: 0o700 });
appendFileSync(env.GITHUB_ENV, Object.entries({ RUNWEFT_WORK_DIR: root,
    CODEX_HOME: join(root, 'config/codex'), CLAUDE_CONFIG_DIR: join(root, 'config/claude') })
    .map(([key, value]) => `${key}=${value}\n`).join(''));
