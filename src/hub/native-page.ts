export default '';
type NativePageEventSource = EventSource;

const nativeKey = `hapi_access_token::${location.origin}`;
const sessionKey = 'runweft.native.access';
const storageGet = Storage.prototype.getItem;
const storageSet = Storage.prototype.setItem;
const storageRemove = Storage.prototype.removeItem;
const expires = (token: string) => {
    try {
        const payload = JSON.parse(atob(token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')));
        return payload.iss === 'runweft-hub' && payload.aud === 'runweft-access' && payload.kind === 'user' && payload.space
            && typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
    } catch { return 0; }
};
sessionStorage.removeItem('runweft.hub.identity');
const token = storageGet.call(sessionStorage, sessionKey) ?? '';
if (expires(token) <= Date.now()) {
    storageRemove.call(sessionStorage, sessionKey);
    location.replace('/hub#native-expired');
} else {
    class HeaderEventSource extends EventTarget {
        static readonly CONNECTING = 0; static readonly OPEN = 1; static readonly CLOSED = 2;
        readonly CONNECTING = 0; readonly OPEN = 1; readonly CLOSED = 2;
        readonly url: string; readonly withCredentials = false;
        readyState = 0;
        onopen: NativePageEventSource['onopen'] = null;
        onmessage: NativePageEventSource['onmessage'] = null;
        onerror: NativePageEventSource['onerror'] = null;
        private abort = new AbortController();
        constructor(input: string | URL) {
            super();
            const url = new URL(String(input), location.origin);
            if (url.origin !== location.origin || url.pathname !== '/api/events') throw new Error('Only same-origin Hub events are allowed.');
            url.searchParams.delete('token'); this.url = url.href;
            void this.read();
        }
        close() { this.readyState = 2; this.abort.abort(); }
        private emit(event: Event) {
            this.dispatchEvent(event);
            const handler = event.type === 'open' ? this.onopen : event.type === 'error' ? this.onerror : event.type === 'message' ? this.onmessage : null;
            handler?.call(this as unknown as NativePageEventSource, event as MessageEvent);
        }
        private async read() {
            try {
                const credential = storageGet.call(sessionStorage, sessionKey) ?? '';
                const response = await fetch(this.url, { credentials: 'omit', redirect: 'error', signal: this.abort.signal,
                    headers: { authorization: `Bearer ${credential}`, accept: 'text/event-stream' } });
                if (response.status === 401) { storageRemove.call(sessionStorage, sessionKey); location.replace('/hub#native-expired'); return; }
                if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Hub event stream unavailable.');
                this.readyState = 1; this.emit(new Event('open'));
                const reader = response.body.getReader(), decoder = new TextDecoder();
                let buffer = '', lastEventId = '';
                while (!this.abort.signal.aborted) {
                    const chunk = await reader.read();
                    if (chunk.done) throw new Error('Hub event stream closed.');
                    buffer += decoder.decode(chunk.value, { stream: true });
                    let boundary: number;
                    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
                        const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
                        const data: string[] = []; let type = 'message';
                        for (const line of block.split('\n')) {
                            const separator = line.indexOf(':'), name = separator < 0 ? line : line.slice(0, separator);
                            const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
                            if (name === 'data') data.push(value);
                            else if (name === 'event') type = value;
                            else if (name === 'id' && !value.includes('\0')) lastEventId = value;
                        }
                        if (data.length) this.emit(new MessageEvent(type, { data: data.join('\n'), origin: location.origin, lastEventId }));
                    }
                }
            } catch {
                if (!this.abort.signal.aborted) { this.readyState = 2; this.emit(new Event('error')); }
            }
        }
    }
    window.EventSource = HeaderEventSource as unknown as typeof EventSource;
    Storage.prototype.getItem = function (key: string) {
        if (this === localStorage && key === 'hapi_hub_url') return location.origin;
        if (this === localStorage && key.startsWith('hapi_access_token::')) {
            return key === nativeKey ? storageGet.call(sessionStorage, sessionKey) : null;
        }
        return storageGet.call(this, key);
    };
    Storage.prototype.setItem = function (key: string, value: string) {
        if (this === localStorage && key === 'hapi_hub_url') return;
        if (this === localStorage && key.startsWith('hapi_access_token::')) {
            if (key !== nativeKey || expires(value) <= Date.now()) {
                location.replace('/hub#native-expired'); return;
            }
            storageSet.call(sessionStorage, sessionKey, value); return;
        }
        storageSet.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key: string) {
        if (this === localStorage && key === 'hapi_hub_url') return;
        if (this === localStorage && key.startsWith('hapi_access_token::')) {
            storageRemove.call(sessionStorage, sessionKey); location.replace('/hub#native-expired'); return;
        }
        storageRemove.call(this, key);
    };
    setTimeout(() => {
        storageRemove.call(sessionStorage, sessionKey); location.replace('/hub#native-expired');
    }, expires(token) - Date.now());
    document.addEventListener('DOMContentLoaded', () => {
        const link = document.createElement('a');
        link.href = '/hub'; link.textContent = '返回 Runweft Hub · 此原生页面使用限时身份';
        link.setAttribute('style', 'display:block;padding:8px 16px;background:#f3f6fa;color:#245ac7;font:13px system-ui;position:relative;z-index:9999');
        document.body.prepend(link);
    });
}
