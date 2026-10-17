import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { closeSmoke, removeSmokeSecrets, startSmokeHapi, stopSmokeProcess } from '../lifecycle';
import { freePort } from '../../src/services';

test('smoke acquisition failure rejects and cleanup attempts all resources without deleting live credentials', async () => {
    const root = mkdtempSync(join(tmpdir(), 'runweft-lifecycle-'));
    const child = Bun.spawn([process.execPath, '-e', 'setInterval(()=>{},1000)'], { stdout: 'ignore', stderr: 'ignore' });
    const secret = join(root, 'credential'); writeFileSync(secret, 'DEDICATED'); const attempted: string[] = [];
    try {
        let caught: any;
        const resources = [
            () => removeSmokeSecrets([secret], [child]),
            () => { attempted.push('remaining'); },
            () => { attempted.push('stop'); throw new Error('injected stop failure'); },
        ];
        const first = closeSmoke(resources), second = closeSmoke(resources);
        expect(second).toBe(first);
        try { await first; } catch (error) { caught = error; }
        await expect(second).rejects.toBe(caught);
        expect(caught).toBeInstanceOf(AggregateError); expect(caught.errors).toHaveLength(2);
        expect(attempted).toEqual(['stop', 'remaining']); expect(existsSync(secret)).toBe(true);
        await stopSmokeProcess(child); await removeSmokeSecrets([secret], [child]); expect(existsSync(secret)).toBe(false);
        writeFileSync(secret, 'DEDICATED'); const undeletable = join(root, 'directory'); mkdirSync(undeletable);
        await expect(removeSmokeSecrets([secret, undeletable], [child])).rejects.toThrow('cleanup failed');
        expect(existsSync(secret)).toBe(false); // A failure in the other secret path does not skip this file.
        await expect(startSmokeHapi('/bin/false', root, {}, await freePort(), 'DEDICATED')).rejects.toThrow('startup');
    } finally { if (child.exitCode === null && child.signalCode === null) await stopSmokeProcess(child); rmSync(root, { recursive: true, force: true }); }
});

test('Bun timeout still runs the owner hook and waits for actual process shutdown', async () => {
    const root = mkdtempSync(join(tmpdir(), 'runweft-timeout-')), result = join(root, 'closed');
    const file = join(root, 'timeout.test.ts');
    writeFileSync(file, `import {test,afterAll} from 'bun:test';
import {writeFileSync} from 'node:fs';
import {closeSmoke,stopSmokeProcess} from ${JSON.stringify(resolve('test/lifecycle.ts'))};
const resources=[];
afterAll(()=>closeSmoke(resources));
test('timeout',async()=>{
 const child=Bun.spawn([process.execPath,'-e','setInterval(()=>{},1000)'],{stdout:'ignore',stderr:'ignore'});
 resources.push(async()=>{await stopSmokeProcess(child);writeFileSync(${JSON.stringify(result)},String(child.pid));});
 await new Promise(()=>{});
},100);
`);
    const child = Bun.spawn([process.execPath, 'test', file], { stdout: 'ignore', stderr: 'pipe' });
    try {
        const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
        expect(exit).not.toBe(0); expect(stderr).toContain('timed out');
        expect(() => process.kill(Number(readFileSync(result, 'utf8')), 0)).toThrow();
    } finally { if (child.exitCode === null) { child.kill('SIGKILL'); await child.exited; } rmSync(root, { recursive: true, force: true }); }
});

test('smoke shutdown reports a nonzero signal-handler exit after the process has really exited', async () => {
    const child = Bun.spawn([process.execPath, '-e', "process.on('SIGTERM',()=>process.exit(7)); console.log('READY'); setInterval(()=>{},1000)"], { stdout: 'pipe', stderr: 'ignore' });
    const reader = child.stdout.getReader(); await reader.read(); reader.releaseLock();
    await expect(stopSmokeProcess(child)).rejects.toThrow('failed during shutdown');
    expect(child.exitCode).toBe(7); expect(child.signalCode).toBeNull(); expect(() => process.kill(child.pid, 0)).toThrow();
});
