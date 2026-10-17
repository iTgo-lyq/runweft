import { afterEach, expect, spyOn, test } from 'bun:test';
import { hubDelegationFixture } from './hub-delegation-fixture';
import { until } from '../helpers';
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

test('current records reject missing versions, snapshots, relationships and malformed recovery data without repairing or executing them', async () => {
    const h = await hubDelegationFixture(cleanups);
    const kick = spyOn(h.gateway.delegation.coordinator, 'kick').mockImplementation(() => {});
    const accepted = await h.post('spawn', h.payload()), id = accepted.agent_id;
    await h.gateway.delegation.close(); kick.mockRestore();
    const db = h.gateway.store.db;
    const cases = [
        ['delegation_tasks', id, (row: any) => { delete row.version; }],
        ['delegation_tasks', id, (row: any) => { row.version = 1; }],
        ['delegation_tasks', id, (row: any) => { delete row.hub; }],
        ['delegation_tasks', id, (row: any) => { row.id = crypto.randomUUID(); }],
        ['delegation_tasks', id, (row: any) => { row.hub.ownerId = h.other.identity.id; }],
        ['delegation_rounds', accepted.round_id, (row: any) => { delete row.agent; }],
        ['delegation_rounds', accepted.round_id, (row: any) => { row.agent = null; }],
        ['delegation_rounds', accepted.round_id, (row: any) => { row.agent.hub.target.machineId = crypto.randomUUID(); }],
        ['delegation_rounds', accepted.round_id, (row: any) => { row.taskId = crypto.randomUUID(); }],
        ['delegation_rounds', accepted.round_id, (row: any) => { row.outputFiles = { declarations: [], jobs: [null] }; }],
    ] as const;
    for (const [table, key, damage] of cases) {
        const original = (db.query(`SELECT data FROM ${table} WHERE id=?`).get(key) as { data: string }).data;
        const value = JSON.parse(original); damage(value); const invalid = JSON.stringify(value);
        db.query(`UPDATE ${table} SET data=? WHERE id=?`).run(invalid, key);
        for (const [action, args] of [['read', { id }], ['wait', { ids: [id], timeoutMs: 0 }]] as const) {
            await expect(h.post(action, args)).rejects.toMatchObject({ status: 503, code: 'state_record_invalid' });
            expect(db.query(`SELECT data FROM ${table} WHERE id=?`).get(key)).toEqual({ data: invalid });
        }
        db.query(`UPDATE ${table} SET data=? WHERE id=?`).run(original, key);
    }
    const input = db.query('SELECT id, data FROM delegation_inputs WHERE roundId=?').get(accepted.round_id) as { id: string; data: string };
    db.query('UPDATE delegation_inputs SET data=? WHERE id=?').run('{PRIVATE_INVALID_INPUT', input.id);
    await expect(h.post('read', { id })).rejects.toMatchObject({ code: 'state_record_invalid' });
    db.query('UPDATE delegation_inputs SET data=? WHERE id=?').run(input.data, input.id);
    const fetchId = crypto.randomUUID();
    db.query('INSERT INTO delegation_code_fetches VALUES (?, ?, ?, ?, ?)').run(fetchId, id, accepted.round_id, 'waiting', 'null');
    await expect(h.post('read', { id })).rejects.toMatchObject({ code: 'state_record_invalid' });
    expect(db.query('SELECT data FROM delegation_code_fetches WHERE id=?').get(fetchId)).toEqual({ data: 'null' });
    expect(h.calls.spawn).toBe(0); expect(h.calls.send).toBe(0); expect(h.calls.stop).toBe(0);
});

test('gateway restart isolates an invalid task and restores a valid current task without logging stored content', async () => {
    const h = await hubDelegationFixture(cleanups);
    const kick = spyOn(h.gateway.delegation.coordinator, 'kick').mockImplementation(() => {});
    const bad = await h.post('spawn', h.payload()), good = await h.post('spawn', h.payload());
    await h.gateway.delegation.close(); kick.mockRestore();
    const db = h.gateway.store.db, raw = '{PRIVATE_TASK_CONTENT';
    db.query('UPDATE delegation_tasks SET data=? WHERE id=?').run(raw, bad.agent_id);
    const logs: string[] = [], logger = spyOn(console, 'error').mockImplementation(value => { logs.push(String(value)); });
    try {
        await h.restart();
        const running = await until(() => h.post('read', { id: good.agent_id }), view => view.inputs[0]?.observation?.phase === 'accepted');
        h.complete(running.session_id);
        await until(() => h.post('read', { id: good.agent_id }), view => view.status === 'completed');
        expect(h.calls.spawn).toBe(1); expect(h.calls.send).toBe(1);
        await expect(h.post('read', { id: bad.agent_id })).rejects.toMatchObject({ code: 'state_record_invalid' });
        expect(h.gateway.store.db.query('SELECT data FROM delegation_tasks WHERE id=?').get(bad.agent_id)).toEqual({ data: raw });
        expect(logs.length).toBeGreaterThan(0);
        for (const line of logs) expect(JSON.parse(line)).toEqual({ taskId: bad.agent_id, code: 'state_record_invalid' });
    } finally { logger.mockRestore(); }
});
