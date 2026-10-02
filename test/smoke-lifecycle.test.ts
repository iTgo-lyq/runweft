import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { closeSmoke, removeSmokeSecrets, startSmokeHapi, stopSmokeProcess } from '../scripts/fixtures/smoke-lifecycle';
import { freePort } from '../src/services';

test('smoke acquisition failure rejects and cleanup attempts all resources without deleting live credentials', async () => {
    mkdirSync('.dev-smoke/tests', { recursive: true }); const root = mkdtempSync(resolve('.dev-smoke/tests/smoke-lifecycle-'));
    const child = Bun.spawn([process.execPath, '-e', 'setInterval(()=>{},1000)'], { stdout: 'ignore', stderr: 'ignore' });
    const secret = join(root, 'credential'); writeFileSync(secret, 'DEDICATED'); const attempted: string[] = [];
    try {
        let caught: any;
        try { await closeSmoke([
            () => removeSmokeSecrets([secret], [child]),
            () => { attempted.push('remaining'); },
            () => { attempted.push('stop'); throw new Error('injected stop failure'); },
        ]); } catch (error) { caught = error; }
        expect(caught).toBeInstanceOf(AggregateError); expect(caught.errors).toHaveLength(2);
        expect(attempted).toEqual(['stop', 'remaining']); expect(existsSync(secret)).toBe(true);
        await stopSmokeProcess(child); await removeSmokeSecrets([secret], [child]); expect(existsSync(secret)).toBe(false);
        writeFileSync(secret, 'DEDICATED'); const undeletable = join(root, 'directory'); mkdirSync(undeletable);
        await expect(removeSmokeSecrets([secret, undeletable], [child])).rejects.toThrow('cleanup failed');
        expect(existsSync(secret)).toBe(false); // A failure in the other secret path does not skip this file.
        await expect(startSmokeHapi('/bin/false', root, {}, await freePort(), 'DEDICATED')).rejects.toThrow('startup');
    } finally { if (child.exitCode === null && child.signalCode === null) await stopSmokeProcess(child); rmSync(root, { recursive: true, force: true }); }
});

test('smoke shutdown reports a nonzero signal-handler exit after the process has really exited', async () => {
    const child = Bun.spawn([process.execPath, '-e', "process.on('SIGTERM',()=>process.exit(7)); console.log('READY'); setInterval(()=>{},1000)"], { stdout: 'pipe', stderr: 'ignore' });
    const reader = child.stdout.getReader(); await reader.read(); reader.releaseLock();
    await expect(stopSmokeProcess(child)).rejects.toThrow('failed during shutdown');
    expect(child.exitCode).toBe(7); expect(child.signalCode).toBeNull(); expect(() => process.kill(child.pid, 0)).toThrow();
});
