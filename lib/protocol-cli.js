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
  { id: "route", summary: "只读任务判定：任务类型、规则子集、缺口（不记录 run）", readOnly: true, required: [], requireAny: ["task", "type"], optional: ["targets", "type", "projectRoot"], sideEffects: "无写入", mapping: `${BIN} route --input "<task>" [--type <id>]` },
  { id: "explain", summary: "解释本次任务判定与计划节点（只读，不记录）", readOnly: true, required: [], requireAny: ["task", "type"], optional: ["targets", "type", "projectRoot"], sideEffects: "无写入", mapping: `${BIN} explain --input "<task>"` },
  { id: "task", summary: "判定并持久化任务计划与 preflight 证据（尚未执行）", readOnly: false, required: [], requireAny: ["task", "type"], optional: ["runId", "targets", "type", "projectRoot"], sideEffects: "写入 .wl-skills-bd/runs/ 下本包任务记录与 preflight 证据", mapping: `${BIN} task --input "<task>" [--type <id>] [--run-id <id>]` },
  { id: "status", summary: "读取本包真实执行回执、验证状态与新鲜度", readOnly: true, required: [], optional: ["runId", "projectRoot"], sideEffects: "无写入", mapping: `${BIN} status [--run-id <id>]` },
  { id: "doctor-host", summary: "宿主入口静态诊断（不证明宿主已加载）", readOnly: true, required: [], optional: ["host", "projectRoot"], sideEffects: "无写入", mapping: `${BIN} doctor-host --host <host>` },
];

function readSkillFrontmatter(skillDir) {
  try {
    const raw = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
    const name = /^name:\s*(.+)$/m.exec(raw);
    const description = /^description:\|?\s*\n([\s\S]*?)(?=\n\w|\nmetadata:)/m.exec(raw);
    const status = /status:\s*"?([^"\n]+)"?/.exec(raw);
    const triggers = /triggers:\s*"?([^"\n]+)"?/.exec(raw);
    return {
      name: name ? name[1].trim() : path.basename(skillDir),
      description: description ? description[1].split("\n").map((line) => line.trim()).filter(Boolean).join(" ").slice(0, 200) : "",
      status: status ? status[1].trim() : "unknown",
      triggers: triggers ? triggers[1].split(/、|,/).map((item) => item.trim()).filter(Boolean) : [],
    };
  } catch {
    return null;
  }
}

function buildInventory() {
  const commands = require("./cli-catalog").commandInventory();
  const skillsRoot = path.join(__dirname, "../files/.github/skills");
  const skills = [];
  const loadErrors = [];
  for (const group of fs.existsSync(skillsRoot) ? fs.readdirSync(skillsRoot, { withFileTypes: true }) : []) {
    if (!group.isDirectory()) continue;
    for (const entry of fs.readdirSync(path.join(skillsRoot, group.name), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillDir = path.join(skillsRoot, group.name, entry.name);
      if (!fs.existsSync(path.join(skillDir, "SKILL.md"))) continue;
      const frontmatter = readSkillFrontmatter(skillDir);
      if (!frontmatter) { loadErrors.push(`skill 目录无法解析：${group.name}/${entry.name}`); continue; }
      skills.push({
        id: entry.name,
        description: frontmatter.description,
        status: frontmatter.status,
        triggers: frontmatter.triggers,
        entry: `.github/skills/${group.name}/${entry.name}/SKILL.md`,
        execution: frontmatter.status.includes("落地") ? "programmatic" : "instructional",
      });
    }
  }
  let taskTypes = [];
  try {
    const router = require("./task-router");
    taskTypes = router.listTasks().map((row) => ({ id: row.id, name: row.name, skills: (router.TASK_TYPES[row.id] && router.TASK_TYPES[row.id].skills) || [], requiresContract: Boolean(row.requiresContract) }));
  } catch (error) {
    loadErrors.push(`taskTypes 加载失败：${error.message}`);
  }
  let mcpTools = [];
  try {
    const registry = require("../mcp/registry");
    mcpTools = (registry.TOOLS || []).map((tool) => ({
      name: tool.name, summary: tool.description, inputSchema: tool.inputSchema,
      annotations: tool.annotations,
      write: tool._meta["wl/sideEffects"].write,
      sideEffects: tool._meta["wl/sideEffects"].summary,
    }));
  } catch (error) {
    loadErrors.push(`mcpTools 加载失败：${error.message}`);
  }
  return { skills, taskTypes, commands, mcpTools, loadErrors };
}

const protocol = createProtocol({
  bin: BIN,
  packageName: pkg.name,
  packageVersion: pkg.version,
  capabilities: capabilitiesDocument.capabilities || [],
  constraints: { projectScope: { config: ".wl-skills-scope.json", schema: "lib/project-scope.schema.json", adoption: "own-manifest-or-direct-dependency-or-explicit-enable", inheritance: "never-across-project-boundaries", excluded: ["mobile", "unadopted-project", "aggregate-workspace"] }, node: (pkg.engines && pkg.engines.node) || null, boundaryVersion: capabilitiesDocument.boundaryVersion || null },
  operations: OPERATIONS,
  executors: require("./executors.json"),
  inventory: buildInventory(),
});

function runOperation(operation, input, diagnostics) {
  const projectRoot = input.projectRoot || ".";
  if (input.context && diagnostics) diagnostics.push("context 字段不参与本包判定：bd 的任务判定基于 input/type/targets，context 已显式忽略");
  if (operation === "status") return runtime.status(projectRoot, { runId: input.runId });
  if (operation === "doctor-host") return runtime.doctorHost(projectRoot, input.host || "codex");
  return runtime.task(projectRoot, input.task || "", {
    persist: operation === "task",
    runId: input.runId,
    targets: Array.isArray(input.targets) ? input.targets : [],
    type: input.type,
  });
}

function envelopeError(code, message, field) {
  return { protocolVersion: 1, package: pkg.name, packageVersion: pkg.version, operation: null, requestId: null, ok: false, error: { code, message, ...(field ? { field } : {}) }, diagnostics: [] };
}

async function runCli(argv) {
  const sub = argv[0];
  if (sub === "describe") {
    console.log(JSON.stringify(protocol.describe(), null, 2));
    return 0;
  }
  if (sub === "request") {
    const fileIndex = argv.indexOf("--input-file");
    const file = fileIndex >= 0 ? argv[fileIndex + 1] : null;
    if (!file) {
      console.log(JSON.stringify(envelopeError("missing-input", "缺少必要输入：--input-file <request.json>", "input-file"), null, 2));
      return 2;
    }
    let input;
    try {
      input = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
    } catch (error) {
      const message = error.code === "ENOENT" ? `请求文件不存在：${file}` : `请求文件无法解析：${error.message}`;
      console.log(JSON.stringify(envelopeError("invalid-input", message, "input-file"), null, 2));
      return 2;
    }
    const envelope = input && input.operation === "execute"
      ? await protocol.requestExecute(input, {
        readStatus: (root, runId) => runOperation("status", { projectRoot: root, runId }),
        invoke: require("./executor-invoke").invoke,
      })
      : protocol.request(input, runOperation);
    console.log(JSON.stringify(envelope, null, 2));
    return envelope.ok ? 0 : 2;
  }
  console.error("用法：");
  console.error("  wl-skills-bd protocol describe --json");
  console.error("  wl-skills-bd protocol request --input-file <request.json> --json");
  return 2;
}

module.exports = { protocol, runOperation, runCli, OPERATIONS };
