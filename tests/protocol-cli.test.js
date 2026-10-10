"use strict";

const test = require("node:test");
const assert = require("assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { protocol, runOperation } = require("../lib/protocol-cli");
const runtime = require("../lib/task-runtime");
const pkg = require("../package.json");

const BIN = path.join(__dirname, "..", "bin", "wl-skills-bd.js");

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-protocol-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ devDependencies: { "@agile-team/wl-skills-bd": "*" } }));
  return root;
}

test("describe 返回协议版本、能力目录与五个统一操作", () => {
  const described = protocol.describe();
  assert.equal(described.protocolVersion, 1);
  assert.equal(described.package, pkg.name);
  assert.ok(Array.isArray(described.capabilities) && described.capabilities.length > 0);
  assert.deepEqual(described.operations.map((operation) => operation.id), ["route", "explain", "task", "status", "doctor-host"]);
  for (const operation of described.operations) {
    assert.equal(typeof operation.readOnly, "boolean");
    assert.equal(typeof operation.mapping, "string");
  }
  assert.ok(described.errorCodes.includes("unsupported-protocol"));
});

test("route 只读判定返回六类状态之一且不落 run 记录", () => {
  const root = tempRoot();
  const envelope = protocol.request({ operation: "route", projectRoot: root, task: "为契约生成新增和修改代码" }, runOperation);
  assert.equal(envelope.ok, true);
  assert.ok(["matched", "baseline", "ambiguous", "gap", "not-applicable", "needs-context"].includes(envelope.result.decision.status));
  assert.equal(envelope.result.runId, undefined);
});

test("task 持久化返回 runId 且 status 可回查", () => {
  const root = tempRoot();
  const planned = protocol.request({ operation: "task", projectRoot: root, task: "为契约生成新增和修改代码" }, runOperation);
  assert.equal(planned.ok, true);
  assert.ok(planned.result.runId);
  const status = protocol.request({ operation: "status", projectRoot: root, runId: planned.result.runId }, runOperation);
  assert.equal(status.ok, true);
  assert.equal(status.result.runId, planned.result.runId);
  assert.equal(status.result.executionStatus, "not-executed");
});

test("doctor-host 运行时按指定 host 诊断", () => {
  const root = tempRoot();
  const report = runtime.doctorHost(root, "claude");
  assert.equal(report.host, "claude");
  assert.ok(report.entries.some((entry) => entry.path === "CLAUDE.md"));
});

test("CLI doctor-host --host claude 透传（回归：不得回落 codex）", () => {
  const root = tempRoot();
  const run = spawnSync(process.execPath, [BIN, "doctor-host", "--host", "claude", "--target", root], { encoding: "utf8" });
  const report = JSON.parse(run.stdout);
  assert.equal(report.host, "claude");
  assert.ok(report.entries.some((entry) => entry.path === "CLAUDE.md"));
  assert.ok(!report.entries.some((entry) => entry.path === "AGENTS.md"));
});

test("CLI doctor-host 缺省仍为 codex", () => {
  const root = tempRoot();
  const run = spawnSync(process.execPath, [BIN, "doctor-host", "--target", root], { encoding: "utf8" });
  assert.equal(JSON.parse(run.stdout).host, "codex");
});

test("CLI protocol describe 输出统一信封", () => {
  const run = spawnSync(process.execPath, [BIN, "protocol", "describe"], { encoding: "utf8" });
  assert.equal(run.status, 0);
  const described = JSON.parse(run.stdout);
  assert.equal(described.protocolVersion, 1);
  assert.equal(described.package, "@agile-team/wl-skills-bd");
});

test("CLI protocol request 走完整信封并处理错误码", () => {
  const root = tempRoot();
  const file = path.join(root, "req.json");
  fs.writeFileSync(file, JSON.stringify({ operation: "route", projectRoot: root, task: "生成 Controller" }));
  const ok = spawnSync(process.execPath, [BIN, "protocol", "request", "--input-file", file], { encoding: "utf8" });
  assert.equal(ok.status, 0);
  assert.equal(JSON.parse(ok.stdout).ok, true);
  fs.writeFileSync(file, JSON.stringify({ protocolVersion: 9, operation: "route", task: "x" }));
  const bad = spawnSync(process.execPath, [BIN, "protocol", "request", "--input-file", file], { encoding: "utf8" });
  assert.equal(bad.status, 2);
  const envelope = JSON.parse(bad.stdout);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, "unsupported-protocol");
});

test("协议错误：缺输入/未知操作/非对象", () => {
  assert.equal(protocol.request({ operation: "route" }, runOperation).error.code, "missing-input");
  assert.equal(protocol.request({ operation: "codegen" }, runOperation).error.code, "unknown-operation");
  assert.equal(protocol.request("route", runOperation).error.code, "invalid-input");
});

test("边界输入校验：非法类型在触达执行器前判 invalid-input（独立复验缺陷回归）", () => {
  const invalidPayloads = [
    { operation: "task", task: true },
    { operation: "task", task: { text: "bad" } },
    { operation: "task", task: "检查目标", targets: [null, 42, {}] },
    { operation: "route", task: "检查目标", projectRoot: 42 },
    { operation: "task", task: "检查目标", runId: {} },
  ];
  for (const payload of invalidPayloads) {
    const envelope = protocol.request(payload, () => { throw new Error("不应触达执行器"); });
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, "invalid-input");
    assert.ok(envelope.error.field);
  }
});

test("route 支持 type-only（保留原入口条件式输入）", () => {
  const root = tempRoot();
  const envelope = protocol.request({ operation: "route", projectRoot: root, type: "project-context" }, runOperation);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.result.decision.status, "gap");
  const missing = protocol.request({ operation: "route", projectRoot: root }, runOperation);
  assert.equal(missing.error.code, "missing-input");
});

test("CLI 缺 --input-file 时 stdout 输出 missing-input JSON 信封", () => {
  const run = spawnSync(process.execPath, [BIN, "protocol", "request"], { encoding: "utf8" });
  assert.equal(run.status, 2);
  const envelope = JSON.parse(run.stdout);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, "missing-input");
  assert.equal(envelope.error.field, "input-file");
});


test("context null 判 invalid-input 且零写入（CLI 回归）", () => {
  const root = tempRoot();
  const file = path.join(root, "req.json");
  fs.writeFileSync(file, JSON.stringify({ operation: "task", projectRoot: root, task: "审计后端规则", runId: "ctx-null", context: null }));
  const run = spawnSync(process.execPath, [BIN, "protocol", "request", "--input-file", file], { encoding: "utf8" });
  assert.equal(run.status, 2);
  const envelope = JSON.parse(run.stdout);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, "invalid-input");
  assert.equal(envelope.error.field, "context");
  assert.equal(fs.readdirSync(root).filter((name) => name.startsWith(".")).length, 0, "不得写入任何任务记录");
});

test("targets 空数组与 Schema 一致（运行时接受空范围）", () => {
  const root = tempRoot();
  const envelope = protocol.request({ operation: "route", projectRoot: root, task: "审计后端规则", targets: [] }, runOperation);
  assert.equal(envelope.ok, true);
  const described = protocol.describe();
  assert.equal(described.schemas.request.properties.targets.minItems, undefined, "Schema 不得要求非空 targets");
});
