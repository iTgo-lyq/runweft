import { afterEach, expect, test } from 'bun:test';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { compiledCli } from './compiled-cli';
import { fixture } from './helpers';
import { fixtureCleanup } from './fixture-cleanup';
import { atomicWrite, loadConfig } from '../src/config';
import { applyConfigChanges, prepareMcpChanges } from '../src/mcp/install';

const owner = fixtureCleanup([]);
afterEach(() => owner.close());
async function setup() {
    const root = fixture('uninstall', owner.resources), pkg = join(root, 'platform'), binary = join(pkg, 'bin', 'runweft');
    const user = join(root, 'user'), home = join(user, '.runweft'), codex = join(user, '.codex'), claude = join(user, '.claude');
    for (const path of [join(pkg, 'bin'), join(home, 'server', 'runweft'), codex, claude]) mkdirSync(path, { recursive: true });
    copyFileSync(await compiledCli(), binary);
    writeFileSync(join(pkg, 'bin', 'hapi'), 'placeholder-not-a-running-HAPI');
    cpSync(resolve('skills/runweft'), join(pkg, 'skills', 'runweft'), { recursive: true });
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: `runweft-${process.platform}-${process.arch}`, version: '1.1.3', files: ['bin', 'skills'] }));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('RUNWEFT_') && !/^npm_config_/i.test(key)));
    Object.assign(env, { HOME: user, CODEX_HOME: codex, CLAUDE_CONFIG_DIR: claude });
    const run = (args: string[], target = home) => spawnSync(binary, ['--home', target, '--json', ...args], { cwd: root, env, encoding: 'utf8', timeout: 35_000 });
    const error = (result: ReturnType<typeof run>) => { expect(result.status).toBe(1); return JSON.parse(result.stderr).error.code; };
    return { root, pkg, binary, user, home, codex, claude, env, run, error };
}
const managed = (binary: string, home: string, client = 'codex') => ({ command: binary, args: ['--home', home, 'mcp', 'serve', '--client', client], env: { RUNWEFT_MCP_MANAGED: '1' } });
const put = (path: string, value: unknown) => atomicWrite(path, JSON.stringify(value));

test('complete uninstall previews then removes standalone package, data and own integrations without backups', async () => {
    const f = await setup(), codexConfig = join(f.codex, 'config.toml'), claudeConfig = join(f.claude, '.claude.json');
    writeFileSync(codexConfig, '# keep comment\nmodel="native-model"\n[mcp_servers.keep]\ncommand="keep"\n[mcp_servers.runweft]\ncommand=' + JSON.stringify(f.binary) + '\nargs=' + JSON.stringify(managed(f.binary, f.home).args) + '\n[mcp_servers.runweft.env]\nRUNWEFT_MCP_MANAGED="1"\n');
    put(claudeConfig, { other: 1, mcpServers: { keep: { command: 'keep' }, runweft: managed(f.binary, f.home, 'claude') } });
    const otherHook = { matcher: 'Bash', hooks: [{ type: 'command', command: 'keep' }] };
    put(join(f.claude, 'settings.json'), { model: 'keep-model', hooks: { PreToolUse: [otherHook, { matcher: 'mcp__runweft__.*', hooks: [{ type: 'command', command: f.binary, args: ['--home', f.home, 'mcp', 'hook'] }] }] } });
    const keep = [join(f.codex, 'auth.json'), join(f.codex, 'sessions', 'session.jsonl'), join(f.claude, '.credentials.json'), join(f.user, 'project', 'source.ts'), join(f.user, '.hapi', 'settings.json'), join(f.user, '.agents', 'skills', 'other', 'SKILL.md')];
    for (const file of keep) atomicWrite(file, 'KEEP ' + file);
    for (const file of ['config.yaml', 'client.sqlite', 'backups/mcp/old.json', 'logs/old.log', 'cache/item']) atomicWrite(join(f.home, file), 'DELETE');
    const skill = join(f.user, '.agents', 'skills', 'runweft');
    cpSync(resolve('skills/runweft'), skill, { recursive: true });
    const snapshot = [readFileSync(codexConfig, 'utf8'), readFileSync(claudeConfig, 'utf8')];
    const preview = f.run(['uninstall']); expect(preview.status).toBe(0);
    expect(JSON.parse(preview.stdout).applied).toBe(false);
    expect([readFileSync(codexConfig, 'utf8'), readFileSync(claudeConfig, 'utf8')]).toEqual(snapshot);
    expect(f.run(['uninstall', '--yes', '--dry-run']).status).toBe(0); expect(existsSync(f.binary)).toBe(true);
    const removed = f.run(['uninstall', '--yes']); expect(removed.status).toBe(0);
    expect(JSON.parse(removed.stdout).applied).toBe(true);
    expect(existsSync(f.pkg)).toBe(false); expect(existsSync(f.home)).toBe(false); expect(existsSync(skill)).toBe(false);
    for (const file of keep) expect(readFileSync(file, 'utf8')).toBe('KEEP ' + file);
    const codex = Bun.TOML.parse(readFileSync(codexConfig, 'utf8')) as any;
    expect(codex.mcp_servers).toEqual({ keep: { command: 'keep' } }); expect(readFileSync(codexConfig, 'utf8')).toContain('# keep comment');
    expect(JSON.parse(readFileSync(claudeConfig, 'utf8'))).toEqual({ other: 1, mcpServers: { keep: { command: 'keep' } } });
    expect(JSON.parse(readFileSync(join(f.claude, 'settings.json'), 'utf8'))).toEqual({ model: 'keep-model', hooks: { PreToolUse: [otherHook] } });
});

