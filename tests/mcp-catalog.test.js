"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { TOOLS, HANDLERS } = require("../mcp/registry");
const { protocol } = require("../lib/protocol-cli");
const capabilities = require("../files/.wl-skills-bd/capabilities.json");
const PACKAGE_ROOT = path.resolve(__dirname, "..");

function runMcp(root, messages) {
  const result = spawnSync(process.execPath, [path.join(PACKAGE_ROOT, "mcp/server.js")], {
    cwd: root, env: { ...process.env, WL_PROJECT_ROOT: root },
    input: messages.map((message) => JSON.stringify(message)).join("\n") + "\n",
    encoding: "utf8", timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split(/\r?\n/).map(JSON.parse);
}

test("MCP 完整 Schema/副作用来自真实 registry，公开目录和安装快照逐项对齐", () => {
  const expectedWrite = {
    wls_be_capabilities: "readonly", wls_be_validate: "recorded", wls_be_review: "gated",
    wls_be_doctor: "readonly", wls_be_codegen: "gated", wls_be_contract: "gated",
    wls_be_safe_fix: "gated", wls_be_standards: "readonly", wls_be_templates: "readonly",
    wls_be_db_preview: "readonly", wls_be_export_permissions: "gated", wls_be_config: "gated",
    wls_be_troubleshoot: "readonly", wls_be_task: "recorded", wls_be_catalog: "gated",
    wls_be_context: "readonly", wls_be_commit: "readonly", wls_be_test: "readonly",
  };
  assert.deepEqual(TOOLS.map((tool) => tool.name), Object.keys(expectedWrite));
  const inventory = protocol.describe().inventory.mcpTools;
  for (const tool of TOOLS) {
    const definition = HANDLERS[tool.name];
    assert.equal(typeof definition.handle, "function", tool.name);
    const effect = tool._meta["wl/sideEffects"];
    assert.equal(effect.write, expectedWrite[tool.name]);
    assert.equal(tool.annotations.readOnlyHint, effect.write === "readonly");
    assert.equal(effect.summary, definition.sideEffects);
    assert.deepEqual(inventory.find((entry) => entry.name === tool.name), {
      name: tool.name, summary: tool.description, inputSchema: tool.inputSchema,
      annotations: tool.annotations, write: effect.write, sideEffects: effect.summary,
    });
    const installed = capabilities.mcpTools.items.find((entry) => entry.name === tool.name);
    assert.equal(installed.write, effect.write);
    assert.equal(installed.sideEffects, effect.summary);
    assert.deepEqual(installed.annotations, tool.annotations);
  }
  assert.match(inventory.find((entry) => entry.name === "wls_be_task").sideEffects, /route\/explain\/status\/list 只读/);
  assert.match(inventory.find((entry) => entry.name === "wls_be_validate").sideEffects, /runs/);
  assert.match(inventory.find((entry) => entry.name === "wls_be_test").sideEffects, /不保存生成文件/);
});

test("真实 stdio tools/list 完整 Schema/annotations/副作用与公开目录同源", () => {
  const response = runMcp(PACKAGE_ROOT, [{ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }]);
  assert.deepEqual(response[0].result.tools, TOOLS);
  for (const tool of response[0].result.tools) {
    assert.ok(tool.inputSchema.properties.response, `${tool.name} 包含真实预算/游标参数`);
    assert.ok(tool._meta["wl/sideEffects"].summary);
  }
});

test("recorded 声明对应真实 task/validate 回执，route 模式与只读规范工具不写记录", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-mcp-catalog-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ devDependencies: { "@agile-team/wl-skills-bd": require("../package.json").version } }));
  fs.writeFileSync(path.join(root, "pom.xml"), "<project/>");
  fs.mkdirSync(path.join(root, "src/main/java/demo"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/main/java/demo/Demo.java"), "package demo;\npublic class Demo {}\n");
  const call = (id, name, args) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  runMcp(root, [call(1, "wls_be_task", { mode: "route", type: "audit", runId: "readonly-route" }), call(2, "wls_be_standards", { id: "04" })]);
  assert.equal(fs.existsSync(path.join(root, ".wl-skills-bd/runs")), false);
  const responses = runMcp(root, [
    call(3, "wls_be_task", { type: "audit", runId: "metadata-run" }),
    call(4, "wls_be_validate", { path: "src/main/java/demo/Demo.java", rules: ["B12"], runId: "metadata-run" }),
  ]);
  assert.equal(responses.length, 2);
  const status = require("../lib/task-runtime").status(root, { runId: "metadata-run" });
  assert.ok(status.records.some((record) => record.kind === "task-decision"));
  assert.ok(status.records.some((record) => record.kind === "tool-finished"));
  assert.equal(fs.readFileSync(path.join(root, "src/main/java/demo/Demo.java"), "utf8"), "package demo;\npublic class Demo {}\n");
});
