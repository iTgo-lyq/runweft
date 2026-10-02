import { z } from 'zod';
import { AgentAvailabilityEntrySchema, AgentAvailabilityDetailsSchema, MACHINE_DISPLAY_NAME_MAX_LENGTH } from '../../hapi/shared/src/apiTypes';
import { RunweftError } from '../errors';

export const FlavorSchema = z.enum(['codex', 'claude']);
export type Flavor = z.infer<typeof FlavorSchema>;
export const flavors: Flavor[] = ['codex', 'claude'];
export const NameSchema = z.string().trim().min(1).max(MACHINE_DISPLAY_NAME_MAX_LENGTH);
export const RenameInput = z.object({ name: NameSchema }).strict();

export const InspectionSchema = AgentAvailabilityEntrySchema.extend({ agent: FlavorSchema, details: AgentAvailabilityDetailsSchema });
export type Inspection = z.infer<typeof InspectionSchema>;
export type Problem = { code: string; message: string; hint?: string };
export type Eligibility = { eligible: boolean; reason: Problem | null };
export type Discovery = { tools: {
    flavor: Flavor; inspection: Inspection; toolFound: boolean; problem: Problem | null;
    modelAuthentication: 'not_checked'; execution: 'not_checked';
}[] };
export type HapiRequester = (path: string, options?: RequestInit) => Promise<any>;

export class ResourceError extends RunweftError {
    constructor(readonly status: number, code: string, message: string, hint?: string) { super(code, message, hint); }
}

export function invalidInput(message = '资源参数无效。') {
    return new ResourceError(400, 'invalid_resource_request', message, `检查机器 ID 和 runtime 类型；名称不能为空且最多 ${MACHINE_DISPLAY_NAME_MAX_LENGTH} 个字符，执行目标不能通过重命名改绑。`);
}
export function eligibility(reason: Problem | null): Eligibility { return { eligible: reason === null, reason }; }
export function rejectProblem(problem: Problem): never {
    const status = problem.code.endsWith('_unknown') ? 404 : problem.code === 'runtime_probe_failed' ? 502 : 409;
    throw new ResourceError(status, problem.code, problem.message, problem.hint);
}

export function inspectionProblem(inspection: Inspection): Problem | null {
    const hint = '检查目标 Runner 启动时的 PATH、原生 home 和命令覆盖；修改环境后运行 runweft restart。';
    if (inspection.reason === 'invalid_configuration') return { code: 'runtime_invalid_configuration', message: 'HAPI 的原生工具配置无效。', hint };
    if (!inspection.available || !inspection.details.executable) return { code: 'runtime_command_missing', message: '目标 Runner 未发现可启动的原生命令。', hint };
    return null;
}
