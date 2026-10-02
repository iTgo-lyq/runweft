import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { collaborationPackage } from './fixtures/collaboration-package.mjs';
import { consoleHistory } from './fixtures/hub-console-history';

const binary = resolve(process.argv[2]!), source = resolve(process.argv[3]!);
mkdirSync('.dev-smoke', { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/shared-package-')), evidencePath = join(root, 'evidence.json');
const evidence: any = { source, success: false, history: [], cleanupErrors: [] };
let fixture: ReturnType<typeof collaborationPackage> | undefined;
try {
    fixture = collaborationPackage(source, binary, undefined, 'shared-package');
    assert(!fixture.source.worktree && fixture.source.cases.length === 1);
    // Native browser history is copied read-only; the case owns the only final cleanup.
    await consoleHistory({ binary, hapiBinary: fixture.hapi, sources: [source], record: result => evidence.history.push(result) });
    await fixture.start(fixture.source.runners.map((runner: any) => runner.clientHome));
    fixture.cli(fixture.source.serverHome, ['restart']);
    await fixture.verifyNoReplay();
    for (const round of fixture.source.cases[0].rounds) {
        const history = await fixture.api(`/api/sessions/${round.view.session_id}/messages`);
        assert(history.messages.length > 0);
    }
    evidence.success = true;
} catch (error) { evidence.error = String(error); process.exitCode = 1; }
finally {
    if (fixture) evidence.cleanupErrors = await fixture.close(evidence.success, evidencePath);
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${evidencePath}`);
}
