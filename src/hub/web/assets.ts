// Bun macro: imported `with { type: 'macro' }`, it runs at bundle time and inlines the built front end, so the
// compiled CLI serves the same bytes without shipping sources. Running from source builds on first import.
export function hubWebAssets(): { js: string; css: string } {
    const child = Bun.spawnSync([process.execPath, `${import.meta.dir}/build-assets.ts`], { stdout: 'pipe', stderr: 'pipe' });
    if (child.exitCode !== 0) throw new Error(`Hub front-end build failed:\n${child.stderr.toString()}`);
    return JSON.parse(child.stdout.toString());
}
