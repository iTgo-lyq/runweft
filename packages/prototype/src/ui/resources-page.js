import { control, element, empty, expandable, fact, field, resourceCard, selectField, submitForm } from "./console.js";
export default "";
export async function renderResources(target, context, kind, refresh) {
  const resourcePath = "/resources";
  const machines = (await context.request(resourcePath + "/machines")).machines;
  const scope = context.spaceId;
  target.append(element("h3", kind === "machines" ? "机器 · 执行发生的地方" : "Runtime · 机器上的原生工具"));
  target.append(element("p", kind === "machines" ? "机器是 Hub 全局资源。关联空间不分享执行权；需要单独登记并共享 Runtime。首次接入与凭据轮换由该机器上的 Agent 完成。" : "Codex 与 Claude Code 分别登记。共享会消耗执行机器的模型额度，不提供 OS 隔离，也不公开你的历史任务。", "muted"));
  const mutate = async (path, body, method, warning) => {
    if (warning && !await context.confirm(warning))
      return;
    await context.request(path, body, method);
    await refresh();
    context.notice("资源设置已更新。");
  };
  if (kind === "machines") {
    const list = element("div", "", "resource-list");
    for (const machine of machines) {
      const path = `${resourcePath}/machines/${machine.id}`;
      const card = resourceCard(machine.name, machine.id, machine.ownerId, context);
      const facts = element("dl", "", "facts");
      facts.append(fact("连接", { pending: "尚未首次连接", online: "在线", offline: "离线" }[machine.connection]), fact("登记", machine.registered ? "已登记" : "已取消"), fact("本空间治理", machine.blockedInSpace ? "已停用" : "未停用"), fact("最后活动", machine.lastActiveAt ? new Date(machine.lastActiveAt).toLocaleString("zh-CN") : "暂无观察"));
      card.append(facts);
      const actions = element("div", "", "actions");
      if (machine.permissions.manage) {
        const name = field("机器名称", machine.name, { required: true, max: 64 });
        card.append(expandable("修改机器名称", submitForm("保存机器名称", [name.node], () => mutate(path, { name: name.input.value }, "PATCH"), context)));
        actions.append(control(machine.registered ? "取消机器登记" : "恢复机器登记", () => mutate(path + (machine.registered ? "" : "/register"), {}, machine.registered ? "DELETE" : "POST", machine.registered ? "取消登记将阻止新的执行；不会删除会话或工作区。" : undefined), context));
        actions.append(control("查看凭据状态", async () => {
          const result = await context.request(path + "/credential");
          context.notice(`机器凭据：${result.credential.status} · ${result.credential.id}。轮换请让本机 Agent 执行 machine rotate-credential。`);
        }, context));
        actions.append(control("撤销机器凭据", () => mutate(path + "/credential", {}, "DELETE", "撤销后 Runner 无法继续连接。需要在该机器显式轮换凭据并重启。继续？"), context, "quiet"));
        actions.append(control("探测原生工具", async () => {
          const result = await context.request(path + "/discover", undefined, "GET", true);
          const output = element("pre", JSON.stringify(result, null, 2), "inspection-output");
          card.querySelector(".inspection-output")?.remove();
          card.append(output);
        }, context));
      }
      if (machine.permissions.associate) {
        const spaces = element("div", "", "space-grants");
        for (const space of context.spaces) {
          const associated = machine.spaceIds?.includes(space.id);
          spaces.append(control(`${associated ? "撤回关联" : "关联到"} · ${space.name}`, () => mutate(`${path}/spaces/${space.id}`, {}, associated ? "DELETE" : "PUT", associated ? "撤回关联也会撤销此空间的 Runtime 分享；重新关联不会自动恢复分享。" : undefined), context));
        }
        card.append(expandable("空间关联", spaces));
      }
      if (machine.permissions.govern)
        actions.append(control(machine.blockedInSpace ? "解除空间停用" : "在空间停用", () => mutate(`${resourcePath}/spaces/${scope}/blocks/machine/${machine.id}`, {}, machine.blockedInSpace ? "DELETE" : "PUT", "此操作只影响当前空间，不改变所有权、内容或其他空间。"), context, "quiet"));
      card.append(actions);
      list.append(card);
    }
    target.append(list);
    if (!machines.length)
      target.append(empty("还没有可见机器。把上方接入说明交给运行在目标机器上的 Agent，由它完成独立登记和 Runner 启动。"));
    return;
  }
  const runtimes = (await context.request(resourcePath + "/runtimes")).runtimes;
  const ownMachines = machines.filter((machine) => machine.permissions.manage);
  if (ownMachines.length) {
    const machine = selectField("执行机器", ownMachines.map((item) => ({ value: item.id, label: `${item.name} · ${item.connection}` })), ownMachines[0].id);
    const flavor = selectField("原生工具", [{ value: "codex", label: "Codex" }, { value: "claude", label: "Claude Code" }], "codex");
    const name = field("Runtime 名称（可选）", "", { max: 64 });
    target.append(expandable("登记 Runtime", submitForm("登记 Runtime", [machine.node, flavor.node, name.node], async () => {
      await mutate(resourcePath + "/runtimes", { machineId: machine.input.value, flavor: flavor.input.value, ...name.input.value ? { name: name.input.value } : {} }, "POST");
    }, context)));
  }
  const list = element("div", "", "resource-list");
  for (const runtime of runtimes) {
    const path = `${resourcePath}/runtimes/${runtime.id}`;
    const card = resourceCard(runtime.name, runtime.id, runtime.ownerId, context);
    card.append(element("p", `${machines.find((machine) => machine.id === runtime.machineId)?.name ?? runtime.machineId} → ${runtime.flavor}`, "relation"));
    const facts = element("dl", "", "facts");
    facts.append(fact("登记", runtime.registered ? "已登记" : "已取消"), fact("当前空间", runtime.shared ? "已共享" : "私有"), fact("工具版本", runtime.version ?? "尚未确认"), fact("观察", runtime.inspectionCurrent ? "当前探测" : "历史或尚未检查"), fact("模型认证 / 执行", "未检查"), fact("可用性", runtime.eligibility.eligible ? "当前可选" : runtime.eligibility.reason?.message ?? "不可选"));
    if (runtime.eligibility.reason?.hint)
      card.append(element("p", runtime.eligibility.reason.hint, "hint"));
    card.append(facts);
    const actions = element("div", "", "actions");
    if (runtime.permissions.use || runtime.permissions.manage)
      actions.append(control("检查 Runtime", async () => {
        const result = await context.request(path + "/check", undefined, "GET", runtime.permissions.manage);
        context.notice(`工具发现：${result.runtime.toolFound ? "是" : "否"}；版本：${result.runtime.version ?? "未知"}。模型认证与真实执行仍未检查。`);
      }, context));
    if (runtime.permissions.manage) {
      const name = field("Runtime 名称", runtime.name, { required: true, max: 64 });
      card.append(expandable("修改 Runtime 名称", submitForm("保存 Runtime 名称", [name.node], () => mutate(path, { name: name.input.value }, "PATCH"), context)));
      actions.append(control(runtime.registered ? "取消 Runtime 登记" : "恢复 Runtime 登记", () => runtime.registered ? mutate(path, {}, "DELETE", "取消登记会阻止新任务选用，不删除原生历史。") : mutate(resourcePath + "/runtimes", { machineId: runtime.machineId, flavor: runtime.flavor }, "POST"), context));
    }
    if (runtime.permissions.share) {
      const grants = element("div", "", "space-grants");
      for (const space of context.spaces) {
        const shared = runtime.shareSpaceIds?.includes(space.id);
        grants.append(control(`${shared ? "撤回共享" : "共享到"} · ${space.name}`, () => mutate(`${path}/spaces/${space.id}`, {}, shared ? "DELETE" : "PUT", shared ? "撤回共享会阻止新轮次，运行任务由协调器核对并停止；停止未确认时保留未知状态。" : "允许此空间成员消耗该 Runtime 的机器与模型资源？这不提供 OS 隔离。"), context));
      }
      card.append(expandable("管理 Runtime 分享", grants));
    }
    if (runtime.permissions.govern)
      actions.append(control(runtime.blockedInSpace ? "解除 Runtime 停用" : "在空间停用 Runtime", () => mutate(`${resourcePath}/spaces/${scope}/blocks/runtime/${runtime.id}`, {}, runtime.blockedInSpace ? "DELETE" : "PUT", "只变更当前空间的治理状态，不取得他人配置或任务内容。"), context, "quiet"));
    card.append(actions);
    list.append(card);
  }
  target.append(list);
  if (!runtimes.length)
    target.append(empty("还没有可见 Runtime。先连接机器并安装原生 Codex 或 Claude Code，再分别登记。"));
}
