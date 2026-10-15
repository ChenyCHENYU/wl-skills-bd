"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { TASK_TYPES, TASK_IDS } = require("../lib/task-router");
const { taskTable, syncTaskDocs, DOCS } = require("../scripts/sync-task-docs");

test("BD CLI 帮助与当前任务目录同源，完整列出真实类型", () => {
  const result = spawnSync(process.execPath, [path.resolve(__dirname, "../bin/wl-skills-bd.js"), "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`列出 ${TASK_IDS.length} 种任务类型`));
  assert.ok(result.stdout.includes(`任务类型：${TASK_IDS.join(" / ")}`));
  assert.ok(result.stdout.includes("尚未执行业务动作"));
});

test("任务增量自动进入规范与 Skill 目录，当前文档逐字节对齐", () => {
  assert.deepEqual(syncTaskDocs(), []);
  const future = { ...TASK_TYPES, future: { id: "future", name: "未来任务", mode: "readonly", triggers: ["未来触发"], rules: ["B12"], javaGates: ["J2"], tools: ["validate"] } };
  const text = taskTable(future);
  assert.ok(text.includes(`${TASK_IDS.length + 1} 种任务类型`));
  assert.ok(text.includes("| future | 未来任务 | readonly | 未来触发 | B12/J2 | validate |"));
  for (const id of TASK_IDS) assert.ok(text.includes(`| ${id} |`));
});

test("文档漂移与重复标记被门禁拒绝，检查不写入源文档", () => {
  let writes = 0;
  const save = () => { writes += 1; };
  const expected = taskTable();
  const stale = syncTaskDocs({ read: () => expected.replace(`${TASK_IDS.length} 种任务类型`, `${TASK_IDS.length - 1} 种任务类型`), save });
  assert.equal(stale.length, DOCS.length);
  assert.ok(stale.every((message) => message.includes("与 TASK_TYPES/catalog 不一致")));
  const duplicate = syncTaskDocs({ read: () => expected + "\n" + expected, save });
  assert.equal(duplicate.length, DOCS.length);
  assert.ok(duplicate.every((message) => message.includes("重复任务目录标记")));
  assert.equal(writes, 0);
});
