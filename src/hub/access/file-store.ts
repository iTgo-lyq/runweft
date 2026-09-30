import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ArtifactReserveSchema, ArtifactReferenceSchema } from '../../../hapi/shared/src/artifacts';
import { HubError, hubNotFound } from '../types';
import { AccessStore } from './store';
import type { Principal } from './types';
import { fingerprint, inputError } from './transport';

type Reservation = { id: string; sender: string; requestId: string; ownerId: string; spaceId: string | null;
    taskId: string | null; machineId: string | null; filename: string; reference: string | null;
    fingerprint: string | null; artifactId: string | null; cancelledAt: number | null };
const senderKey = (actor: Principal) => `${actor.kind}:${actor.kind === 'machine' ? actor.machineId : actor.kind === 'task' ? actor.taskId : actor.ownerId}`;
const conflict = () => new HubError(409, 'file_reservation_conflict', '此文件请求已经分配给不同的内容或归属。', '查询原请求，不要更换 requestId 重发未知结果。');

export class FileAccessStore {
    private readonly db;
    constructor(readonly access: AccessStore) { this.db = access.db; }
    private current(row: Reservation | null, allowCancelled = false): Reservation {
        if (!row || (!allowCancelled && row.cancelledAt !== null) || !this.access.member(row.ownerId, row.spaceId)) throw hubNotFound();
        return row;
    }
    /** Trusted coordinator entry, called before asking an assigned Runner to deliver output. */
    permit(input: { machineId: string; ownerId: string; spaceId: string | null; taskId?: string | null;
        requestId: string; filename: string; reference?: z.infer<typeof ArtifactReferenceSchema> }) {
        return this.db.transaction(() => {
            const machine = this.access.object('machine', input.machineId);
            if (!machine || machine.retiredAt !== null || !this.access.member(input.ownerId, input.spaceId)) throw hubNotFound();
            if (input.taskId) {
                const task = this.access.object('task', input.taskId);
                if (!task || task.retiredAt !== null || task.ownerId !== input.ownerId || task.spaceId !== input.spaceId || task.machineId !== input.machineId) throw hubNotFound();
            }
            if (!z.uuid().safeParse(input.requestId).success) throw inputError();
            const sender = `machine:${input.machineId}`;
            const prior = this.db.query('SELECT * FROM hub_file_reservations WHERE sender=? AND requestId=?').get(sender, input.requestId) as Reservation | null;
            const reference = input.reference ? JSON.stringify(ArtifactReferenceSchema.parse(input.reference)) : null;
            if (prior) {
                if (prior.ownerId !== input.ownerId || prior.spaceId !== input.spaceId || prior.taskId !== (input.taskId ?? null)
                    || prior.filename !== input.filename || prior.reference !== reference) throw conflict();
                return this.current(prior);
            }
            const id = randomUUID();
            this.db.query(`INSERT INTO hub_file_reservations (id, sender, requestId, ownerId, spaceId, taskId, machineId, filename, reference)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, sender, input.requestId, input.ownerId, input.spaceId,
                    input.taskId ?? null, input.machineId, input.filename, reference);
            return this.byId(id);
        }).immediate();
    }
    byId(id: string) { return this.current(this.db.query('SELECT * FROM hub_file_reservations WHERE id=?').get(id) as Reservation | null, true); }
    byArtifact(id: string) { return this.current(this.db.query('SELECT * FROM hub_file_reservations WHERE artifactId=?').get(id) as Reservation | null, true); }
    lookup(actor: Principal, requestId: string) {
        this.access.refresh(actor);
        const row = this.current(this.db.query('SELECT * FROM hub_file_reservations WHERE sender=? AND requestId=?').get(senderKey(actor), requestId) as Reservation | null, actor.kind === 'user');
        if (actor.kind === 'user' && actor.spaceId !== null && row.spaceId !== null && actor.spaceId !== row.spaceId) throw hubNotFound();
        return row;
    }
    reserve(actor: Principal, input: unknown) {
        const parsed = ArtifactReserveSchema.safeParse(input); if (!parsed.success) throw inputError();
        const body = parsed.data, hash = fingerprint(body), reference = body.reference ? JSON.stringify(body.reference) : null;
        return this.db.transaction(() => {
            const current = this.access.refresh(actor), sender = senderKey(current);
            let row = this.db.query('SELECT * FROM hub_file_reservations WHERE sender=? AND requestId=?').get(sender, body.requestId) as Reservation | null;
            if (!row) {
                // A machine is never allowed to guess the owner of an output file.
                if (current.kind !== 'user') throw hubNotFound();
                const id = randomUUID();
                this.db.query(`INSERT INTO hub_file_reservations (id, sender, requestId, ownerId, spaceId, filename, reference, fingerprint)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, sender, body.requestId, current.ownerId, current.spaceId, body.filename, reference, hash);
                row = this.byId(id);
            }
            row = this.current(row);
            if (row.filename !== body.filename || row.reference !== reference || (row.fingerprint && row.fingerprint !== hash)
                || (current.kind === 'user' && row.spaceId !== current.spaceId)) throw conflict();
            this.db.query('UPDATE hub_file_reservations SET fingerprint=? WHERE id=?').run(hash, row.id);
            return { reservation: row, body: { ...body, requestId: row.id } };
        }).immediate();
    }
    bind(actor: Principal, id: string, artifactId: string) {
        return this.db.transaction(() => {
            const current = this.access.refresh(actor), row = this.current(this.byId(id), actor.kind === 'user');
            if (row.sender !== senderKey(current) && !(current.kind === 'user' && current.ownerId === row.ownerId && current.spaceId === row.spaceId)) throw hubNotFound();
            if (row.artifactId && row.artifactId !== artifactId) throw conflict();
            this.access.bind({ kind: 'artifact', id: artifactId, ownerId: row.ownerId, spaceId: row.spaceId, taskId: row.taskId, machineId: row.machineId });
            this.db.query('UPDATE hub_file_reservations SET artifactId=? WHERE id=?').run(artifactId, id);
            // Receipt recovery must not resurrect a revoked transfer grant.
            if (!row.artifactId && current.kind !== 'user') { this.access.grant(current.id, artifactId, 'read'); this.access.grant(current.id, artifactId, 'write'); }
            return { ...row, artifactId };
        }).immediate();
    }
}
