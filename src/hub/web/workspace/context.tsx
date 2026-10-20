import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Banner, Button, EmptyState, Loading, clockTime, type IconName } from '@runweft/ui';
import { HubApiError } from '../api/http';
import type { Identity, IdentityApi, Role, Space, SpaceApi } from '../api/hub';
import type { View } from '../route';

export type Notice = { tone: 'ok' | 'info' | 'warn' | 'danger'; title: string; text?: string };

export type Workspace = {
    identity: Identity;
    username: string;
    spaces: Space[];
    space: Space;
    role: Role;
    identityApi: IdentityApi;
    spaceApi: SpaceApi;
    view: View;
    navigate(view: View, options?: { focus?: boolean }): void;
    refreshTick: number;
    refresh(): void;
    /** Runs a write. Success shows a toast; expiry signs out; other failures go to `onError` or the page banner. */
    run<T>(action: () => Promise<T>, options?: { success?: string; onError?: (error: HubApiError) => void }): Promise<T | undefined>;
    showAlert(error: HubApiError | null): void;
    reloadIdentity(options?: { spaceId?: string }): Promise<boolean>;
    switchSpace(spaceId: string): void;
    /** Revokes the current account session; space changes cannot cancel an explicit sign-out. */
    endSession(action: (api: IdentityApi) => Promise<unknown>, notice: Notice, onError?: (error: HubApiError) => void): Promise<void>;
    expire(): void;
    showOnboarding(kind?: 'hub' | 'machine'): void;
};

export const WorkspaceContext = createContext<Workspace | null>(null);

export function useWorkspace() {
    const value = useContext(WorkspaceContext);
    if (!value) throw new Error('useWorkspace requires the workspace shell.');
    return value;
}

type ResourceState<T> = { data?: T; error?: HubApiError; loading: boolean; stale: boolean; at?: number };

/**
 * Reads page data. A refresh keeps the last successful result; if it fails, the page shows what it has with a
 * banner instead of going blank. Answers that arrive after the page or context changed are dropped.
 */
export function useResource<T>(load: () => Promise<T>, deps: unknown[]) {
    const { refreshTick, expire } = useWorkspace();
    const [state, setState] = useState<ResourceState<T>>({ loading: true, stale: false });
    const [retry, setRetry] = useState(0);
    const loader = useRef(load);
    loader.current = load;
    useEffect(() => {
        let live = true;
        setState(current => ({ ...current, loading: true }));
        loader.current().then(data => { if (live) setState({ data, loading: false, stale: false, at: Date.now() }); }, (error: unknown) => {
            if (!live) return;
            if (error instanceof HubApiError && error.kind === 'expired') { expire(); return; }
            const failure = error instanceof HubApiError ? error : new HubApiError('error', '读取失败', error instanceof Error ? error.message : '');
            setState(current => current.data !== undefined ? { ...current, loading: false, stale: true, error: failure } : { loading: false, stale: false, error: failure });
        });
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [...deps, refreshTick, retry]);
    const reload = useCallback(() => setRetry(value => value + 1), []);
    return { ...state, reload };
}

/** Renders a resource: first load, first-load failure with retry, stale banner after a failed refresh, then content. */
export function Resource<T>({ resource, label, icon = 'wifi-off', children }: { resource: ReturnType<typeof useResource<T>>; label: string; icon?: IconName; children: (data: T) => ReactNode }) {
    if (resource.data === undefined) {
        if (resource.error) {
            const error = resource.error;
            return <EmptyState icon={icon} tone="offline" title={`无法读取${label}`} actions={<Button icon="refresh" variant="primary" onClick={resource.reload}>重试</Button>}>{[error.message, error.hint].filter(Boolean).join('。')}</EmptyState>;
        }
        return <Loading />;
    }
    return (
        <>
            {resource.stale && resource.error && (
                <Banner tone="offline" title={`刷新失败：${resource.error.message}`} actions={<Button size="sm" icon="refresh" onClick={resource.reload}>重试</Button>}>
                    下面是 {resource.at ? clockTime(resource.at) : '之前'} 读取的内容，可能已经变化。你的账号和设置不会改变。
                </Banner>
            )}
            {children(resource.data)}
        </>
    );
}
