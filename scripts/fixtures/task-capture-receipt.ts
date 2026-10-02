import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { ArtifactTransfer, CapturedArtifact } from '../../hapi/shared/src/artifactTransfers';

/** Read only this current public manifest's matching Runner capture, without manager side effects. */
export function taskCaptureReceipt(root: string, nativeHome: string, cwd: string, output: { captureOperationId: string; name: string; relativePath: string; sha256: string; size: number }) {
    assert(nativeHome.startsWith(resolve(root) + sep)); assert(/^[0-9a-f-]{36}$/.test(output.captureOperationId));
    const directory = join(nativeHome, 'artifact-transfers', output.captureOperationId);
    assert.equal(realpathSync(directory), directory);
    const receipt = JSON.parse(readFileSync(join(directory, 'receipt.json'), 'utf8')) as ArtifactTransfer;
    assert.equal(receipt.version, 1); assert.equal(receipt.request.operationId, output.captureOperationId);
    assert.equal(receipt.request.action, 'capture');
    if (receipt.request.action !== 'capture') throw new Error('Capture receipt required');
    assert.equal(receipt.request.cwd, cwd);
    assert(receipt.request.files.some(file => file.name === output.name && file.relativePath === output.relativePath));
    const candidate = receipt.candidates?.find(file => file.name === output.name) as Extract<CapturedArtifact, { status: 'captured' }>;
    assert(candidate && candidate.status === 'captured');
    assert.equal(candidate.relativePath, output.relativePath); assert.equal(candidate.sha256, output.sha256); assert.equal(candidate.size, output.size);
    assert.equal(candidate.path, join(directory, 'spool', createHash('sha256').update(output.name).digest('hex')));
    return { receipt, candidate };
}