test('dangerous, generic and symlink homes are refused without changing the program or target', async () => {
    const f = await setup(), ordinary = join(f.root, 'ordinary'), link = join(f.root, 'linked');
    atomicWrite(join(ordinary, 'config.yaml'), 'server: {}\n'); symlinkSync(ordinary, link);
    for (const path of [f.user, f.codex, f.pkg, ordinary, link]) expect(f.error(f.run(['uninstall', '--yes'], path))).toBe('uninstall_home_unsafe');
    atomicWrite(join(f.home, 'user-project.txt'), 'KEEP');
    expect(f.error(f.run(['uninstall', '--yes']))).toBe('uninstall_home_unsafe');
    expect(readFileSync(join(ordinary, 'config.yaml'), 'utf8')).toBe('server: {}\n'); expect(existsSync(f.binary)).toBe(true);
});

test('unknown Skill files block removal; data and Skill symlink targets remain untouched', async () => {
    const f = await setup(), skill = join(f.user, '.agents', 'skills', 'runweft'), target = join(f.root, 'source');
    cpSync(resolve('skills/runweft'), skill, { recursive: true }); atomicWrite(join(skill, 'my-file.txt'), 'KEEP');
    expect(f.error(f.run(['uninstall', '--yes']))).toBe('uninstall_skill_unknown'); expect(existsSync(f.home)).toBe(true);
    rmSync(skill, { recursive: true }); atomicWrite(join(target, 'file.txt'), 'KEEP'); symlinkSync(target, skill);
    symlinkSync(target, join(f.home, 'cache'));
    expect(f.run(['uninstall', '--yes']).status).toBe(0); expect(readFileSync(join(target, 'file.txt'), 'utf8')).toBe('KEEP');
});

test('a registration for another home using this installation is refused; foreign software is retained', async () => {
    const f = await setup(), path = join(f.claude, '.claude.json'), other = join(f.root, 'other-home');
    put(path, { mcpServers: { runweft: managed(f.binary, other) } });
    const before = readFileSync(path, 'utf8');
    expect(f.error(f.run(['uninstall', '--yes']))).toBe('uninstall_mcp_other_home'); expect(readFileSync(path, 'utf8')).toBe(before);
    put(path, { mcpServers: { runweft: managed('/another/program', other) } });
    const foreign = readFileSync(path, 'utf8'); expect(f.run(['uninstall', '--yes']).status).toBe(0); expect(readFileSync(path, 'utf8')).toBe(foreign);
});

