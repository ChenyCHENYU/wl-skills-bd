"use strict";

/**
 * protocol-cli.js — bd 的公开集成协议接线（薄层）
 *
 * 协议实现来自快照 integration-protocol.cjs（单源 conformance/support，勿改）。
 * 注意：bd 的 `integration` CLI 命令属于业务系统集成域（integration-contract/adapter），
 * 公开集成协议使用 `protocol` 子命令，二者互不相干。
 */

const fs = require("node:fs");
const path = require("node:path");
const pkg = require("../package.json");
const capabilitiesDocument = require("./capabilities.json");
const { createProtocol } = require("./integration-protocol.cjs");
const runtime = require("./task-runtime");

const BIN = "wl-skills-bd";
const OPERATIONS = [
  { id: "route", summary: "只读任务判定：任务类型、规则子集、缺口（不记录 run）", readOnly: true, required: ["task"], optional: ["targets", "type", "projectRoot"], mapping: `${BIN} route --input "<task>" [--type <id>]` },
  { id: "explain", summary: "解释本次任务判定与计划节点（只读，不记录）", readOnly: true, required: ["task"], optional: ["targets", "type", "projectRoot"], mapping: `${BIN} explain --input "<task>"` },
  { id: "task", summary: "判定并持久化任务计划与 preflight 证据（尚未执行）", readOnly: false, required: ["task"], optional: ["runId", "targets", "type", "projectRoot"], mapping: `${BIN} task --input "<task>" [--type <id>] [--run-id <id>]` },
  { id: "status", summary: "读取本包真实执行回执、验证状态与新鲜度", readOnly: true, required: [], optional: ["runId", "projectRoot"], mapping: `${BIN} status [--run-id <id>]` },
  { id: "doctor-host", summary: "宿主入口静态诊断（不证明宿主已加载）", readOnly: true, required: [], optional: ["host", "projectRoot"], mapping: `${BIN} doctor-host --host <host>` },
];

const protocol = createProtocol({
  packageName: pkg.name,
  packageVersion: pkg.version,
  capabilities: capabilitiesDocument.capabilities || [],
  constraints: { node: (pkg.engines && pkg.engines.node) || null, boundaryVersion: capabilitiesDocument.boundaryVersion || null },
  operations: OPERATIONS,
});

function runOperation(operation, input) {
  const projectRoot = input.projectRoot || ".";
  if (operation === "status") return runtime.status(projectRoot, { runId: input.runId });
  if (operation === "doctor-host") return runtime.doctorHost(projectRoot, input.host || "codex");
  return runtime.task(projectRoot, input.task, {
    persist: operation === "task",
    runId: input.runId,
    targets: Array.isArray(input.targets) ? input.targets : [],
    type: input.type,
  });
}

function runCli(argv) {
  const sub = argv[0];
  if (sub === "describe") {
    console.log(JSON.stringify(protocol.describe(), null, 2));
    return 0;
  }
  if (sub === "request") {
    const fileIndex = argv.indexOf("--input-file");
    const file = fileIndex >= 0 ? argv[fileIndex + 1] : null;
    if (!file) {
      console.error("protocol request 需要 --input-file <request.json>");
      return 2;
    }
    let input;
    try {
      input = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
    } catch (error) {
      console.log(JSON.stringify({ protocolVersion: 1, package: pkg.name, packageVersion: pkg.version, operation: null, requestId: null, ok: false, error: { code: "invalid-input", message: `请求文件无法解析：${error.message}` }, diagnostics: [] }, null, 2));
      return 2;
    }
    const envelope = protocol.request(input, runOperation);
    console.log(JSON.stringify(envelope, null, 2));
    return envelope.ok ? 0 : 2;
  }
  console.error("用法：");
  console.error("  wl-skills-bd protocol describe --json");
  console.error("  wl-skills-bd protocol request --input-file <request.json> --json");
  return 2;
}

module.exports = { protocol, runOperation, runCli, OPERATIONS };
