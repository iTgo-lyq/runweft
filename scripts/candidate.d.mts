export function readCandidate(directory: string): { directory: string; index: any; platform: string; entries: any[] };
export function isolatedEnvironment(root: string): NodeJS.ProcessEnv;
export function installCandidate(directory: string, root: string, layout?: 'npm' | 'standalone'): Promise<ReturnType<typeof readCandidate> & {
    cli: string; root: string; env: NodeJS.ProcessEnv;
    binaries: { runweft: { path: string; sha256: string }; hapi: { path: string; sha256: string } };
}>;
