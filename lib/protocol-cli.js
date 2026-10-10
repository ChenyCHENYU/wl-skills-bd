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
  const commands = [
    { name: "init", args: "[--target <dir>] [--json] [--confirm --plan-hash <hash>]", summary: "安装工程资产（预览→planHash 确认两步）", execution: "programmatic", sideEffects: "写入 .wl-skills-bd/ 等受管文件", preconditions: "空目录或本包 manifest 一致" },
    { name: "update", args: "[--target <dir>] [--force] [--json] [--confirm --plan-hash <hash>]", summary: "安全升级受管资产", execution: "programmatic", sideEffects: "仅更新本包登记且未修改文件；冲突阻断" },
    { name: "diff", args: "[--target <dir>]", summary: "预览与受管清单差异", execution: "programmatic", sideEffects: "无" },
    { name: "clean", args: "[--target <dir>] [--confirm --plan-hash <hash>]", summary: "卸载本包受管文件", execution: "programmatic", sideEffects: "删除本包登记文件（备份保留）" },
    { name: "contract", args: "<sub> [options]", summary: "wl-contract 契约校验/种子/字段口径", execution: "programmatic", sideEffects: "子命令决定" },
    { name: "codegen", args: "--contract <file> [--modules ...] [--confirm --plan-hash <hash>]", summary: "契约生成 15 固定产物 + 请求 DTO", execution: "programmatic", sideEffects: "写入 Java/Maven 源文件（planHash 确认）", preconditions: "存在有效 wl-contract.json" },
    { name: "review", args: "[--target <dir>]", summary: "B1~B32 规则快速审计", execution: "programmatic", sideEffects: "无（报告输出）" },
    { name: "check", args: "[--target <dir>]", summary: "质量门（J 规则+覆盖率+供应链）", execution: "programmatic", sideEffects: "无（需 JDK8+Maven 环境）" },
    { name: "config", args: "<plan|apply|migrate|doctor|fix>", summary: "配置分层治理", execution: "programmatic", sideEffects: "apply/fix 写配置（确认制）" },
    { name: "task", args: "--input <任务> [--type <id>] [--run-id <id>]", summary: "判定并持久化任务计划", execution: "programmatic", sideEffects: "写 .wl-skills-bd/runs/" },
    { name: "route", args: "--input <任务> | --type <id>", summary: "只读任务判定", execution: "programmatic", sideEffects: "无" },
    { name: "explain", args: "--input <任务> | --type <id>", summary: "只读判定解释", execution: "programmatic", sideEffects: "无" },
    { name: "status", args: "[--run-id <id>]", summary: "读取本包回执", execution: "programmatic", sideEffects: "无" },
    { name: "doctor-host", args: "[--host <name>]", summary: "宿主入口静态诊断", execution: "programmatic", sideEffects: "无" },
    { name: "protocol", args: "describe | request --input-file <file>", summary: "本公开集成协议", execution: "programmatic", sideEffects: "见操作声明" },
  ];
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
    mcpTools = (registry.TOOLS || []).map((tool) => ({ name: tool.name, summary: tool.description, write: (tool.annotations && tool.annotations.readOnlyHint === true) ? "readonly" : "guarded" }));
  } catch (error) {
    loadErrors.push(`mcpTools 加载失败：${error.message}`);
  }
  return { skills, taskTypes, commands, mcpTools, loadErrors };
}

const protocol = createProtocol({
  packageName: pkg.name,
  packageVersion: pkg.version,
  capabilities: capabilitiesDocument.capabilities || [],
  constraints: { projectScope: { config: ".wl-skills-scope.json", schema: "lib/project-scope.schema.json", adoption: "own-manifest-or-direct-dependency-or-explicit-enable", inheritance: "never-across-project-boundaries", excluded: ["mobile", "unadopted-project", "aggregate-workspace"] }, node: (pkg.engines && pkg.engines.node) || null, boundaryVersion: capabilitiesDocument.boundaryVersion || null },
  operations: OPERATIONS,
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