test('backup-free multi-file editing rolls back in memory and does not need the native Codex command', async () => {
    const f = await setup(), c = loadConfig(f.home, f.env);
    atomicWrite(join(f.codex, 'config.toml'), '[mcp_servers]\nrunweft={command="old", args=["--home", '+JSON.stringify(f.home)+'],env={RUNWEFT_MCP_MANAGED="1"}}\n');
    c.env.PATH = '';
    expect(prepareMcpChanges(c, false).filter(change => change.before !== change.after)).toHaveLength(1);
    const a = join(f.root, 'a'), b = join(f.root, 'b'); atomicWrite(a, 'before-a'); atomicWrite(b, 'before-b');
    expect(() => applyConfigChanges(c, 'complete-uninstall', [{ path:a,before:'before-a',after:'after-a' },{ path:b,before:'before-b',after:'after-b' }], (path, value) => {
        if (path === b) throw new Error('injected'); atomicWrite(path, value!);
    }, false)).toThrow('配置写入失败');
    expect(readFileSync(a,'utf8')).toBe('before-a'); expect(readFileSync(b,'utf8')).toBe('before-b'); expect(existsSync(join(f.home, 'backups'))).toBe(false);
});

test('worktree removal cleans exact managed refs and registration while keeping source files and user branches', async () => {
    const f = await setup(), repository = join(f.root, 'project'), id = randomUUID(), checkout = join(f.home, 'connections', 'one', 'hapi', 'workspaces', 'environments', id, 'checkout');
    mkdirSync(repository); atomicWrite(join(repository, 'source.txt'), 'KEEP');
    const git = (...args: string[]) => { const result=spawnSync('git',['-C',repository,...args],{encoding:'utf8'});expect(result.status).toBe(0);return result.stdout.trim(); };
    git('init','-b','main');git('add','.');git('-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-m','base');
    const head=git('rev-parse','HEAD'), commonDir=git('rev-parse','--path-format=absolute','--git-common-dir');
    git('branch','user-branch');git('update-ref','refs/hapi/results/user-result',head);
    git('worktree','add','-b',`hapi-task/${id}`,checkout,head);git('update-ref',`refs/hapi/workspaces/${id}/base`,head);
    const record={version:1,environmentId:id,checkout,branch:`hapi-task/${id}`,source:{repositoryRoot:repository,commonDir,baseCommit:head},results:{}};
    put(join(checkout,'..','workspace.json'), {...record, branch:'main'});
    expect(f.error(f.run(['uninstall','--yes']))).toBe('uninstall_workspace_unknown');expect(git('rev-parse','main')).toBe(head);
    put(join(checkout,'..','workspace.json'),record);atomicWrite(join(repository,'uncommitted.txt'),'KEEP_UNCOMMITTED');
    expect(f.run(['uninstall','--yes']).status).toBe(0);expect(readFileSync(join(repository,'source.txt'),'utf8')).toBe('KEEP');
    expect(readFileSync(join(repository,'uncommitted.txt'),'utf8')).toBe('KEEP_UNCOMMITTED');
    expect(git('for-each-ref','--format=%(refname)')).toBe('refs/hapi/results/user-result\nrefs/heads/main\nrefs/heads/user-branch');
    expect(git('worktree','list','--porcelain')).not.toContain(checkout);
});

test('other-home live MCP blocks uninstall and corrupted process records are not guessed', async () => {
    const f = await setup(), other = join(f.root,'other-home');
    const child=spawn(f.binary,['--home',other,'mcp','serve','--client','codex'],{cwd:f.root,env:f.env,stdio:['pipe','ignore','ignore']});
    owner.resources.push(async()=>{child.kill('SIGTERM');await new Promise<void>(resolve=>{if(child.exitCode!==null||child.signalCode!==null)resolve();else child.once('exit',()=>resolve());});});
    await Bun.sleep(100);
    expect(f.error(f.run(['uninstall','--yes']))).toBe('uninstall_process_busy');expect(existsSync(f.home)).toBe(true);
    const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill('SIGTERM');await exited;
    atomicWrite(join(f.home,'server','process.json'),'not-json');
    expect(f.error(f.run(['uninstall','--yes']))).toBe('uninstall_process_unknown');expect(existsSync(f.binary)).toBe(true);
});

test('standalone package with unknown extra files and raw development binaries are refused', async () => {
    const f=await setup();atomicWrite(join(f.pkg,'user-project.txt'),'KEEP');
    expect(f.error(f.run(['uninstall','--yes']))).toBe('uninstall_installation_unknown');
    const raw=await compiledCli(), result=spawnSync(raw,['--home',f.home,'--json','uninstall','--yes'],{env:f.env,encoding:'utf8'});
    expect(result.status).toBe(1);expect(JSON.parse(result.stderr).error.code).toBe('uninstall_installation_unknown');expect(existsSync(raw)).toBe(true);
});
