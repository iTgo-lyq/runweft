import type { Platform } from './platforms';

export async function createHapiSourceArchive(revision: string, platform: Platform, output: string) {
    const tree = Bun.spawnSync(['git', '-C', 'hapi', 'ls-tree', '-r', '--name-only', '-z', revision]);
    if (tree.exitCode !== 0) throw new Error('Cannot read pinned HAPI source tree');
    const toolSuffix = `-${platform.cpu}-${platform.os}.tar.gz`;
    const files = tree.stdout.toString().split('\0').filter(Boolean).filter(file =>
        !file.startsWith('cli/tools/archives/') || !file.endsWith('.tar.gz') || file.endsWith(toolSuffix));
    for (const tool of ['difftastic', 'ripgrep']) {
        if (!files.includes(`cli/tools/archives/${tool}${toolSuffix}`)) {
            throw new Error(`Missing pinned ${tool} archive for ${platform.id}`);
        }
    }
    const child = Bun.spawn(['git', '--literal-pathspecs', '-C', 'hapi', 'archive', '--format=tar.gz',
        '--output', output, revision, '--', ...files], { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' });
    if (await child.exited !== 0) throw new Error(`Cannot archive HAPI sources for ${platform.id}`);
}
