"use strict";

const test = require("node:test");
const assert = require("assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { protocol, runOperation } = require("../lib/protocol-cli");

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-evidence-"));
}

test("status 严格回查同一 runId：字段精确、不兜底", () => {
  const root = tempRoot();
  const planned = protocol.request({ operation: "task", projectRoot: root, task: "审计后端规则", runId: "evidence-run-a" }, runOperation);
  assert.equal(planned.ok, true);
  assert.equal(planned.result.runId, "evidence-run-a");
  assert.equal(planned.result.executionStatus, "not-executed");
  const status = protocol.request({ operation: "status", projectRoot: root, runId: "evidence-run-a" }, runOperation);
  assert.equal(status.result.runId, "evidence-run-a");
  assert.equal(status.result.executionStatus, "not-executed");
});

test("混用 runId 不得串记录", () => {
  const root = tempRoot();
  protocol.request({ operation: "task", projectRoot: root, task: "任务A审计后端规则", runId: "evidence-run-a" }, runOperation);
  protocol.request({ operation: "task", projectRoot: root, task: "任务B审计后端规则", runId: "evidence-run-b" }, runOperation);
  const statusB = protocol.request({ operation: "status", projectRoot: root, runId: "evidence-run-b" }, runOperation);
  assert.equal(statusB.result.runId, "evidence-run-b");
  assert.equal(JSON.stringify(statusB.result).includes("任务A"), false);
});

test("不存在的 runId 不得伪造成功记录", () => {
  const root = tempRoot();
  const status = protocol.request({ operation: "status", projectRoot: root, runId: "no-such-run" }, runOperation);
  const serialized = JSON.stringify(status.result);
  assert.equal(serialized.includes('"validationStatus":"passed"'), false);
  assert.equal(serialized.includes('"executionStatus":"completed"'), false);
});

test("空检查集不得判定为通过", () => {
  const root = tempRoot();
  const planned = protocol.request({ operation: "task", projectRoot: root, task: "审计后端规则", runId: "empty-run" }, runOperation);
  assert.notEqual(planned.result.validationStatus, "passed");
  assert.equal(planned.result.executionStatus, "not-executed");
});
