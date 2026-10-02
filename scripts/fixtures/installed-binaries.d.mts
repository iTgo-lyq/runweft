export function installedBinaries(command: string): {
    runweft: { path: string; sha256: string };
    hapi: { path: string; sha256: string };
};
export function assertCandidateBinaries(command: string, expected: ReturnType<typeof installedBinaries>, explicitHapi?: string): ReturnType<typeof installedBinaries>;
