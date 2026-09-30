import type { Checkout, Repository } from './repositories/store';
import { control, createResource, element, empty, expandable, fact, field, resourceCard, submitForm, type ConsoleContext } from './console.js';

export default '';
export async function renderRepositories(target: HTMLElement, context: ConsoleContext, refresh: () => Promise<void>) {
    const [{ repositories }, { checkouts }]: [{ repositories: Repository[] }, { checkouts: Checkout[] }] =
        await Promise.all([context.request('/repositories'), context.request('/checkouts')]);
    target.append(element('h3', '仓库 · 同一个项目，各自的选择'), element('p', '仓库目录属于空间。别名只用于识别 Git 项目，不保存 Git 凭据；同一仓库的 Agent 选择与 checkout 关联各自独立。', 'muted'));
    const name = field('仓库名称', '', { required: true, max: 80 });
    const aliases = field('Git remote 别名（每行一个，可选）', '', { multiline: true });
    target.append(expandable('登记仓库', submitForm('登记仓库', [name.node, aliases.node], async () => {
        await createResource(context, '/repositories', { name: name.input.value, aliases: aliases.input.value.split('\n').map(value => value.trim()).filter(Boolean) });
        await refresh(); context.notice('仓库已登记。让工作区内的 Agent 观察 Git 并绑定 checkout。');
    }, context)));
    const mutate = async (path: string, body: unknown, method: string) => {
        await context.request(path, body, method); await refresh(); context.notice('仓库目录已更新。个人选择不会自动改变。');
    };
    const list = element('div', '', 'resource-list');
    for (const repository of repositories) {
        const path = `/repositories/${repository.id}`, card = resourceCard(repository.name, repository.id, repository.ownerId, context);
        card.append(element('p', repository.registered ? '已登记' : '已取消登记 · 不接受新解析', 'muted'));
        const aliasList = element('ul', '', 'alias-list');
        for (const alias of repository.aliases) {
            const item = element('li'); item.append(element('code', alias.displayUrl));
            if (repository.permissions.manage) item.append(control('移除别名', async () => {
                if (!await context.confirm(`移除 ${alias.displayUrl} 的仓库识别关联？不会修改任何 Git remote。`)) return;
                await mutate(path + '/aliases', { canonicalKey: alias.canonicalKey }, 'DELETE');
            }, context, 'quiet'));
            aliasList.append(item);
        }
        card.append(aliasList);
        if (!repository.aliases.length) card.append(element('p', '没有远程别名；可由 Agent 在本机显式绑定 Git checkout。', 'hint'));
        if (repository.permissions.manage) {
            const rename = field('新的仓库名称', repository.name, { required: true, max: 80 });
            const alias = field('添加 Git remote 别名', '', { required: true });
            card.append(expandable('修改仓库目录',
                submitForm('保存仓库名称', [rename.node], () => mutate(path, { name: rename.input.value }, 'PATCH'), context),
                submitForm('添加别名', [alias.node], () => mutate(path + '/aliases', { alias: alias.input.value }, 'PUT'), context)));
            card.append(control(repository.registered ? '取消仓库登记' : '恢复仓库登记', async () => {
                if (!await context.confirm('只改变仓库配置目录的登记状态，不删除 Git 文件、Agent 或个人选择。继续？')) return;
                await mutate(path + (repository.registered ? '' : '/register'), {}, repository.registered ? 'DELETE' : 'POST');
            }, context));
        }
        list.append(card);
    }
    target.append(list);
    if (!repositories.length) target.append(empty('还没有仓库。非 Git 工作区可以直接使用空间级 Agent；Git 项目可先登记中心仓库。'));
    const bindings = element('section', '', 'checkout-list');
    bindings.append(element('h3', '我的 checkout 关联'), element('p', '以下是你的机器上已观察并确认的 Git 关联。新增、重绑或解除由对应机器的 Agent 执行，不在浏览器猜测本地路径。', 'hint'));
    for (const checkout of checkouts) {
        const facts = element('dl', '', 'facts');
        facts.append(fact('中心仓库', repositories.find(item => item.id === checkout.repositoryId)?.name ?? checkout.repositoryId),
            fact('机器', checkout.machineId), fact('工作目录', checkout.cwd), fact('Git 公共目录', checkout.gitCommonDir));
        bindings.append(facts);
    }
    if (!checkouts.length) bindings.append(empty('你还没有显式 checkout 关联。让 Agent 在项目中执行 repository inspect，再按本机 ID 执行 repository match 或 bind；不要创建 Runweft YAML。'));
    target.append(bindings);
}
