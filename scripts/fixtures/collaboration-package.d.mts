export function collaborationPackage(file: string, binary: string, explicitHapi: string | undefined, expectedOwner: string): {
    source: any; binaries: any; hapi: string; env: NodeJS.ProcessEnv;
    cli(home: string, args: string[], cwd?: string, allowedExit?: number): any;
    api(path: string, method?: string): Promise<any>;
    hash(bytes: Uint8Array): string;
    start(runnerHomes: string[]): Promise<void>;
    startRunner(home: string): void;
    verifyNoReplay(released?: boolean, fetchRevisions?: Record<string, number>): Promise<void>;
    quiesce(): Promise<string[]>;
    close(success: boolean, consumerEvidence: string): Promise<string[]>;
};
