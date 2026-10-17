import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { dataPaths, loadConfig } from '../../src/config';
import { compiledCli } from './compiled-cli';
import { fixture } from '../helpers';
const roots: string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function location(){const root=fixture('cli-state');roots.push(root);return{root};}
function files(root:string): unknown {return readdirSync(root).sort().map(name=>{const p=join(root,name),s=statSync(p);return[name,s.mode,s.isDirectory()?files(p):createHash('sha256').update(readFileSync(p)).digest('hex')];});}
test('service start, serve and restart reject an unsupported database before changing the home', async () => {
    const binary = await compiledCli();
    for (const kind of ['state', 'clientState'] as const) {
    const { root } = location(); const config = loadConfig(root, {}), path = dataPaths(config)[kind];
    const { mkdirSync } = await import('node:fs'); const { dirname } = await import('node:path'); mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path); db.exec('CREATE TABLE keep(value TEXT); PRAGMA user_version=18;'); db.close();
    const before = files(root);
    for (const action of ['start', 'serve', 'restart']) {
        const child = Bun.spawn([binary, '--home', root, '--json', action], { stdout: 'pipe', stderr: 'pipe' });
        const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect(code).toBe(1); expect(out + err).toContain('state_format_unsupported'); expect(files(root)).toEqual(before);
    }
    }
});
