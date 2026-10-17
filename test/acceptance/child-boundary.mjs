import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [binary, home, agent, proof] = process.argv.slice(2);
for (const args of [['spawn', agent], ['send', crypto.randomUUID()]]) {
    const result = spawnSync(binary, ['--home', home, '--json', 'task', ...args, '--message', 'recursive probe'], { encoding: 'utf8', timeout: 20000 });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stderr.trim().split('\n').at(-1)).error.code, 'subagent_delegation_denied');
}
writeFileSync(proof, JSON.stringify({ sessionId: process.env.HAPI_SESSION_ID, denied: true }));
console.log('CHILD_BOUNDARY_OK');
