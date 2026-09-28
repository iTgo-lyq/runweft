export class RunweftError extends Error {
    constructor(public readonly code: string, message: string, public readonly hint?: string) {
        super(message);
        this.name = 'RunweftError';
    }
}

export function errorDetails(error: unknown) {
    return error instanceof RunweftError
        ? { code: error.code, message: error.message, hint: error.hint }
        : { code: 'operation_failed', message: error instanceof Error ? error.message : String(error) };
}
