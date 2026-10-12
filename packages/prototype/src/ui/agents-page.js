import { control, createResource, element, empty, expandable, fact, field, resourceCard, selectField, submitForm } from "./console.js";
export default "";
export function repositoryChoices(repositories, current = null) {
  const choices = [{ value: "", label: "整个空间" }, ...repositories.filter((item) => item.registered || item.id === current).map((item) => ({ value: item.id, label: `${item.name}${item.registered ? "" : " · 已取消登记"}` }))];
  if (current && !choices.some((item) => item.value === current))
    choices.push({ value: current, label: `原仓库不可见 · ${current}` });
  return choices;
}
export function runtimeChoices(runtimes, current = null) {
  const choices = [{ value: "", label: "不指定，使用选择层或定义" }, ...runtimes.filter((item) => item.permissions.use || item.id === current).map((item) => ({ value: item.id, label: `${item.name} · ${item.flavor}${item.eligibility.eligible ? "" : " · " + (item.eligibility.reason?.message ?? "不可用")}` }))];
  if (current && !choices.some((item) => item.value === current))
    choices.push({ value: current, label: `原 Runtime 不可见 · ${current}` });
  return choices;
}
function definitionForm(definition, repositories, runtimes, label, context, save) {
  const name = field("Agent 名称", definition.name, { required: true, max: 80 });
  const description = field("用途说明", definition.description, { multiline: true, max: 4096 });
  const instructions = field("业务指令", definition.instructions, { multiline: true, max: 32768 });
  const repository = selectField("作用仓库", repositoryChoices(repositories, definition.repositoryId), definition.repositoryId ?? "");
  const runtime = selectField("定义中的 Runtime", runtimeChoices(runtimes, definition.runtimeId), definition.runtimeId ?? "");
  const flavor = selectField("原生类型", [{ value: "", label: "由执行目标决定" }, { value: "codex", label: "Codex" }, { value: "claude", label: "Claude Code" }], definition.flavor ?? "");
  const model = field("模型（可选）", definition.model ?? "", { max: 256 });
  const effort = field("推理等级（可选）", definition.reasoningEffort ?? "", { max: 256 });
  return submitForm(label, [name.node, repository.node, runtime.node, flavor.node, model.node, effort.node, description.node, instructions.node], () => save({
    name: name.input.value,
    description: description.input.value,
    instructions: instructions.input.value,
    repositoryId: repository.input.value || null,
    runtimeId: runtime.input.value || null,
    flavor: flavor.input.value || null,
    model: model.input.value || null,
    reasoningEffort: effort.input.value || null
  }), context);
}
export async function renderAgents(target, context, refresh) {
  const [{ agents }, { repositories }, { runtimes }] = await Promise.all([context.request("/agents"), context.request("/repositories"), context.request("/resources/runtimes")]);
  target.append(element("h3", "Agent · 指令、配置与版本"), element("p", "私有定义只属于你。共享仅开放当前定义与使用权，不开放修改权、历史版本或历史任务；Runtime 的执行权仍需单独取得。", "muted"));
  const initial = { name: "", description: "", instructions: "", repositoryId: null, runtimeId: null, flavor: null, model: null, reasoningEffort: null };
  target.append(expandable("创建 Agent", definitionForm(initial, repositories, runtimes, "创建 Agent", context, async (definition) => {
    await createResource(context, "/agents", { definition });
    await refresh();
    context.notice("Agent 已创建，默认仅你可见。");
  })));
  const mutate = async (path, body, method, message) => {
    await context.request(path, body, method);
    await refresh();
    context.notice(message);
  };
  const list = element("div", "", "resource-list");
  for (const agent of agents) {
    const path = `/agents/${agent.id}`, card = resourceCard(agent.name, agent.id, agent.ownerId, context);
    card.append(element("p", `${agent.repositoryId ? repositories.find((item) => item.id === agent.repositoryId)?.name ?? agent.repositoryId : "整个空间"} → Agent v${agent.version}`, "relation"));
    const facts = element("dl", "", "facts");
    facts.append(fact("分享", { private: "私有", members: "指定成员", space: "空间成员" }[agent.accessMode]), fact("登记", agent.registered ? "已登记" : "已取消"), fact("治理", agent.blocked ? "已停用" : "未停用"), fact("所属人", agent.ownerPresent ? "仍在空间" : "已离开空间"));
    card.append(facts);
    if (!agent.permissions.invoke)
      card.append(element("p", "当前定义不可调用。核对登记、所属成员和治理状态；仓库与 Runtime 可用性在“我的选择”中解析。", "hint"));
    if (agent.view === "definition") {
      card.append(expandable("查看当前定义", element("pre", JSON.stringify(agent.definition, null, 2), "inspection-output"), element("code", agent.contentHash)));
      if (agent.permissions.edit)
        card.append(expandable(`编辑定义 · v${agent.version}`, definitionForm(agent.definition, repositories, runtimes, "保存新版本", context, (definition) => mutate(path, { expectedVersion: agent.version, definition }, "PATCH", "新版本已保存。已有任务继续使用接受时的快照；新轮次重新核对。"))));
    } else
      card.append(element("p", "仅可查看治理概要；管理员不取得此私有定义、模型参数或指令。", "hint"));
    const actions = element("div", "", "actions");
    if (agent.permissions.edit)
      actions.append(control(agent.registered ? "取消 Agent 登记" : "恢复 Agent 登记", async () => {
        if (!await context.confirm(agent.registered ? "取消后不再接受新调用，历史版本和任务仍保留。继续？" : "恢复此 Agent 登记？"))
          return;
        await mutate(path + (agent.registered ? "" : "/register"), {}, agent.registered ? "DELETE" : "POST", "Agent 登记已更新。");
      }, context));
    if (agent.permissions.share) {
      const mode = selectField("分享范围", [{ value: "private", label: "私有" }, { value: "members", label: "指定成员" }, { value: "space", label: "全部空间成员" }], agent.accessMode);
      const members = element("fieldset", "", "member-choices");
      members.append(element("legend", "选择空间成员"));
      const checked = [];
      for (const member of context.members.filter((item) => item.userId !== context.userId)) {
        const label = element("label"), input = element("input");
        input.type = "checkbox";
        input.value = member.userId;
        input.checked = agent.view === "definition" && !!agent.memberIds?.includes(member.userId);
        label.append(input, element("span", `${member.name} · ${member.userId}`));
        members.append(label);
        checked.push(input);
      }
      const updateVisibility = () => {
        members.hidden = mode.input.value !== "members";
      };
      mode.input.addEventListener("change", updateVisibility);
      updateVisibility();
      card.append(expandable("管理 Agent 分享", submitForm("保存分享范围", [mode.node, members], async () => {
        if (!await context.confirm("变更定义的读取与调用范围，不分享历史任务；撤回会使对应调用失效。继续？"))
          return;
        await mutate(path + "/access", { mode: mode.input.value, memberIds: mode.input.value === "members" ? checked.filter((input) => input.checked).map((input) => input.value) : [] }, "PUT", "Agent 分享已更新。");
      }, context)));
    }
    if (agent.permissions.history)
      actions.append(control("查看版本历史", async () => {
        const versions = (await context.request(path + "/versions")).versions;
        card.querySelector(".version-history")?.remove();
        const history = element("div", "", "version-history");
        for (const version of [...versions].reverse())
          history.append(expandable(`v${version.version} · ${new Date(version.createdAt).toLocaleString("zh-CN")}`, element("code", version.contentHash), element("pre", JSON.stringify(version.definition, null, 2), "inspection-output")));
        card.append(history);
      }, context));
    if (agent.permissions.govern)
      actions.append(control(agent.blocked ? "解除 Agent 停用" : "在空间停用 Agent", async () => {
        if (!await context.confirm("只变更本空间治理状态，不取得定义编辑权或执行内容。继续？"))
          return;
        await mutate(path + "/block", {}, agent.blocked ? "DELETE" : "PUT", "Agent 治理状态已更新。");
      }, context, "quiet"));
    card.append(actions);
    list.append(card);
  }
  target.append(list);
  if (!agents.length)
    target.append(empty("还没有可见 Agent。创建你自己的定义，或请所有者向你分享。"));
}
