export default '';

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
