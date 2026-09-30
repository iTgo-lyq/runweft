// Loaded only by the dedicated acceptance proxy. It is never part of the shipped dashboard.
export {};
const control = location.pathname;
const config = await (await fetch(control + '/config')).json() as { token: string; taskCount: number; realTaskCount: number; retainedSessionId: string; retainedSessionTitle: string };
const frame = document.querySelector('iframe')!;
const checks: string[] = [], failures: string[] = [];
const evidence = { success: false, checks, failures, userAgent: navigator.userAgent, startedAt: new Date().toISOString(), viewport: { width: innerWidth, height: innerHeight }, layout: [] as object[] };
const doc = () => frame.contentDocument!;
const node = <T extends HTMLElement = HTMLElement>(id: string) => doc().getElementById(id) as T;
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until(check: () => unknown, message: string, ms = 10_000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
    throw new Error(message);
}
function record(value: string) { checks.push(value); document.getElementById('progress')!.textContent = value; }
async function state(values?: object): Promise<{ authCalls: number; readCalls: number; sessionReads: number }> {
    return (await fetch(control + '/state', values ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(values) } : {})).json();
}
async function load(path = '/runweft/') {
    await new Promise<void>((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('Frame load timed out')), 15_000);
        frame.onload = () => { clearTimeout(timeout); resolve(); }; frame.src = path;
    });
    await until(() => node('login'), 'Dashboard did not render');
}
async function connect() {
    node<HTMLInputElement>('access-token').value = config.token; node<HTMLFormElement>('login-form').requestSubmit();
    await until(() => node('login').hidden && !doc().querySelector<HTMLButtonElement>('#login-form button')!.disabled && doc().querySelector('.task'), 'Authenticated task list did not load');
}
async function filter(workspace = '', parent = '', status = '') {
    node<HTMLInputElement>('workspace').value = workspace; node<HTMLInputElement>('parent').value = parent; node<HTMLSelectElement>('status').value = status;
    node<HTMLFormElement>('filters').requestSubmit();
    await until(() => node('refresh').textContent === '刷新', 'Filtering did not settle');
}
async function refresh() {
    node('refresh').click(); await until(() => node('refresh').textContent === '刷新', 'Refresh did not settle');
}
try {
    localStorage.removeItem(`hapi_access_token::${location.origin}`);
    localStorage.setItem('hapi_hub_url', 'https://other.invalid');
    await load(); assert(!node('login').hidden, 'Missing login form'); await connect();
    assert(localStorage.getItem(`hapi_access_token::${location.origin}`) === config.token, 'Login was not shared with HAPI');
    assert(Number(node('count').textContent) === config.taskCount && doc().querySelectorAll('.task').length === 50, 'Global page count is wrong');
    record('Same-origin HAPI login, shared storage and first 50 tasks');
    const first = doc().querySelector<HTMLDetailsElement>('.task')!; first.open = true;
    assert(first.querySelector('.report')!.textContent!.includes('<img'), 'Fixture report missing');
    assert(!first.querySelector('.report img') && !(frame.contentWindow as any).dashboardInjected, 'Report HTML executed');
    await refresh(); assert(doc().querySelector('details[open]'), 'Refresh collapsed the open detail');
    for (const link of doc().querySelectorAll<HTMLAnchorElement>('.detail-links a, nav a')) {
        const url = new URL(link.href); assert(url.origin === location.origin && url.searchParams.get('hub') === location.origin && !url.searchParams.has('token'), 'HAPI link used a different origin or leaked token');
    }
    record('Pure-text reports, preserved expanded detail, current-Hub links without tokens');
    await filter('/dashboard/alpha', 'native-parent-2', 'unknown');
    assert(Number(node('count').textContent) === 3, 'Combined workspace/parent/status filter failed');
    assert([...doc().querySelectorAll('.track-cell:first-child strong')].every(node => node.textContent === '未知'), 'Unknown became success');
    await filter('/not-found'); assert(doc().querySelector('.empty h3')?.textContent === '没有匹配的任务', 'No-match state missing');
    await filter(); node('next').click(); await until(() => node('page-info').textContent?.includes('第 2'), 'Pagination failed');
    assert(doc().querySelectorAll('.task').length === config.taskCount - 50, 'Second page count wrong');
    node('previous').click(); await until(() => node('page-info').textContent?.includes('第 1'), 'Previous page failed');
    record('Workspace/parent/status filters, no-match result and pagination');
    await state({ offline: true }); await refresh(); assert(doc().querySelector('.stale'), 'Offline unfinished rows were not marked stale');
    await filter('', '', 'completed'); assert(!doc().querySelector('.stale'), 'Completed facts became stale execution');
    await state({ offline: false }); await filter();
    const before = doc().querySelectorAll('.task').length;
    await state({ unavailable: true }); await refresh();
    assert(!node('notice').hidden && node('notice').textContent!.includes('保留上次成功') && doc().querySelectorAll('.task').length === before, 'Failed refresh dropped or disguised previous data');
    await state({ unavailable: false }); await refresh(); assert(node('notice').hidden, 'Recovery did not clear error');
    record('Offline active rows, reliable completed records and preserved data on failed refresh');
    const authentication = await state({ expireOnce: true }); await refresh();
    assert((await state()).authCalls === authentication.authCalls + 1 && node('login').hidden, 'Expired JWT did not reauthenticate once');
    await state({ authRejected: true, expireOnce: true }); await refresh();
    assert(!node('login').hidden && !node('notice').hidden, 'Authentication failure did not request login');
    await state({ authRejected: false }); await connect();
    record('One JWT renewal and visible persistent authentication failure');
    await state({ empty: true }); await refresh(); assert(doc().querySelector('.empty h3')?.textContent === '还没有协作任务', 'Empty history confused with filtered results');
    await state({ empty: false }); await refresh();
    await load('/runweft/?token=' + encodeURIComponent(config.token)); await until(() => doc().querySelector('.task'), 'URL-token login did not load');
    assert(!new URL(frame.contentWindow!.location.href).searchParams.has('token'), 'URL token was retained');
    record('Empty history and immediate URL-token removal');
    for (const width of [1200, 375]) {
        frame.width = String(width); await new Promise(resolve => setTimeout(resolve, 100));
        const content = doc().documentElement;
        assert(content.scrollWidth <= content.clientWidth + 1, `Horizontal overflow at ${width}px`);
        const detail = doc().querySelector<HTMLDetailsElement>('details')!; detail.open = true;
        const summary = detail.querySelector('summary')!; summary.focus();
        assert(doc().activeElement === summary && frame.contentWindow!.getComputedStyle(summary).outlineStyle !== 'none', 'Keyboard focus is not visible');
        assert(content.scrollWidth <= content.clientWidth + 1, `Expanded detail overflow at ${width}px`);
        evidence.layout.push({ width, clientWidth: content.clientWidth, scrollWidth: content.scrollWidth });
    }
    record('Desktop and 375px layout, expanded details and keyboard focus');
    const detailLink = [...doc().querySelectorAll<HTMLAnchorElement>('.detail-links a')].find(link => new URL(link.href).pathname === '/sessions/' + encodeURIComponent(config.retainedSessionId));
    assert(detailLink, 'Missing link to the retained native session');
    const readsBefore = (await state()).sessionReads;
    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('HAPI navigation timed out')), 15_000);
        frame.onload = () => { clearTimeout(timeout); resolve(); }; detailLink.click();
    });
    await until(() => doc().body.textContent?.includes(config.retainedSessionTitle), 'HAPI did not display the retained native session', 20_000);
    assert((await state()).sessionReads > readsBefore, 'HAPI did not read the real retained session');
    assert(!doc().querySelector('input[type=password]'), 'HAPI asked for login again');
    record('Actual HAPI retained-session navigation with shared login and unchanged session inventory');
    await load(); await until(() => doc().querySelector('.task'), 'Returning to dashboard lost shared login');
    evidence.success = true;
} catch (error) { failures.push(error instanceof Error ? error.message : String(error)); document.getElementById('progress')!.textContent = failures.join('\n'); }
await fetch(control + '/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...evidence, completedAt: new Date().toISOString() }) });
document.getElementById('progress')!.textContent = evidence.success ? '自动验收通过。' : '自动验收失败：' + failures.join('; ');
