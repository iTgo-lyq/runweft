// Hash routing. `connect`, `space`, `task`, `round` and `native-expired` are contracts with the CLI and the native
// page; `view` only remembers the current entry across reloads.
export const views = ['tasks', 'machines', 'runtimes', 'agents', 'repositories', 'selections', 'members', 'settings'] as const;
export type View = (typeof views)[number];

export type HashState = { view?: View; space?: string; task?: string; round?: string; connect?: string; nativeExpired: boolean };

export function readHash(hash = location.hash): HashState {
    const query = new URLSearchParams(hash.slice(1));
    const view = query.get('view');
    return {
        view: views.includes(view as View) ? view as View : undefined,
        space: query.get('space') ?? undefined,
        task: query.get('task') ?? undefined,
        round: query.get('round') ?? undefined,
        connect: query.get('connect') ?? undefined,
        nativeExpired: query.has('native-expired'),
    };
}

/** Updates the hash without adding history entries or firing `hashchange`. `null` removes a key. */
export function patchHash(patch: Partial<Record<'view' | 'space' | 'task' | 'round' | 'connect' | 'native-expired', string | null>>) {
    const query = new URLSearchParams(location.hash.slice(1));
    for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === undefined) query.delete(key);
        else query.set(key, value);
    }
    const text = query.toString().replace(/=(?=&|$)/g, '');
    history.replaceState(null, '', location.pathname + (text ? `#${text}` : ''));
}
