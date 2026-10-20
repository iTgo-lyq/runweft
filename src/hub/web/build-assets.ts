// Builds the Hub front end and prints `{ js, css }` as JSON. Run as a separate process by the `assets` macro,
// because Bun.build cannot run inside a macro.
import { join } from 'node:path';
import { buildFrontend } from '../../../packages/ui/build';

const assets = await buildFrontend({ entry: join(import.meta.dir, 'main.tsx'), css: join(import.meta.dir, 'app.css') });
process.stdout.write(JSON.stringify(assets));
