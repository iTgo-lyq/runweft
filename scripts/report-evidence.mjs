import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function collectEvidence(files, website = false) {
    assert(files.length, 'Provide explicit report files; directories and implicit scans are not supported');
    const paths = new Set();
    return files.map(file => {
        // Existing website log IDs are a recovery protocol, independent of physical working directories.
        const path = website ? '.dev-smoke/website-pages/' + basename(file) : resolve(file);
        if (website) assert(/^(eligibility|check|prepare|recovery|deployment|browser(?:-(?:1440|390)){0,2})\.json$/.test(basename(file)), 'Unknown website report');
        assert(!paths.has(path), 'Conflicting or duplicate report: ' + path); paths.add(path);
        const report = JSON.parse(readFileSync(file, 'utf8'));
        assert(report && typeof report === 'object' && !Array.isArray(report), 'Invalid report: ' + path);
        return { path, report };
    });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const website = process.argv[2] === '--website';
    // Validate the entire list before emitting anything, including a missing or conflicting later file.
    for (const evidence of collectEvidence(process.argv.slice(website ? 3 : 2), website)) {
        console.log('RUNWEFT_CI_EVIDENCE=' + JSON.stringify(evidence));
        if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
            '\nEvidence: ' + evidence.path + ' — success=' + String(evidence.report.success ?? 'not specified') + '\n');
    }
}
