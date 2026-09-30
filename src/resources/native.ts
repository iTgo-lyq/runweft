import { z } from 'zod';
import { MachineSchema } from '../../hapi/shared/src/schemas';
import { ResourceError, type HapiRequester } from './types';

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
