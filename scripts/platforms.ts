export const platforms = [
    { id: 'darwin-arm64', os: 'darwin', cpu: 'arm64', target: 'bun-darwin-arm64' },
    { id: 'darwin-x64', os: 'darwin', cpu: 'x64', target: 'bun-darwin-x64' },
    { id: 'linux-arm64', os: 'linux', cpu: 'arm64', target: 'bun-linux-arm64' },
    { id: 'linux-x64', os: 'linux', cpu: 'x64', target: 'bun-linux-x64-baseline' },
] as const;
export type Platform = typeof platforms[number];

export function selectedPlatforms(args = process.argv.slice(2)): readonly Platform[] {
    if (args.includes('--all')) return platforms;
    const index = args.indexOf('--platform');
    const id = index === -1 ? `${process.platform}-${process.arch}` : args[index + 1];
    const selected = platforms.find(platform => platform.id === id);
    if (!selected) throw new Error(`Unsupported platform: ${id}. Expected ${platforms.map(platform => platform.id).join(', ')}.`);
    return [selected];
}
