"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const installer = require("../lib/installer");
const { hashManagedFile, readManifest, writeManifest } = require("../lib/manifest");
const { getJsoncValue, parseJsonc, setJsoncValue } = require("../lib/shared-jsonc.cjs");
const OWNER = "wl-skills-bd";
const foreign = "<!-- wl-skills-test:begin -->\n测试包规则\n<!-- wl-skills-test:end -->\n";

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-shared-"));
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-assets-"));
  function put(base, rel, content) { const file = path.join(base, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
  put(sourceRoot, "AGENTS.md", "后端规则\n");
  put(sourceRoot, ".github/skills/_registry.md", "后端技能路由\n");
  put(sourceRoot, ".wl-skills-bd/own.txt", "包内文件\n");
  put(sourceRoot, ".cursor/mcp.json", JSON.stringify({ mcpServers: { [OWNER]: { command: "npx", args: [OWNER] } } }, null, 2));
  put(sourceRoot, ".vscode/mcp.json", JSON.stringify({ servers: { [OWNER]: { type: "stdio", command: "npx", args: [OWNER] } } }, null, 2));
  const apply = (options = {}) => { const plan = installer.buildPlan(root, { sourceRoot }); return installer.applyPlan(plan, { confirm: true, planHash: plan.planHash, ...options }); };
  const clean = () => { const plan = installer.buildCleanPlan(root); return installer.applyCleanPlan(plan, { confirm: true, planHash: plan.planHash, force: true }); };
  try { run({ root, sourceRoot, put, apply, clean }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(sourceRoot, { recursive: true, force: true }); }
}

fixture(({ root, apply, clean, put }) => {
  const original = "用户规则\r\n" + foreign.replace(/\n/g, "\r\n");
  put(root, "AGENTS.md", original);
  const jsonc = '{\r\n  // 用户注释\r\n  "settings": {"mode": "local"},\r\n  "mcpServers": {\r\n    "foreign": {"command": "local"}, // 服务注释\r\n  },\r\n}\r\n';
  put(root, ".cursor/mcp.json", jsonc);
  assert.equal(apply().ok, true);
  assert.equal(apply().ok, true);
  assert.equal(installer.check(root).ok, true);
  assert.equal((fs.readFileSync(path.join(root, "AGENTS.md"), "utf8").match(/wl-skills-bd:begin/g) || []).length, 1);
  const mcp = fs.readFileSync(path.join(root, ".cursor/mcp.json"), "utf8");
  assert.ok(mcp.includes("// 用户注释"));
  assert.ok(mcp.includes("// 服务注释"));
  assert.deepEqual(getJsoncValue(mcp, ["settings"]), { mode: "local" });
  fs.appendFileSync(path.join(root, "AGENTS.md"), "后来用户补充\r\n");
  assert.equal(installer.check(root).ok, true);
  assert.equal(clean().ok, true);
  assert.equal(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"), original + "后来用户补充\r\n");
  const remaining = fs.readFileSync(path.join(root, ".cursor/mcp.json"), "utf8");
  assert.equal(getJsoncValue(remaining, ["mcpServers", OWNER]), undefined);
  assert.deepEqual(getJsoncValue(remaining, ["mcpServers", "foreign"]), { command: "local" });
  assert.ok(remaining.includes("// 用户注释"));
  assert.ok(remaining.includes("// 服务注释"));
  assert.ok(!fs.existsSync(path.join(root, ".vscode/mcp.json")), "可删除本包新建且无其他贡献的 MCP 文件");
});

fixture(({ root, sourceRoot, apply, clean, put }) => {
  put(root, "AGENTS.md", fs.readFileSync(path.join(sourceRoot, "AGENTS.md")));
  put(root, ".wl-skills-bd/own.txt", fs.readFileSync(path.join(sourceRoot, ".wl-skills-bd/own.txt")));
  const config = fs.readFileSync(path.join(sourceRoot, ".cursor/mcp.json"), "utf8");
  put(root, ".cursor/mcp.json", config);
  assert.equal(apply().ok, true);
  assert.equal(readManifest(root).files["AGENTS.md"].kind, "reference");
  assert.equal(readManifest(root).files[".cursor/mcp.json"].kind, "reference");
  assert.equal(clean().ok, true);
  assert.equal(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"), "后端规则\n");
  assert.equal(fs.readFileSync(path.join(root, ".cursor/mcp.json"), "utf8"), config);
  assert.equal(fs.readFileSync(path.join(root, ".wl-skills-bd/own.txt"), "utf8"), "包内文件\n");
});

fixture(({ root, sourceRoot, apply, put }) => {
  put(root, "AGENTS.md", "");
  assert.equal(apply().ok, true);
  fs.unlinkSync(path.join(sourceRoot, "AGENTS.md"));
  const plan = installer.buildPlan(root, { sourceRoot });
  assert.equal(plan.actions.find((item) => item.rel === "AGENTS.md").action, "update-stale");
  assert.equal(installer.applyPlan(plan, { confirm: true, planHash: plan.planHash }).ok, true);
  assert.equal(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"), "", "升级移除旧贡献时保留预存空文件");
});

fixture(({ root, sourceRoot, apply, clean, put }) => {
  put(root, "AGENTS.md", "旧后端规则\n");
  put(root, ".cursor/mcp.json", fs.readFileSync(path.join(sourceRoot, ".cursor/mcp.json")));
  writeManifest(root, { schemaVersion: 1, package: "@agile-team/wl-skills-bd", version: "0.30.1", files: {
    "AGENTS.md": { installedHash: hashManagedFile(path.join(root, "AGENTS.md")) },
    ".cursor/mcp.json": { installedHash: hashManagedFile(path.join(root, ".cursor/mcp.json")) },
  } });
  assert.equal(apply().ok, true);
  assert.equal(readManifest(root).files["AGENTS.md"].kind, "block");
  assert.equal(readManifest(root).files[".cursor/mcp.json"].kind, "mcp");
  fs.appendFileSync(path.join(root, "AGENTS.md"), foreign);
  assert.equal(clean().ok, true);
  assert.equal(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"), foreign);
});

fixture(({ root, apply, clean }) => {
  assert.equal(apply().ok, true);
  const agents = path.join(root, "AGENTS.md");
  fs.writeFileSync(agents, fs.readFileSync(agents, "utf8").replace("后端规则", "用户修改后端规则"));
  const mcp = path.join(root, ".cursor/mcp.json");
  fs.writeFileSync(mcp, setJsoncValue(fs.readFileSync(mcp, "utf8"), ["mcpServers", OWNER, "command"], "user-command"));
  const originalAgents = fs.readFileSync(agents);
  const originalMcp = fs.readFileSync(mcp);
  const result = clean();
  assert.equal(result.ok, true);
  assert.ok(result.preserved.includes("AGENTS.md"));
  assert.ok(result.preserved.includes(".cursor/mcp.json"));
  assert.deepEqual(fs.readFileSync(agents), originalAgents);
  assert.deepEqual(fs.readFileSync(mcp), originalMcp);
  const retained = readManifest(root);
  assert.equal(retained.files["AGENTS.md"].kind, "reference");
  assert.equal(retained.files[".cursor/mcp.json"].kind, "reference");
  assert.equal(apply({ force: true }).ok, false, "清理保留的用户修改不得被再安装重新认领");
  assert.deepEqual(fs.readFileSync(agents), originalAgents);
});

fixture(({ root, sourceRoot, apply, clean, put }) => {
  const rel = ".wl-skills-bd/contracts/wl-delivery-profile.v1.json";
  put(sourceRoot, rel, '{"pagination": 10}');
  assert.equal(apply().ok, true);
  put(root, rel, '{"pagination": 20, "custom": true}');
  assert.equal(apply({ force: true }).ok, true);
  assert.equal(readManifest(root).files[rel].projectOwned, true);
  assert.equal(fs.readFileSync(path.join(root, rel), "utf8"), '{"pagination": 20, "custom": true}');
  assert.equal(clean().ok, true);
  assert.equal(fs.readFileSync(path.join(root, rel), "utf8"), '{"pagination": 20, "custom": true}');
});

fixture(({ root, apply, clean }) => {
  assert.equal(apply().ok, true);
  const mcp = path.join(root, ".cursor/mcp.json");
  const source = fs.readFileSync(mcp, "utf8");
  const comment = source.replace('"command":"npx"', '/* 用户添加的节点内注释 */ "command":"npx"');
  assert.notEqual(source, comment);
  fs.writeFileSync(mcp, comment);
  assert.equal(installer.check(root).ok, false, "原始节点注释也是用户修改");
  assert.equal(apply().ok, false, "升级不能静默重序列化并抹掉注释");
  assert.equal(fs.readFileSync(mcp, "utf8"), comment);
  assert.equal(apply({ force: true }).ok, true, "相同值无需重写，force也保留原始节点");
  assert.equal(fs.readFileSync(mcp, "utf8"), comment);
  assert.equal(clean().ok, true);
  assert.equal(fs.readFileSync(mcp, "utf8"), comment);
  assert.equal(readManifest(root).files[".cursor/mcp.json"].kind, "reference");
  assert.equal(installer.check(root).ok, true, "保留后记录实际引用快照");
});

fixture(({ root, apply, put }) => {
  const foreignMcp = JSON.stringify({ mcpServers: { [OWNER]: { command: "foreign" } } });
  put(root, ".cursor/mcp.json", foreignMcp);
  assert.equal(apply({ force: true }).ok, false);
  assert.equal(fs.readFileSync(path.join(root, ".cursor/mcp.json"), "utf8"), foreignMcp);
  assert.ok(!fs.existsSync(path.join(root, "AGENTS.md")), "外来同名 key 冲突时零安装写入");
  assert.ok(!fs.existsSync(path.join(root, installer.MANIFEST_NAME)));
});

for (const jsonc of ['{"mcpServers": false}', '{"mcpServers": {}, "mcpServers": {}}', '{/*未闭合']) fixture(({ root, apply, put }) => {
  put(root, ".cursor/mcp.json", jsonc);
  assert.equal(apply({ force: true }).ok, false);
  assert.ok(!fs.existsSync(path.join(root, "AGENTS.md")));
  assert.equal(fs.readFileSync(path.join(root, ".cursor/mcp.json"), "utf8"), jsonc);
});

fixture(({ root, sourceRoot, put }) => {
  put(root, ".github", "目录被文件占用");
  assert.throws(() => installer.buildPlan(root, { sourceRoot }), /路径类型/);
  assert.ok(!fs.existsSync(path.join(root, "AGENTS.md")));
  assert.ok(!fs.existsSync(path.join(root, installer.MANIFEST_NAME)));
});

assert.throws(() => parseJsonc('{"x": 1, "x": 2}'), /duplicate/);
console.log("✅ shared installer：共享区块、JSONC、预存引用、旧版迁移、用户修改与零写入预检通过");
