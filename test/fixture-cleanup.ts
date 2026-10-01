export type Cleanup = () => void | Promise<void>;

/** Each fixture owns one reverse-order cleanup; all resources are attempted on failure. */
export function fixtureCleanup(parent: Cleanup[]) {
    const resources: Cleanup[] = [];
    async function close() {
        const errors: unknown[] = [];
        for (const cleanup of resources.splice(0).reverse()) {
            try { await cleanup(); } catch (error) { errors.push(error); }
        }
        if (errors.length) throw new AggregateError(errors, 'Fixture cleanup failed');
    }
    parent.push(close);
    return { resources, close, async failed(error: unknown): Promise<never> {
        try { await close(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Fixture construction and cleanup failed'); }
        throw error;
    } };
}
