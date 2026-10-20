import { useCallback } from 'react';
import { Badge } from '@runweft/ui';
import type { MachineView } from '../../resources/types';
import { useResource, useWorkspace } from '../workspace/context';

export const flavorLabels: Record<string, string> = { codex: 'Codex', claude: 'Claude Code' };

export function ConnectionBadge({ state }: { state: MachineView['connection'] }) {
    if (state === 'online') return <Badge tone="ok" icon="st-done">在线</Badge>;
    if (state === 'offline') return <Badge tone="neutral" icon="wifi-off">离线</Badge>;
    return <Badge tone="neutral" icon="st-pending">尚未首次连接</Badge>;
}

export const connectionText: Record<MachineView['connection'], string> = { online: '在线', offline: '离线', pending: '尚未首次连接' };

export function ListHead({ columns }: { columns: string[] }) {
    return <div className="list-head" aria-hidden="true">{columns.map((text, index) => <span key={index}>{text}</span>)}</div>;
}

/**
 * Names resource owners from the current space's members. Resources stay visible after an owner leaves, so an
 * unknown owner is described rather than guessed.
 */
export function useOwners() {
    const ws = useWorkspace();
    const members = useResource(() => ws.identityApi.members(ws.space.id), [ws.identityApi, ws.space.id]);
    return useCallback((ownerId: string) => {
        if (ownerId === ws.identity.id) return '你';
        return members.data?.find(member => member.userId === ownerId)?.name ?? '已离开此空间的成员';
    }, [members.data, ws.identity.id]);
}

/** Resource writes send an empty object where the Hub expects no fields, and reload the page data on success. */
export function useMutate(reload: () => void) {
    const ws = useWorkspace();
    return useCallback(async (path: string, method: string, body: object, success: string) => {
        const done = await ws.run(() => ws.spaceApi.request(path, body, method), { success });
        if (done) reload();
        return done;
    }, [reload, ws]);
}
