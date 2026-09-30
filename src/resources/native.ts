import { z } from 'zod';
import { MachineSchema } from '../../hapi/shared/src/schemas';
import { AgentAvailabilityResponseSchema } from '../../hapi/shared/src/apiTypes';
import { HapiRequestError } from '../hapi';
import { ResourceError, InspectionSchema, flavors, type Inspection, type HapiRequester } from './types';

const InventorySchema = z.object({ machines: z.array(MachineSchema) });
/** Native inventory is shared by the legacy namespace registry and the new Hub ownership layer. */
export async function nativeMachines(hapi: HapiRequester, namespace: string, signal?: AbortSignal) {
    const health = await hapi('/health', { signal });
    if (health?.capabilities?.machineInventory !== 1) throw new ResourceError(409, 'resource_capability_missing', 'HAPI 不支持完整机器库存。', '更新配套 Runweft Hub。');
    const result = InventorySchema.safeParse(await hapi('/api/machines?includeOffline=true', { signal }));
    if (!result.success || result.data.machines.some(machine => machine.namespace !== namespace)) {
        throw new ResourceError(502, 'invalid_hapi_response', 'HAPI 返回的机器库存或作用域无效。', '运行 runweft doctor 检查配套版本。');
    }
    return result.data.machines;
}

/** Probe facts come from the existing HAPI adapter; this layer adds no launcher or version rules. */
export async function nativeInspections(hapi: HapiRequester, machineId: string, signal?: AbortSignal): Promise<Inspection[]> {
    let inspections: Inspection[];
    try {
        const raw = await hapi(`/api/machines/${encodeURIComponent(machineId)}/agent-availability?details=true`, { signal });
        const parsed = AgentAvailabilityResponseSchema.safeParse(raw);
        if (!parsed.success) throw new Error('invalid availability response');
        inspections = flavors.map(flavor => {
            const entries = parsed.data.agents.filter(entry => entry.agent === flavor);
            if (entries.length !== 1) throw new Error('missing or repeated runtime detail');
            return InspectionSchema.parse(entries[0]);
        });
    } catch (error) {
        if (error instanceof HapiRequestError) {
            if ([401, 403].includes(error.status)) throw error;
            if (error.code === 'runner_upgrade_required') throw new ResourceError(409, error.code, '目标 Runner 不支持原生工具详情。', '在目标机器更新 Runweft 并运行 runweft restart。');
            if (error.code === 'machine_offline') throw new ResourceError(409, error.code, '目标机器已离线。', '在目标机器运行 runweft start。');
        }
        throw new ResourceError(502, 'runtime_probe_failed', '无法取得目标 Runner 的原生工具详情。', '检查目标机器连接和 Runner 日志，再运行 runweft runtime check；未启动或重发任务。');
    }
    return inspections;
}
