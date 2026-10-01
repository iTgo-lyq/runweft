import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixture } from './helpers';

test('npm website builds without release packages and preserves the existing site on invalid inputs', async () => {
    const { buildSite } = await import(pathToFileURL(resolve('website/build.mjs')).href);
    const projectDirectory = fixture('website-npm-build');
    cpSync(resolve('website'), join(projectDirectory, 'website'), { recursive: true });
    mkdirSync(join(projectDirectory, 'docs'));
    writeFileSync(join(projectDirectory, 'docs/usage.md'), 'npm usage <script>unsafe</script>\n## 离线完整交付（工程参考）\nprivate offline appendix');
    const manifest = join(projectDirectory, 'package.json');
    writeFileSync(manifest, JSON.stringify({ version: '1.1.0' }));
    expect(existsSync(join(projectDirectory, 'dist/packages'))).toBe(false);
    const outputDirectory = join(projectDirectory, 'dist/website');
    await buildSite({ projectDirectory, outputDirectory });
    expect(JSON.parse(readFileSync(join(outputDirectory, 'release.json'), 'utf8'))).toEqual({
        version: '1.1.0', installation: 'npm', package: 'runweft', registry: 'https://registry.npmjs.org/',
    });
    expect(existsSync(join(outputDirectory, 'downloads'))).toBe(false);
    const files = readdirSync(outputDirectory, { recursive: true }) as string[];
    expect(files.some(file => /\.(tgz|gz|sha256)$|SHA256SUMS/.test(file))).toBe(false);
    const manual = readFileSync(join(outputDirectory, 'manual.html'), 'utf8');
    expect(manual).toContain('&lt;script&gt;unsafe&lt;/script&gt;');
    expect(manual).not.toContain('private offline appendix');
    const digest = () => createHash('sha256').update(readFileSync(join(outputDirectory, 'index.html'))).digest('hex');
    const before = digest();
    writeFileSync(manifest, JSON.stringify({ version: 'invalid' }));
    await expect(buildSite({ projectDirectory, outputDirectory })).rejects.toThrow('npm 安装版本无效');
    expect(digest()).toBe(before);
    writeFileSync(manifest, JSON.stringify({ version: '1.1.0' }));
    writeFileSync(join(projectDirectory, 'website/guide.html'), '{{UNKNOWN_FIELD}}');
    await expect(buildSite({ projectDirectory, outputDirectory })).rejects.toThrow('未知页面占位符');
    expect(digest()).toBe(before);
    expect(readdirSync(join(projectDirectory, 'dist')).filter(name => name.startsWith('.website-'))).toEqual([]);
});
