import type { Command } from 'commander';
import { stringify } from 'yaml';
import type { ResolvedConfig } from '../config';
import { RunweftError } from '../errors';
import { agentScope, initAgent, listAgents, readAgent, type AgentDocument } from './definitions';

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
            output({ agent }, `已创建：${agent.source.path}\n编辑 description 与 instructions，然后 runweft agent bind ${id} --runtime <ID>\n检查：runweft agent check ${id}`);
        });
    agents.command('list').description('离线列出生效定义与错误；不启动服务').action(() => {
        const result = listAgents(context(), process.cwd());
        output(result, [...result.agents.map(agentText), ...result.errors.map(item => `错误：${item.error.message}\n${item.error.hint ?? ''}`)].join('\n\n') || '尚无 Agent 定义。运行 runweft agent init reviewer；项目定义增加 --scope project。');
        if (result.errors.length) process.exitCode = 1;
    });
    agents.command('show <id>').description('离线查看完整定义、来源与遮蔽项').option('--scope <global|project>', '显式查看指定来源')
        .action((id, options) => {
            const agent = readAgent(context(), process.cwd(), id, agentScope(options.scope));
            output({ agent }, `${agentText(agent)}\n\n${stringify(agent.definition)}\n内容版本：${agent.definitionVersion}`);
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
}
