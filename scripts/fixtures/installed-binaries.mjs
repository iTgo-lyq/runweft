import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';

export function installedBinaries(command) {
    let executable = realpathSync(command);
    if (basename(executable) === 'runweft.cjs') {
        const require = createRequire(executable);
        executable = realpathSync(join(dirname(require.resolve(`runweft-${process.platform}-${process.arch}/package.json`)), 'bin/runweft'));
    }
    const native = realpathSync(join(dirname(executable), 'hapi'));
    const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
    return { runweft: { path: executable, sha256: hash(executable) }, hapi: { path: native, sha256: hash(native) } };
}
