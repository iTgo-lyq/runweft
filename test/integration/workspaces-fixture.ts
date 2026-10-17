import { expect } from 'bun:test';
import type { ManagedWorkspace, WorkspaceMutation, WorkspaceRequest } from '../../hapi/shared/src/workspaces';

// Protocol fixture for the real coordinator/HTTP/SQLite tests; actual Git is verified in HAPI and compiled smoke.
export function workspaces() {
    const records = new Map<string, ManagedWorkspace>(), calls: WorkspaceRequest[] = [];
    const control = { holdPrepare: false, holdFinish: false, holdRemove: false, failPrepare: false, failFinish: false, failRemove: false,
        dropPrepare: false, dropFinish: false, dropRemove: false, rejectResolve: false,
        base: 'a'.repeat(40), onFinalize: () => {} };
    function update(workspace: ManagedWorkspace) {
        for (const operation of Object.values(workspace.operations)) {
            if (operation.status !== 'accepted') continue;
            const request = operation.request;
            if (request.action === 'prepare') {
                if (control.holdPrepare) continue;
                operation.status = control.failPrepare ? 'failed' : 'succeeded';
                if (control.failPrepare) operation.error = { code: 'git_failed', message: 'Checkout initialization failed' };
                else workspace.preparations[request.preparationId] = { environmentId: request.environmentId, preparationId: request.preparationId,
                    roundId: request.roundId, cwd: workspace.cwd, startHead: request.expectedHead, inputs: request.inputs.map(input => ({ ...input, path: `/workspace-inputs/${request.preparationId}/${input.name}` })), readyAt: Date.now() };
            } else if (request.action === 'finalize') {
                if (control.holdFinish) continue;
                operation.status = control.failFinish ? 'failed' : 'succeeded';
                if (control.failFinish) operation.error = { code: 'git_failed', message: 'Commit hook failed' };
                else workspace.results[request.roundId] = { environmentId: request.environmentId, roundId: request.roundId,
                    baseCommit: workspace.source.baseCommit, startHead: workspace.preparations[request.preparationId]!.startHead,
                    resultHead: (Object.keys(workspace.results).length ? 'c' : 'b').repeat(40), resultRef: `refs/hapi/workspaces/${request.environmentId}/rounds/${request.roundId}`,
                    partial: request.partial, fileCount: 1, paths: ['file.txt'], sealedAt: Date.now() };
            } else if (request.action === 'remove') {
                if (control.holdRemove) continue;
                operation.status = control.failRemove && !request.discardIgnored ? 'failed' : 'succeeded';
                if (operation.status === 'failed') {
                    operation.error = { code: 'workspace_ignored_files', message: 'Checkout contains ignored paths', hint: 'Explicitly discard ignored files' };
                    workspace.status = 'retained';
                } else workspace.status = 'removed';
            }
        }
    }
    return { records, calls, control, handler: async (http: Request) => {
        const request = await http.json() as WorkspaceRequest; calls.push(request);
        if (request.action === 'resolve' && control.rejectResolve) return Response.json({ code: 'git_failed', error: 'Git baseline does not exist', hint: 'Choose an existing commit' }, { status: 409 });
        if (request.action === 'resolve') return Response.json({ source: { machineId: new URL(http.url).pathname.split('/')[3], repositoryId: 'repository', sourcePath: request.cwd,
            repositoryRoot: request.cwd, commonDir: request.cwd + '/.git', relativePath: '', baseRef: request.baseRef,
            baseCommit: control.base, objectFormat: 'sha1', dirty: true } });
        let workspace = records.get(request.environmentId);
        if (!workspace && request.action === 'prepare') {
            workspace = { version: 1, environmentId: request.environmentId, source: request.source, checkout: `/prepared/${request.environmentId}`,
                cwd: `/prepared/${request.environmentId}`, branch: `hapi-task/${request.environmentId}`, status: 'retained', createdAt: Date.now(),
                preparations: {}, results: {}, operations: {}, sessions: {} }; records.set(request.environmentId, workspace);
        }
        if (!workspace) return Response.json({ code: 'workspace_not_found' }, { status: 404 });
        if (request.action === 'inspect') { update(workspace); return Response.json({ workspace }); }
        const key = request.action === 'prepare' ? `prepare:${request.preparationId}` : request.action === 'finalize' ? `finalize:${request.roundId}:${request.attemptId}` : `remove:${request.attemptId}`;
        if (!workspace.operations[key]) {
            if (request.action === 'finalize') control.onFinalize();
            workspace.operations[key] = { id: key, request: request as WorkspaceMutation, status: 'accepted', createdAt: Date.now(), updatedAt: Date.now() };
            if (request.action === 'remove') workspace.status = 'deleting';
        } else expect(workspace.operations[key]!.request).toEqual(request);
        if (request.action === 'prepare' && control.dropPrepare) { control.dropPrepare = false; return new Response('', { status: 502 }); }
        if (request.action === 'finalize' && control.dropFinish) { control.dropFinish = false; return new Response('', { status: 502 }); }
        if (request.action === 'remove' && control.dropRemove) { control.dropRemove = false; return new Response('', { status: 502 }); }
        return Response.json({ workspace, operation: workspace.operations[key] });
    } };
}

