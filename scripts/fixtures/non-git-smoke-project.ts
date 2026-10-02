import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { observeRepository } from '../../src/hub/repositories/observation';

/** One owned .dev-smoke project outside repository ancestors; never scan old temporary directories. */
export function nonGitSmokeProject() {
    const root = mkdtempSync(join(tmpdir(), 'runweft-non-git-')), project = join(root, '.dev-smoke', 'project');
    try { mkdirSync(project, { recursive: true, mode: 0o700 }); assert.equal(observeRepository(project).kind, 'non_git'); }
    catch (error) { try { rmSync(root, { recursive: true, force: true }); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Non-Git fixture setup failed'); } throw error; }
    return { root, project, close() { rmSync(root, { recursive: true, force: true }); } };
}
