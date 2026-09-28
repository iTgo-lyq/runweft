#!/usr/bin/env bun

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const changeDir = process.argv[2] ? resolve(process.argv[2]) : null;

if (!changeDir) {
  console.error("Usage: validate-change.mjs <change-dir>");
  process.exit(2);
}

if (!existsSync(changeDir) || !statSync(changeDir).isDirectory()) {
  console.error(`ERROR: Change directory not found: ${changeDir}`);
  process.exit(1);
}

const errors = [];
const read = (name) => {
  const path = resolve(changeDir, name);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
};
const field = (text, name) => text?.match(new RegExp(`^>\\s*${name}[：:]\\s*(.+?)\\s*$`, "m"))?.[1];

const requirement = read("requirement.md");
const technical = read("technical.md");
const mergeTechnical = read("merge-technical.md");
const plan = read("plan.md");
const execution = read("execution.md");

if (!requirement) {
  console.error("ERROR: requirement.md is required");
  process.exit(1);
}

const size = field(requirement, "规模");
const requirementStatus = field(requirement, "状态");
const validSizes = new Set(["小型", "中型", "大型"]);
const validRequirementStatuses = new Set([
  "草稿",
  "已确认",
  "进行中",
  "待验收",
  "已完成",
  "已取消",
]);

if (!validSizes.has(size)) errors.push(`Invalid or missing Requirement size: ${size ?? "missing"}`);
if (!validRequirementStatuses.has(requirementStatus)) {
  errors.push(`Invalid or missing Requirement status: ${requirementStatus ?? "missing"}`);
}

const technicalStatus = field(technical, "状态");
const validTechnicalStatuses = new Set(["草稿", "待确认", "已确认", "已取消"]);
if (technical && !validTechnicalStatuses.has(technicalStatus)) {
  errors.push(`Invalid or missing Technical status: ${technicalStatus ?? "missing"}`);
}
const mergeTechnicalStatus = field(mergeTechnical, "状态");
if (mergeTechnical && !validTechnicalStatuses.has(mergeTechnicalStatus)) {
  errors.push(
    `Invalid or missing Merge Technical status: ${mergeTechnicalStatus ?? "missing"}`,
  );
}

const planStatus = field(plan, "状态");
const validPlanStatuses = new Set(["待确认", "待执行", "执行中", "已完成", "已取消"]);
if (plan && !validPlanStatuses.has(planStatus)) {
  errors.push(`Invalid or missing Plan status: ${planStatus ?? "missing"}`);
}

const advanced = new Set(["进行中", "待验收", "已完成"]);
if (technical && requirementStatus === "草稿") {
  errors.push("Draft Requirement cannot have technical.md");
}
if (plan && !technical) {
  errors.push("Plan requires technical.md");
}
if (plan && requirementStatus !== "已取消" && technicalStatus !== "已确认") {
  errors.push(`Plan requires confirmed Technical, got ${technicalStatus ?? "missing"}`);
}
if (advanced.has(requirementStatus) && !plan) {
  errors.push(`${size ?? "Unknown-size"} Change in ${requirementStatus} state requires plan.md`);
}
if (advanced.has(requirementStatus) && technicalStatus !== "已确认") {
  errors.push(`${size ?? "Unknown-size"} Change in ${requirementStatus} state requires confirmed Technical`);
}

const taskMatches = plan ? [...plan.matchAll(/^###\s+(T\d+(?:\.\d+)?)\b.*$/gm)] : [];
const taskIds = taskMatches.map((match) => match[1]);
if (new Set(taskIds).size !== taskIds.length) errors.push("Plan contains duplicate task IDs");
if (plan && taskIds.length === 0) {
  errors.push("Plan must contain at least one task heading such as `### T1 ...`");
}

const taskStatuses = taskMatches.map((match, index) => {
  const start = match.index + match[0].length;
  const end = taskMatches[index + 1]?.index ?? plan.length;
  return {
    id: match[1],
    status: plan.slice(start, end).match(/^-\s*状态[：:]\s*(.+?)\s*$/m)?.[1],
  };
});
const validTaskStatuses = new Set(["待开始", "进行中", "已完成", "已阻塞"]);
for (const task of taskStatuses) {
  if (!validTaskStatuses.has(task.status)) {
    errors.push(`${task.id} has invalid or missing status: ${task.status ?? "missing"}`);
  }
}

if (requirementStatus === "进行中" && plan && planStatus !== "执行中") {
  errors.push(`Requirement is 进行中 but Plan is ${planStatus ?? "missing"}`);
}
if ((requirementStatus === "待验收" || requirementStatus === "已完成") && plan) {
  if (planStatus !== "已完成")
    errors.push(`Requirement is ${requirementStatus} but Plan is not 已完成`);
  for (const task of taskStatuses) {
    if (task.status !== "已完成") errors.push(`${task.id} is not completed`);
  }
}
if (requirementStatus === "已取消" && plan && planStatus !== "已取消") {
  errors.push("Cancelled Requirement requires a cancelled Plan");
}
if (requirementStatus === "已取消" && technical && technicalStatus !== "已取消") {
  errors.push("Cancelled Requirement requires a cancelled Technical");
}

if (size === "大型" && advanced.has(requirementStatus) && !execution) {
  errors.push(`Large Change in ${requirementStatus} state requires execution.md`);
}
if (execution) {
  const executionMatches = [...execution.matchAll(/^##\s+(T\d+(?:\.\d+)?)\b.*$/gm)];
  const executionIds = executionMatches.map((match) => match[1]);
  if (new Set(executionIds).size !== executionIds.length) {
    errors.push("Execution contains duplicate task IDs");
  }
  for (const task of taskStatuses) {
    if (task.status === "已完成" && !executionIds.includes(task.id)) {
      errors.push(`execution.md is missing ${task.id}`);
    }
  }
  executionMatches.forEach((match, index) => {
    const start = match.index + match[0].length;
    const end = executionMatches[index + 1]?.index ?? execution.length;
    // 委托执行先记录实现摘要；主 Agent 验收后才补齐 Commit。
    const completed = taskStatuses.some((task) => task.id === match[1] && task.status === "已完成");
    if (completed && !/^-\s*Commit[：:]\s*.+$/m.test(execution.slice(start, end))) {
      errors.push(`${match[1]} execution record is missing Commit`);
    }
  });
}

if (errors.length > 0) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}

console.log(`OK: ${changeDir}`);
