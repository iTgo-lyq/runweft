// Shared state for the prototype pages: the in-memory demo, navigation, the single write path and page loading.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, EmptyState, Loading } from '@runweft/ui';
import { HubError, createDemo, type Demo } from './mock.js';

export const demo: Demo = createDemo();

export const routes = ['tasks', 'machines', 'runtimes', 'agents', 'repositories', 'selections', 'members', 'settings'] as const;
export type Route = (typeof routes)[number];
export type Notice = { tone: 'ok' | 'info' | 'warn' | 'danger'; title: string; text?: string; first?: boolean };

export type Proto = {
    route: Route;
    /** Bumps on every refresh; pages reload when it changes. */
    refreshTick: number;
    navigate(route: Route | 'account', options?: { focus?: boolean }): void;
    refresh(): void;
    /** Writes go through one path so expired sessions and unconfirmed results are handled the same way everywhere. */
    run<T>(action: () => Promise<T>, options?: { success?: string; onError?: (error: HubError) => void }): Promise<T | true | false>;
    showAlert(error: HubError): void;
    setStale(stale: boolean): void;
    expire(): void;
    showOnboarding(kind?: 'hub' | 'machine'): void;
    openNative(detail: any, kind: 'session' | 'files'): void;
    /** Re-renders the shell after the demo data behind it changed (space, role, user). */
    changed(): void;
    /** Called when a page finishes its first load, so pending focus or a pending refresh can follow. */
    pageLoaded(): void;
    signedOut(notice: Notice): void;
};

export const ProtoContext = createContext<Proto | null>(null);
export function useProto() {
    const value = useContext(ProtoContext);
    if (!value) throw new Error('useProto requires the prototype app.');
    return value;
}

/**
 * Loads a page the way the accepted prototype did: the first load shows a spinner or a failure with retry; a refresh
 * marks the demo as refreshing so the "refresh failed" scenario applies, keeps what was loaded and flags it as stale.
 */
export function usePage<T>(load: () => Promise<T>, deps: unknown[] = []) {
    const ctx = useProto();
    const [state, setState] = useState<{ data?: T; error?: HubError; loading: boolean }>({ loading: true });
    const loaded = useRef(false), loader = useRef(load);
    loader.current = load;
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        let live = true;
        const refreshing = loaded.current;
        demo.settings.refreshing = refreshing;
        let pending: Promise<T>;
        try { pending = loader.current(); } finally { demo.settings.refreshing = false; }
        setState(current => ({ ...current, loading: true }));
        pending.then(data => {
            if (!live) return;
            const first = !loaded.current;
            loaded.current = true; ctx.setStale(false);
            setState({ data, loading: false });
            if (first) ctx.pageLoaded();
        }, (error: unknown) => {
            if (!live) return;
            if (!(error instanceof HubError)) throw error;
            if (error.kind === 'expired') { ctx.expire(); return; }
            if (refreshing) { ctx.setStale(true); setState(current => ({ ...current, loading: false })); return; }
            setState({ error, loading: false });
        });
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ctx.refreshTick, retry, ...deps]);
    const reload = useCallback(() => setRetry(value => value + 1), []);
    return { ...state, reload };
}

/** First load and first-load failure for a page; afterwards the page renders its data. */
export function Loaded<T>({ page, label, children }: { page: ReturnType<typeof usePage<T>>; label: string; children: (data: T) => ReactNode }) {
    if (page.data !== undefined) return <>{children(page.data)}</>;
    if (page.error) {
        return (
            <div className="page-inner">
                <EmptyState icon="wifi-off" tone="offline" title={`无法读取${label}`} actions={<Button icon="refresh" variant="primary" onClick={page.reload}>重试</Button>}>
                    {`${page.error.message}。${page.error.hint}`}
                </EmptyState>
            </div>
        );
    }
    return <Loading />;
}
