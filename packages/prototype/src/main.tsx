import './forms.js';
import { createRoot } from 'react-dom/client';
import { setDisplayTimeZone } from '@runweft/ui';
import { connectPreview } from './bridge.js';
import { App } from './app';

// Fixed clock and time zone, so every review sees the same times.
setDisplayTimeZone('Asia/Shanghai');
// The immutable hosting path is the protocol version; local previews use a local marker.
const version = location.pathname.match(/^\/runweft\/([^/]+)\//)?.[1] || 'local-preview';
let ready = false;
const onReady = () => {
    if (ready) return;
    ready = true; connectPreview({ version }); document.body.dataset.ready = 'true';
};
try {
    createRoot(document.getElementById('app')!).render(<App onReady={onReady} />);
} catch (error) {
    connectPreview({ version, status: 'error', message: error instanceof Error ? error.message : String(error) });
    throw error;
}
