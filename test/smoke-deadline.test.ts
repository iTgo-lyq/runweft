import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { stopSmokeProcess } from '../scripts/fixtures/smoke-lifecycle';

test('successful smoke shutdown and failed operations leave no deadline keeping the process alive', async () => {
    const program = `
        import { stopSmokeProcess } from ${JSON.stringify(resolve('scripts/fixtures/smoke-lifecycle.ts'))};
        import { withSmokeDeadline } from ${JSON.stringify(resolve('scripts/fixtures/smoke-deadline.ts'))};
        const child = Bun.spawn([process.execPath, '-e', "console.log('ready'); setInterval(()=>{},1000)"], {stdout:'pipe'});
        const reader = child.stdout.getReader(); await reader.read(); reader.releaseLock();
        await stopSmokeProcess(child);
        await withSmokeDeadline(Promise.resolve(1), 5000, () => 0);
        await withSmokeDeadline(Promise.reject(new Error('expected')), 5000, () => 0).catch(() => {});
    `;
    const child = Bun.spawn([process.execPath, '-e', program], { stdout: 'ignore', stderr: 'pipe' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const exit = await Promise.race([child.exited, new Promise(resolve => { timer = setTimeout(() => resolve('still alive'), 2500); })]);
        expect(exit).toBe(0);
    } finally {
        clearTimeout(timer);
        if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await child.exited; }
    }
});

test('a smoke process ignoring SIGTERM is killed and remains a failed acceptance', async () => {
    const child = Bun.spawn([process.execPath, '-e', "process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000)"], { stdout: 'pipe', stderr: 'ignore' });
    try {
        const reader = child.stdout.getReader(); await reader.read(); reader.releaseLock();
        await expect(stopSmokeProcess(child)).rejects.toThrow('required SIGKILL');
        expect(child.signalCode).toBe('SIGKILL');
        expect(() => process.kill(child.pid, 0)).toThrow();
    } finally {
        if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await child.exited; }
    }
}, 8000);
