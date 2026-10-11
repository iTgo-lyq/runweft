import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// These dedicated smoke directories contain the same sanitized reports previously uploaded.
function walk(directory, allJson) {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory() && !['node_modules', 'release-source', 'artifact-backup'].includes(entry.name)) walk(path, allJson);
        else if (entry.isFile() && (entry.name === 'evidence.json' || allJson && entry.name.endsWith('.json'))) {
            const report = JSON.parse(readFileSync(path, 'utf8'));
            console.log('RUNWEFT_CI_EVIDENCE=' + JSON.stringify({ path, report }));
            if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
                '\nEvidence: ' + path + ' — success=' + String(report.success ?? 'not specified') + '\n');
        }
    }
}
walk(process.argv[2] ?? '.dev-smoke', process.argv[2] === '.dev-smoke/website-pages');
