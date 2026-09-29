import type { Command } from 'commander';
import { stringify } from 'yaml';
import type { ResolvedConfig } from '../config';
import { RunweftError } from '../errors';
import { agentBindings } from './bindings';
import { AgentClient, offlineAgent } from './client';
import { agentScope, initAgent, listAgents, readAgent, type AgentDocument } from './definitions';

function bindingsText(bindings: ReturnType<typeof agentBindings>) {
    return bindings.length ? `\n  个人绑定（namespace 尚未认证）：${bindings.map(binding => `${binding.namespace} → ${binding.runtimeId}`).join(', ')}` : '';
}
function agentText(agent: AgentDocument) {
    return `${agent.id} · ${agent.definition.name}\n  ${agent.definition.description.trim() || '未填写职责说明'}\n  来源：${agent.source.scope} · ${agent.source.path}`
        + (agent.source.linkTarget ? `\n  链接目标：${agent.source.linkTarget}` : '')
        + (agent.shadowed.length ? `\n  遮蔽：${agent.shadowed.map(item => item.path).join(', ')}` : '')
        + `\n  文件 runtime：${agent.definition.runtime ?? '未指定（可用 agent bind 设置个人目标）'}`;
}
export function addAgentCommands(program: Command, context: () => ResolvedConfig, output: (value: unknown, human: string) => void) {
    const agents = program.command('agent').description('全局/项目 Agent 职责定义；独立于机器和 runtime 登记');
    agents.command('init <id>').description('创建可编辑 YAML；默认 global，已有文件不覆盖')
        .option('--scope <global|project>', '创建作用域', 'global').option('--name <name>', '展示名称').option('--runtime <id>', '文件声明的 runtime；共享项目可留空')
        .action((id, options) => {
            const agent = initAgent(context(), process.cwd(), id, { ...options, scope: agentScope(options.scope) });
            output({ agent }, `已创建：${agent.source.path}\n编辑 description 与 instructions，然后 runweft agent bind ${id} --scope ${agent.source.scope} --runtime <ID>\n检查：runweft agent check ${id} --scope ${agent.source.scope}`);
        });
    agents.command('list').description('列出生效定义与错误；默认离线，不启动服务').option('--check', '在线批量检查目标；每台机器只探测一次').action(async options => {
        if (options.check) {
            const result = await new AgentClient(context(), process.cwd()).list();
            output(result, `连接：${result.connection.name} · namespace：${result.connection.namespace}\n`
                + [...result.agents.map(agent => `${agentText(agent)}\n  选用：${agent.selection?.runtimeId ?? '未绑定'} · ${agent.selection?.source ?? ''}\n  ${agent.error ? `${agent.error.message} ${agent.error.hint ?? ''}` : '目标可选'}`), ...result.errors.map(item => `错误：${item.error.message}`)].join('\n\n')
                + '\n模型认证、参数组合与任务执行：未检查。');
            if (result.errors.length || result.agents.some(agent => agent.error)) process.exitCode = 1;
            return;
        }
        const c = context(), catalog = listAgents(c, process.cwd()), bindings = agentBindings(c);
        const result = { ...catalog, agents: catalog.agents.map(agent => offlineAgent(agent, bindings)) };
        output(result, [...result.agents.map(agent => `${agentText(agent)}${bindingsText(agent.personalBindings)}`), ...result.errors.map(item => `错误：${item.error.message}\n${item.error.hint ?? ''}`)].join('\n\n') || '尚无 Agent 定义。运行 runweft agent init reviewer；项目定义增加 --scope project。');
        if (result.errors.length) process.exitCode = 1;
    });
    agents.command('show <id>').description('离线查看完整定义、来源与遮蔽项').option('--scope <global|project>', '显式查看指定来源')
        .action((id, options) => {
            const c = context(), definition = readAgent(c, process.cwd(), id, agentScope(options.scope));
            const agent = offlineAgent(definition, agentBindings(c, definition.source.key));
            output({ agent }, `${agentText(agent)}${bindingsText(agent.personalBindings)}\n\n${stringify(agent.definition)}\n内容版本：${agent.definitionVersion}`);
        });
    agents.command('validate [id]').description('离线校验定义；runtime 留空仍有效').option('--scope <global|project>', '校验指定 id 的来源')
        .action((id, options) => {
            const scope = agentScope(options.scope);
            if (scope && !id) throw new RunweftError('agent_id_required', '使用 --scope 校验时请指定 Agent 标识。');
            const result = id ? { agents: [readAgent(context(), process.cwd(), id, scope)], errors: [] } : listAgents(context(), process.cwd());
            const valid = result.agents.length > 0 && result.errors.length === 0;
            output({ valid, ...result }, result.errors.length ? result.errors.map(item => `错误：${item.error.message}\n${item.error.hint ?? ''}`).join('\n')
                : result.agents.length ? `定义有效：${result.agents.map(item => item.id).join(', ')}\n未检查执行目标或模型支持；运行 agent check <id> 检查目标。` : '尚无 Agent 定义。运行 runweft agent init <id>。');
            if (!valid) process.exitCode = 1;
        });
    agents.command('check <id>').description('在线解析新任务目标与原生参数；不启动任务').option('--scope <global|project>', '检查指定来源')
        .action(async (id, options) => {
            const agent = await new AgentClient(context(), process.cwd()).resolve(id, agentScope(options.scope));
            output({ agent }, `${agentText(agent)}\n选用 runtime：${agent.target.runtimeId}（${agent.selection.source}）\n目标：${agent.target.machineId} · ${agent.target.flavor}\n连接：${agent.connection.name} · namespace：${agent.connection.namespace}\n原生参数：\n${stringify(agent.launchOptions)}模型认证、参数组合与任务执行：未检查。`);
        });
    agents.command('bind <id>').description('保存本机个人目标；不修改共享定义或注册资源').requiredOption('--runtime <id>', '已知 runtime ID').option('--scope <global|project>', '绑定指定来源；默认生效项')
        .action(async (id, options) => {
            const result = await new AgentClient(context(), process.cwd()).bind(id, options.runtime, agentScope(options.scope));
            const problem = result.runtime.eligibility.reason;
            output(result, `已绑定：${id}（${result.agent.source.scope}） → ${result.binding.runtimeId}\n连接：${result.connection.name} · namespace：${result.connection.namespace}\n${problem ? `目标当前不可选：${problem.message} ${problem.hint ?? ''}` : '目标当前可选；模型认证与任务执行未检查。'}\n共享定义未改写。检查：runweft agent check ${id} --scope ${result.agent.source.scope}`);
        });
    agents.command('unbind <id>').description('解除当前连接/namespace 的个人绑定，回到文件引用').option('--scope <global|project>', '解除指定来源；默认生效项')
        .action(async (id, options) => {
            const result = await new AgentClient(context(), process.cwd()).unbind(id, agentScope(options.scope));
            output(result, `${result.removed ? '已解除个人绑定' : '当前身份没有个人绑定'}：${id}（${result.agent.source.scope}）\n连接：${result.connection.name} · namespace：${result.connection.namespace}\n文件 runtime：${result.declaredRuntime ?? '未指定，需要再次 bind 才能执行'}\n文件引用是否可用请运行 runweft agent check ${id} --scope ${result.agent.source.scope}。`);
        });
}
