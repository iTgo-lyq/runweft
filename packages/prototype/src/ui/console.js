import { renderResources } from "./resources-page.js";
import { renderAgents } from "./agents-page.js";
import { renderRepositories } from "./repositories-page.js";
import { renderSelections } from "./selections-page.js";
import { renderTasks } from "./tasks-page.js";
export default "";
export const element = (tag, value = "", className = "") => {
  const node = document.createElement(tag);
  node.textContent = value;
  node.className = className;
  return node;
};
export function control(label, operation, context, className = "secondary") {
  const node = element("button", label, className);
  node.type = "button";
  node.addEventListener("click", () => {
    context.action(operation);
  });
  return node;
}
export function field(label, value = "", options = {}) {
  const node = element("label", label);
  const input = options.multiline ? element("textarea") : element("input");
  input.value = value;
  input.required = options.required ?? false;
  if (options.max)
    input.maxLength = options.max;
  node.append(input);
  return { node, input };
}
export function selectField(label, choices, value = "") {
  const node = element("label", label), input = element("select");
  input.setAttribute("aria-label", label);
  choices.forEach((choice) => input.add(new Option(choice.label, choice.value)));
  input.value = value;
  node.append(input);
  return { node, input };
}
export function submitForm(label, fields, operation, context) {
  const form = element("form", "", "resource-form"), submit = element("button", label);
  submit.type = "submit";
  form.append(...fields, submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    context.action(operation);
  });
  return form;
}
export function expandable(title, ...children) {
  const details = element("details");
  details.append(element("summary", title), ...children);
  return details;
}
export function fact(label, value) {
  const node = element("div", "", "fact");
  node.append(element("dt", label), element("dd", String(value ?? "—")));
  return node;
}
export const ownerName = (context, ownerId) => ownerId === context.userId ? "你" : context.members.find((member) => member.userId === ownerId)?.name ?? `已离开或未加入此空间 · ${ownerId}`;
export function resourceCard(name, id, ownerId, context) {
  const card = element("article", "", "resource-card");
  card.dataset.resourceId = id;
  card.append(element("h3", name), element("code", id), element("p", `所属人：${ownerName(context, ownerId)}`, "muted"));
  return card;
}
export function empty(message) {
  return element("p", message, "empty-state");
}
// Prototype writes are in memory; no browser credentials or durable request receipts.
export async function createResource(context, path, payload) {
  return context.request(path, payload, 'POST');
}

let generation = 0;
let active = document.body.dataset.entry === "identity" ? "tasks" : document.body.dataset.entry;
export function clearConsole() {
  generation++;
  const content = document.getElementById("console-content");
  content?.replaceChildren();
  if (content)
    delete content.dataset.loaded;
  document.getElementById("console-navigation")?.replaceChildren();
}
export async function mountConsole(context) {
  const epoch = ++generation;
  const content = document.getElementById("console-content"), navigation = document.getElementById("console-navigation");
  const members = document.getElementById("members-panel");
  const modes = [
    { id: "tasks", label: "任务" },
    { id: "machines", label: "机器" },
    { id: "runtimes", label: "Runtime" },
    { id: "agents", label: "Agent" },
    { id: "repositories", label: "仓库" },
    { id: "selections", label: "我的选择" },
    { id: "members", label: "成员" }
  ];
  async function render(preserve = false) {
    if (epoch !== generation)
      return;
    const retain = preserve && content.dataset.loaded === "true";
    if (!retain) {
      content.replaceChildren();
      delete content.dataset.loaded;
    }
    members.hidden = active !== "members";
    content.hidden = active === "members";
    navigation.querySelectorAll("button").forEach((button) => button.setAttribute("aria-current", button.dataset.view === active ? "page" : "false"));
    if (active === "members")
      return;
    if (!content.childNodes.length)
      content.append(element("p", "正在读取当前权限与资源…", "muted"));
    const target = element("div");
    try {
      if (active === "tasks")
        await renderTasks(target, context);
      else if (active === "agents")
        await renderAgents(target, context, render);
      else if (active === "repositories")
        await renderRepositories(target, context, render);
      else if (active === "selections")
        await renderSelections(target, context, render);
      else
        await renderResources(target, context, active === "runtimes" ? "runtimes" : "machines", render);
      if (epoch === generation) {
        content.replaceChildren(target);
        content.dataset.loaded = "true";
      }
    } catch (error) {
      if (epoch !== generation)
        return;
      if (!retain)
        content.replaceChildren(empty("资源未能加载。检查 Hub 连接后刷新；不会切换身份或本地配置。"));
      throw error;
    }
  }
  navigation.replaceChildren(...modes.map((mode) => {
    const button = control(mode.label, async () => {
      active = mode.id;
      location.hash = mode.id;
      await render();
    }, context);
    button.dataset.view = mode.id;
    return button;
  }));
  const guide = document.getElementById("agent-onboarding");
  guide.textContent = "演示接入流程：登记机器 → 登记 Runtime → 配置 Agent → 委派任务。此原型不连接真实服务。";
  await render(true);
}
