/** A bounded smoke operation must not leave its losing timer holding the process open. */
export async function withSmokeDeadline<T>(operation: Promise<T>, ms: number, expired: () => T): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([operation, new Promise<T>((resolve, reject) => {
            timer = setTimeout(() => {
                try { resolve(expired()); } catch (error) { reject(error); }
            }, ms);
        })]);
    } finally { clearTimeout(timer); }
}
