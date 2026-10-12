#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { TASK_TYPES } = require("../lib/task-router");

const ROOT = path.resolve(__dirname, "..");
const START = "<!-- wl-bd-task-types:begin -->";
const END = "<!-- wl-bd-task-types:end -->";
const DOCS = ["README.md", "files/.github/standards/26-task-driven.md", "files/.github/skills/_registry.md"];

function taskTable(tasks = TASK_TYPES) {
  const items = Object.values(tasks);
  const cell = (value) => String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const lines = [START, `当前 **${items.length} 种任务类型**（从 task-router 与规则 catalog 生成）：`, "", "| 任务类型 | 名称 | 模式 | 典型触发词 | 计划规则/质量门 | 原工具 |", "|---|---|---|---|---|---|"];
  for (const task of items) {
    const checks = [...task.rules, ...task.javaGates].join("/") || "见 task 回执 requiredChecks";
    lines.push(`| ${[task.id, task.name, task.mode, task.triggers.slice(0, 3).join("/"), checks, task.tools.join("/")].map(cell).join(" | ")} |`);
  }
  lines.push("", "表格表示判定与计划，具体范围、资产缺口、待补输入和实际验证状态以 task/status 回执为准。反向业务文档抽取目前只有骨架指导，缺少语义执行器时明确报告 gap。", END);
  return lines.join("\n");
}

function syncTaskDocs({ write = false, read = fs.readFileSync, save = fs.writeFileSync } = {}) {
  const expected = taskTable();
  const errors = [];
  for (const relative of DOCS) {
    const file = path.join(ROOT, relative);
    const content = read(file, "utf8");
    const start = content.indexOf(START);
    const end = content.indexOf(END);
    if (start < 0 || end < start || content.indexOf(START, start + START.length) >= 0 || content.indexOf(END, end + END.length) >= 0) {
      errors.push(`${relative} 缺少或重复任务目录标记`);
      continue;
    }
    const after = end + END.length;
    if (content.slice(start, after) === expected) continue;
    if (write) save(file, content.slice(0, start) + expected + content.slice(after));
    else errors.push(`${relative} 任务目录与 TASK_TYPES/catalog 不一致；运行 node scripts/sync-task-docs.js --write`);
  }
  return errors;
}

if (require.main === module) {
  const errors = syncTaskDocs({ write: process.argv.includes("--write") });
  if (errors.length) { errors.forEach((error) => console.error(`task-doc-sync: ${error}`)); process.exitCode = 1; }
  else console.log(`task docs verified: ${Object.keys(TASK_TYPES).length} task types`);
}

module.exports = { taskTable, syncTaskDocs, DOCS };
