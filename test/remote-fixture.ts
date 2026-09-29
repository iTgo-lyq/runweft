import { randomUUID, createHash } from 'node:crypto';
import type { Artifact } from '../hapi/shared/src/artifacts';
import type { RepositoryOperation, RepositorySnapshot } from '../hapi/shared/src/repositories';
import type { ArtifactTransfer } from '../hapi/shared/src/artifactTransfers';
import type { ManagedWorkspace, WorkspaceSource } from '../hapi/shared/src/workspaces';
import type { PreparationView } from '../src/remote/client';
import { resourceFixture, resourceWrite } from './resources-fixture';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
export async function remoteFixture(cleanups: (() => Promise<void> | void)[], assetCount = 2) {
    const repos = new Map<string, RepositoryOperation>(), transfers = new Map<string, ArtifactTransfer>(), objects = new Map<string, Artifact>();
    const refs = new Map<string, Set<string>>(), workspaces = new Map<string, ManagedWorkspace>();
    const faults = { exportHold: false, deliverLost: false, partialDelivery: false, targetOffline: false, import: false, prepare: false, cleanup: false,
        releaseLost: false, resultMismatch: false, resultFail: false, fetchLost: false, sourceOffline: false, dirty: false, ignored: false, cacheHeld: false, unpinLost: false, maxFileBytes: 1_000_000, quota: 100_000_000 };
    const requests: { domain: string; machine: string; body: any }[] = [];
    let commit = 'a'.repeat(40);
    const source = (cwd: string, ref: string): WorkspaceSource => ({ machineId: 'own', repositoryId: 'source-repository', sourcePath: cwd, repositoryRoot: '/source', commonDir: '/source/.git',
        relativePath: cwd.endsWith('/sub') ? 'sub' : '', baseRef: ref, baseCommit: commit, objectFormat: 'sha1', dirty: true });
    const h = await resourceFixture(cleanups, { preparations: true, async fetch(request, namespace) {
        const path = new URL(request.url).pathname, parts = path.split('/');
        const error = (code: string, status = 409) => Response.json({ error: { code, message: code } }, { status });
        if (path === '/api/artifacts/limits') return Response.json({ limits: { maxFileBytes: faults.maxFileBytes, namespaceQuotaBytes: faults.quota, unreferencedDays: 7, pendingHours: 24 },
            usedBytes: [...objects.values()].filter(item => item.namespace === namespace).reduce((sum, object) => sum + object.size, 0),
            usage: { reservedBytes: 0, availableBytes: 0, deletingBytes: 0, referencedBytes: 0, objectCount: objects.size, referencedCount: refs.size } });
        if (parts[2] === 'artifacts') {
            const object = objects.get(parts[3]); if (!object || object.namespace !== namespace) return error('artifact_not_found', 404);
            if (parts[4] === 'references') { const key = decodeURIComponent(parts[5]); if (request.method === 'PUT') { if (object.state !== 'available') return error('artifact_not_available'); (refs.get(object.id) ?? refs.set(object.id, new Set()).get(object.id)!).add(key); }
                else { refs.get(object.id)?.delete(key); if (faults.unpinLost) { faults.unpinLost = false; return error('unpin_response_lost', 502); } } return Response.json({ ok: true }); }
            return Response.json({ artifact: object });
        }
        const machine = parts[3], domain = parts[4];
        if (!['repositories', 'artifacts', 'workspaces'].includes(domain)) return;
        if (namespace !== 'alpha') return error('machine_not_found', 404);
        if ((machine === 'remote' && faults.targetOffline) || (machine === 'own' && faults.sourceOffline)) return error('machine_offline');
        const body = await request.json() as any; requests.push({ domain, machine, body });
        if (domain === 'repositories') {
            let operation = repos.get(body.operationId);
            if (body.action === 'inspect') {
                if (!operation) return error('repository_operation_missing');
                if (operation.status === 'running' && !faults.exportHold) operation.status = 'succeeded';
            } else if (body.action === 'release') {
                if (!operation) return error('repository_operation_missing');
                if (faults.cleanup) return error('cleanup_unavailable', 503);
                if (operation.request.action === 'import') {
                    operation.cache = { retained: faults.cacheHeld, directory: '/target/cache.git', ...(faults.cacheHeld ? { reason: { code: 'repository_unknown_ref', message: 'unknown code reference' } } : {}) };
                }
                if (!body.names) operation.retention = 'released';
                operation.releasedFiles.push(...(body.names ?? (operation.snapshot?.files ?? []).map(file => file.name)));
            } else if (!operation) {
                const sealed = body.action === 'export-result' ? workspaces.get(body.environmentId)! : undefined;
                const fixed = sealed?.results[body.roundId];
                const origin = sealed ? { ...sealed.source, baseCommit: fixed!.resultHead } : body.source;
                if (body.action === 'fetch-result') {
                    operation = { version: 1, request: body, directory: `/fetches/${body.operationId}`, status: 'succeeded', retention: 'retained', releasedFiles: [], createdAt: Date.now(), updatedAt: Date.now(),
                        fetched: { target: body.target, ref: `refs/hapi/results/${body.result.environmentId}/${body.result.roundId}`, head: body.result.resultHead, fetchedAt: Date.now(), repositories: [], lfs: [] } };
                    repos.set(body.operationId, operation);
                    if (faults.fetchLost) { faults.fetchLost = false; return error('rpc_response_lost', 502); }
                    return Response.json({ operation });
                }
                const snapshot: RepositorySnapshot = body.action === 'import' ? body.snapshot : {
                    version: 1, manifestId: body.operationId, sourceMachineId: machine, repositoryId: origin.repositoryId, baseCommit: origin.baseCommit, objectFormat: 'sha1',
                    repositories: [{ path: '', commit: origin.baseCommit, objectFormat: 'sha1', bundleRef: `refs/heads/baseline-${body.operationId}`, file: 'root.bundle' }],
                    lfs: Array.from({ length: assetCount }, (_, index) => ({ repository: '', path: `file-${index}.bin`, oid: digest(`lfs:${index}`), size: 10, file: `lfs-${index}` })),
                    files: [{ name: 'root.bundle', kind: 'bundle', sha256: digest(origin.baseCommit), size: 20 },
                        ...Array.from({ length: assetCount }, (_, index) => ({ name: `lfs-${index}`, kind: 'lfs' as const, sha256: digest(`lfs:${index}`), size: 10 }))],
                };
                operation = { version: 1, request: body, directory: `/exports/${body.operationId}`, snapshot,
                    status: body.action === 'export' && faults.exportHold ? 'running' : 'succeeded', retention: 'retained', releasedFiles: [], createdAt: Date.now(), updatedAt: Date.now() };
                if (sealed) {
                    operation.sealed = { source: { ...sealed.source, sourcePath: sealed.checkout, baseCommit: fixed!.resultHead }, result: structuredClone(fixed!), verifiedAt: Date.now() };
                    if (faults.resultMismatch) operation.sealed.result.resultHead = 'e'.repeat(40);
                    if (faults.resultFail) { operation.status = 'failed'; operation.error = { code: 'repository_result_missing', message: 'missing result bytes' }; }
                }
                if (body.action === 'import') operation.imported = { source: { ...source('/target/cache.git', 'baseline'), sourcePath: '/target/cache.git',
                    machineId: machine, repositoryId: 'target-repository', repositoryRoot: '/target/cache.git', commonDir: '/target/cache.git', relativePath: '', dirty: false,
                    baseCommit: snapshot.baseCommit, baseRef: `refs/hapi/snapshots/${snapshot.manifestId}`, snapshot: { importOperationId: body.operationId, manifestId: snapshot.manifestId } },
                    repositories: [{ path: '', directory: '/target/cache.git', ref: `refs/hapi/snapshots/${snapshot.manifestId}` }] };
                if (body.action === 'import' && faults.import) { operation.status = 'failed'; operation.error = { code: 'repository_bundle_invalid', message: 'invalid bundle' }; delete operation.imported; }
                repos.set(body.operationId, operation);
            }
            return Response.json({ operation });
        }
        if (domain === 'artifacts') {
            let operation = transfers.get(body.operationId);
            if (body.action === 'inspect') { if (!operation) return error('artifact_operation_missing'); }
            else if (body.action === 'release') {
                if (!operation) return error('artifact_operation_missing'); if (faults.cleanup) return error('cleanup_unavailable', 503);
                for (const item of operation.candidates ?? []) if (item.status === 'captured' && (!body.names || body.names.includes(item.name))) item.retention = 'released';
                operation.retention = operation.candidates?.some(item => item.status === 'captured' && item.retention === 'retained') ? 'retained' : 'released';
            }
            else if (!operation) {
                operation = { version: 1, request: body, status: 'succeeded', retention: 'retained', sessions: [], files: [], createdAt: Date.now(), updatedAt: Date.now() };
                if (body.action === 'capture') {
                    const snapshot = [...repos.values()].find(item => item.directory === body.cwd)!.snapshot!;
                    operation.candidates = body.files.map((file: any) => ({ ...file, ...snapshot.files.find(item => item.name === file.name), status: 'captured', retention: 'retained', capturedAt: Date.now(), path: `/spool/${body.operationId}/${file.name}` }));
                } else if (body.action === 'deliver') {
                    const captured = transfers.get(body.captureOperationId)!;
                    operation.deliveries = body.files.map((file: any, index: number) => {
                        if (index === 0 && faults.partialDelivery) return { name: file.name, status: 'failed', error: { code: 'upload_failed', message: 'upload failed' } };
                        const candidate = captured.candidates!.find(item => item.name === file.name)!; if (candidate.status !== 'captured') throw new Error('candidate missing');
                        const object: Artifact = { id: randomUUID(), namespace, requestId: file.requestId, filename: file.name, sha256: candidate.sha256, size: candidate.size,
                            mimeType: 'application/octet-stream', state: 'available', createdAt: Date.now(), publishedAt: Date.now(), deletedAt: null, error: null };
                        objects.set(object.id, object); refs.set(object.id, new Set([file.reference.reference])); return { name: file.name, status: 'available', artifact: object };
                    });
                    if (faults.partialDelivery) { operation.status = 'failed'; operation.error = { code: 'artifact_delivery_incomplete', message: 'some files failed' }; }
                } else operation.files = body.files.map((file: any) => ({ ...file, path: `/inputs/${body.operationId}/${file.name}` }));
                transfers.set(body.operationId, operation);
                if (body.action === 'deliver' && faults.deliverLost) { faults.deliverLost = false; return error('rpc_response_lost', 502); }
            }
            return Response.json({ operation });
        }
        if (body.action === 'resolve') return Response.json({ source: source(body.cwd, body.baseRef) });
        if (body.action === 'inspect') return workspaces.has(body.environmentId) ? Response.json({ workspace: workspaces.get(body.environmentId) }) : error('workspace_not_found');
        if (body.action === 'finalize' || body.action === 'remove') {
            const workspace = workspaces.get(body.environmentId); if (!workspace) return error('workspace_not_found');
            const key = body.action === 'finalize' ? `finalize:${body.roundId}:${body.attemptId}` : `remove:${body.attemptId}`;
            let operation = workspace.operations[key];
            if (!operation) {
                const problem = faults.dirty ? { code: 'workspace_unrecovered_changes', message: 'unrecovered code' }
                    : body.action === 'remove' && faults.ignored && !body.discardIgnored ? { code: 'workspace_ignored_files', message: 'ignored files retained' } : undefined;
                operation = { id: key, request: body, status: problem ? 'failed' : 'succeeded', error: problem, createdAt: Date.now(), updatedAt: Date.now() };
                workspace.operations[key] = operation;
                if (!problem && body.action === 'remove') workspace.status = 'removed';
                if (!problem && body.action === 'finalize') workspace.results[body.roundId] = { environmentId: body.environmentId, roundId: body.roundId,
                    baseCommit: workspace.source.baseCommit, startHead: workspace.source.baseCommit, resultHead: workspace.source.baseCommit,
                    resultRef: `refs/rounds/${body.roundId}`, partial: false, fileCount: 0, paths: [], sealedAt: Date.now() };
                if (!problem && body.action === 'remove' && faults.releaseLost) { faults.releaseLost = false; return error('remove_response_lost', 502); }
            }
            return Response.json({ workspace, operation });
        }
        if (body.action !== 'prepare') return error('unexpected_workspace_operation', 500);
        let workspace = workspaces.get(body.environmentId);
        if (!workspace) {
            const checkout = `/workspaces/${body.environmentId}`, cwd = checkout + (body.source.relativePath ? `/${body.source.relativePath}` : '');
            const operation = { id: `prepare:${body.preparationId}`, request: body, status: faults.prepare ? 'failed' as const : 'succeeded' as const, createdAt: Date.now(), updatedAt: Date.now(),
                ...(faults.prepare ? { error: { code: 'workspace_drift', message: 'workspace changed' } } : {}) };
            workspace = { version: 1, environmentId: body.environmentId, source: body.source, checkout, cwd, branch: `hapi-task/${body.environmentId}`, status: 'retained', createdAt: Date.now(), results: {}, sessions: {},
                operations: { [operation.id]: operation }, preparations: faults.prepare ? {} : { [body.preparationId]: { environmentId: body.environmentId, preparationId: body.preparationId, roundId: body.roundId, cwd, startHead: body.expectedHead, inputs: [], readyAt: Date.now() } } };
            workspaces.set(body.environmentId, workspace);
        } else if (!workspace.operations[`prepare:${body.preparationId}`]) {
            const key = `prepare:${body.preparationId}`;
            workspace.operations[key] = { id: key, request: body, status: 'succeeded', createdAt: Date.now(), updatedAt: Date.now() };
            workspace.preparations[body.preparationId] = { environmentId: body.environmentId, preparationId: body.preparationId,
                roundId: body.roundId, cwd: workspace.cwd, startHead: body.expectedHead, inputs: [], readyAt: Date.now() };
        }
        return Response.json({ workspace, operation: workspace.operations[`prepare:${body.preparationId}`] });
    } });
    for (const machine of h.machines) machine.runnerState!.capabilities = { ...machine.runnerState!.capabilities, repositoryExport: 1, repositoryImport: 1, repositoryResults: 1, mcpToolFilter: true, artifactTransfers: 1, artifactOutputs: 1, managedWorkspaces: 1 };
    const runtime = await h.register('remote');
    const parent = { kind: 'cli' as const, machineId: 'own', cwd: h.home };
    const payload = () => ({ parent, requestId: randomUUID(), intent: { agent: 'reviewer', baseRef: 'HEAD' },
        agent: { id: 'reviewer', definitionVersion: 'fixed', runtimeId: runtime.id, machineId: runtime.machineId, flavor: runtime.flavor, namespace: 'alpha' } });
    const post = (action: string, value: object) => h.alpha.request(`/api/runweft/workspaces/${action}`, resourceWrite(value));
    const inspect = async (id: string): Promise<PreparationView> => (await post('inspect', { parent, id })).preparation;
    h.preparations!.start();
    return { ...h, get tasks() { return h.tasks; }, get service() { return h.preparations!; }, parent, payload, post, inspect, faults, requests, objects, refs, repos, transfers, workspaces, setCommit(value: string) { commit = value; } };
}
