import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { assertFrozenCandidate } from './fixtures/release-inputs.mjs';

const packages = resolve(process.argv[2] ?? 'dist/packages'), website = resolve(process.argv[3] ?? 'dist/website');
assert(process.argv[4] && process.argv[5], 'Supply reviewed acceptance Markdown and sanitized evidence index JSON');
const acceptance = resolve(process.argv[4]), evidenceFile = resolve(process.argv[5]);
const index = JSON.parse(readFileSync(join(packages, 'index.json'), 'utf8'));
const evidence = JSON.parse(readFileSync(evidenceFile, 'utf8'));
assertFrozenCandidate(index);
assert.equal(evidence.version, index.version); assert.equal(evidence.sourceRevision, index.source.revision);
assert.equal(evidence.success, true);
const site = JSON.parse(readFileSync(join(website, 'release.json'), 'utf8'));
assert.equal(site.version, index.version, 'Website npm version must match the candidate');
assert.equal(site.installation, 'npm', 'Website must use npm installation');
assert.equal(site.package, 'runweft', 'Website npm package must be runweft');
assert.equal(site.registry, 'https://registry.npmjs.org/', 'Website must use the public npm registry');
assert(!['platforms', 'skill', 'source', 'hapi'].some(key => key in site) && !existsSync(join(website, 'downloads')), 'Website must not contain legacy downloads or release-source fields');
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
function command(args, cwd = process.cwd()) {
    const result = spawnSync(args[0], args.slice(1), { cwd, encoding: 'utf8', timeout: 300_000, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(result.status, 0, `${args[0]}: ${result.stderr || result.error}`);
    return result.stdout.trim();
}
const checksums = readFileSync(join(packages, 'SHA256SUMS'), 'utf8').trim().split('\n');
for (const line of checksums) {
    const [expected, path] = line.split('  ');
    assert.equal(hash(join(packages, path)), expected);
}
mkdirSync('dist', { recursive: true });
const destination = resolve(`dist/runweft-${index.version}-release`);
assert(!existsSync(destination) && !existsSync(destination + '.tar.gz'), 'Release destination exists; select an explicit backup or remove only the previous generated delivery');
const staging = mkdtempSync(resolve('dist/release-staging-')), output = join(staging, 'release');
mkdirSync(output); mkdirSync(join(output, 'packages')); mkdirSync(join(output, 'source')); mkdirSync(join(output, 'validation'));
try {
    for (const line of checksums) {
        const path = line.split('  ')[1];
        cpSync(join(packages, path), join(output, 'packages', path), { recursive: true });
    }
    cpSync(join(packages, 'SHA256SUMS'), join(output, 'packages/SHA256SUMS'));
    cpSync(website, join(output, 'website'), { recursive: true });
    cpSync(acceptance, join(output, 'validation/acceptance.md'));
    cpSync(evidenceFile, join(output, 'validation/evidence.json'));
    cpSync('docs/usage.md', join(output, 'USAGE.md'));
    const source = join(staging, 'source'); mkdirSync(source);
    for (const [name, repository, revision] of [
        ['runweft', process.cwd(), index.source.revision],
        ['hapi', resolve('hapi'), index.hapi.revision],
    ]) {
        const archive = join(staging, `${name}.tar`), checkout = name === 'runweft' ? source : join(source, 'hapi');
        mkdirSync(checkout, { recursive: true });
        command(['git', '-C', repository, 'archive', '--format=tar', '--output', archive, revision]);
        command(['tar', '-xf', archive, '-C', checkout]);
        const mirror = join(staging, `${name}.git`);
        command(['git', 'clone', '--bare', '--shared', repository, mirror]);
        command(['git', '--git-dir', mirror, 'update-ref', '--no-deref', 'HEAD', revision]);
        const bundle = join(output, 'source', `${name}.bundle`);
        command(['git', '--git-dir', mirror, 'bundle', 'create', bundle, 'HEAD']);
        assert.equal(command(['git', 'bundle', 'list-heads', bundle]).split(' ')[0], revision);
        command(['git', 'bundle', 'verify', bundle], repository);
    }
    command(['tar', '-czf', join(output, 'source/runweft-source.tar.gz'), '-C', source, '.']);
    writeFileSync(join(output, 'source/README.md'), `# 对应源码\n\n程序源码：${index.source.revision}\nHAPI：${index.hapi.revision}\n\nrunweft-source.tar.gz 含两仓库的对应源码，不含凭据、node_modules 或验证现场。保留 Git 身份进行构建时使用离线 bundle：\n\n\`\`\`sh\nsource_dir=\"$(pwd)\"\ngit clone \"$source_dir/runweft.bundle\" runweft\ncd runweft\ngit -c protocol.file.allow=always -c submodule.hapi.url=\"$source_dir/hapi.bundle\" submodule update --init hapi\nbun install --frozen-lockfile\n(cd hapi && bun install --frozen-lockfile)\nbun run build:hapi\nbun run typecheck && bun run test && bun run build\n\`\`\`\n\n依赖下载仍需 registry/构建工具网络；bundle 不依赖远端 Git。后续验收提交记录在 ../validation/evidence.json，不冒充程序源码提交。\n`);
    writeFileSync(join(output, 'README.md'), `# Runweft ${index.version} 完整交付\n\n程序源码 ${index.source.revision}；HAPI ${index.hapi.version} / ${index.hapi.revision}。\n\n- 先用 \`sha256sum -c SHA256SUMS\`（Mac 用 \`shasum -a 256 -c SHA256SUMS\`）核对整批文件。\n- 平台包、主包、Skill 与来源索引在 packages/；从 packages/ 按 ../USAGE.md 操作，保持相邻 Runweft/HAPI 布局。\n- 用户将 Skill 交给 Agent 完成安装/连接；身份通过 Web 加密确认，不给模型 token。常规安装使用 npm；packages/ 保留离线交付。\n- website/ 是 npm 安装静态官网，不含下载副本，可用静态 HTTP 服务器预览。其 npm 版本标识公开包，不证明网页与离线程序来自同一提交；不含生产部署。\n- source/ 含对应两仓库源码及离线 Git bundle；validation/ 是经过筛选的验收与程序 hash，无原生配置或密钥。\n- Linux x64 的真实安装/协作与 arm64 QEMU 分开记录；Mac 双架构仅构建，未签名/公证；物理跨机未测，同机多 Runner 不替代它。\n\n实际逐项结果与限制以 validation/acceptance.md 和 evidence.json 为准。\n`);
    const files = [];
    function collect(directory) {
        for (const name of readdirSync(directory).sort()) {
            const path = join(directory, name);
            if (statSync(path).isDirectory()) collect(path);
            else files.push(relative(output, path));
        }
    }
    collect(output);
    writeFileSync(join(output, 'SHA256SUMS'), files.map(path => `${hash(join(output, path))}  ${path}\n`).join(''));
    command(['sha256sum', '-c', 'SHA256SUMS'], output);
    renameSync(output, destination);
    command(['tar', '-czf', destination + '.tar.gz', '-C', resolve('dist'), relative(resolve('dist'), destination)]);
    writeFileSync(destination + '.tar.gz.sha256', `${hash(destination + '.tar.gz')}  ${relative(resolve('dist'), destination)}.tar.gz\n`);
    console.log(JSON.stringify({ directory: destination, archive: destination + '.tar.gz', sha256: hash(destination + '.tar.gz'), files: files.length }, null, 2));
} finally { rmSync(staging, { recursive: true, force: true }); }
