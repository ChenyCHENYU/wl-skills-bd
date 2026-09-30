"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sourceIndex = require("../lib/source-index");
const { runBeRules } = require("../lib/be-rules");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-source-cache-"));
try {
  fs.mkdirSync(path.join(root, ".wl-skills-bd"), { recursive: true });
  fs.mkdirSync(path.join(root, "contracts"), { recursive: true });
  const contract = path.join(root, "contracts", "sample.json");
  fs.writeFileSync(contract, JSON.stringify({
    entity: { table: "demo_table" },
    fields: [{ column: "id" }],
    output: { migration: "src/main/resources/db/migration" },
  }));

  sourceIndex.clearSourceIndexMemoryCache();
  const cold = sourceIndex.buildSourceIndex(root);
  assert.strictEqual(cold.cache.level, "miss");
  assert.ok(fs.existsSync(path.join(root, sourceIndex.CACHE_FILE)), "应生成原子持久化缓存");

  const memory = sourceIndex.buildSourceIndex(root);
  assert.strictEqual(memory.cache.level, "memory");
  assert.ok(sourceIndex.sourceIndexMemoryCacheStats().bytes <= sourceIndex.sourceIndexMemoryCacheStats().maxBytes);

  const incompleteRoot = path.join(root, "incomplete-project");
  const contractDir = path.join(incompleteRoot, "docs", "contracts");
  fs.mkdirSync(contractDir, { recursive: true });
  fs.writeFileSync(path.join(contractDir, "wl-contract.json"), JSON.stringify({
    entity: { table: "source_demo" }, fields: [{ column: "id" }],
  }));
  fs.mkdirSync(path.join(incompleteRoot, "contracts"), { recursive: true });
  fs.writeFileSync(path.join(incompleteRoot, "contracts", "integration.json"), JSON.stringify({
    integrations: [{ id: "ORDER_CREATED", transport: "team-mq" }],
  }));
  const mixed = sourceIndex.buildSourceIndex(incompleteRoot, { cache: false });
  assert.strictEqual(mixed.contracts.length, 1, "集成协议不能误报为数据库契约");
  assert.strictEqual(mixed.diagnostics.length, 0);
  fs.mkdirSync(path.join(incompleteRoot, "docs", "db-spec"), { recursive: true });
  fs.writeFileSync(path.join(incompleteRoot, "docs", "db-spec", "demo.json"), JSON.stringify({
    tables: [{ name: "source_demo", fields: [{ name: "id", dbType: "varchar(64)" }] }],
  }));
  const originalReaddir = fs.readdirSync;
  fs.readdirSync = (directory, ...args) => {
    if (directory === contractDir) { const error = new Error("EACCES injected"); error.code = "EACCES"; throw error; }
    return originalReaddir(directory, ...args);
  };
  try {
    const incomplete = sourceIndex.buildSourceIndex(incompleteRoot, { cache: false });
    assert.strictEqual(incomplete.contracts.length, 0);
    assert.ok(incomplete.diagnostics.some((item) => item.code === "SOURCE_SCAN_INCOMPLETE"));
    const b31 = runBeRules(incompleteRoot, { rules: ["B31"], workspace: false });
    assert.strictEqual(b31.coverage.status, "partial");
    assert.ok(b31.issues.some((item) => item.rule === "WLS_CONFIG"));
    assert.ok(!b31.issues.some((item) => item.rule === "B31"), "事实源不完整时不能推断文档漂移");
  } finally { fs.readdirSync = originalReaddir; }
  const originalLstat = fs.lstatSync;
  fs.lstatSync = (file, ...args) => {
    if (file === path.join(contractDir, "wl-contract.json")) {
      const error = new Error("ENOENT injected"); error.code = "ENOENT"; throw error;
    }
    return originalLstat(file, ...args);
  };
  try {
    assert.ok(sourceIndex.buildSourceIndex(incompleteRoot, { cache: false }).diagnostics
      .some((item) => item.code === "SOURCE_SCAN_INCOMPLETE" && item.file.endsWith("wl-contract.json")),
    "目录枚举后子文件消失不能被当成可选根忽略");
  } finally { fs.lstatSync = originalLstat; }
  fs.mkdirSync(path.join(contractDir, "db"), { recursive: true });
  fs.writeFileSync(path.join(contractDir, "db", "broken.json"), JSON.stringify({ entity: { table: "broken" }, fields: [] }));
  assert.ok(sourceIndex.buildSourceIndex(incompleteRoot, { cache: false }).diagnostics
    .some((item) => item.code === "SOURCE_CONTRACT_INVALID"), "损坏的数据库契约必须显式报错");
  const configFile = path.join(incompleteRoot, ".wl-skills-bd", "catalog.config.json");
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify({ modules: {
    valid: { contractRoots: ["docs/contracts"] }, invalid: { contractRoots: "contracts" },
  } }));
  const partiallyInvalidConfig = sourceIndex.buildSourceIndex(incompleteRoot, { cache: false });
  assert.ok(partiallyInvalidConfig.diagnostics.some((item) => item.code === "SOURCE_CONFIG_INVALID"
    && item.message.includes("invalid")), "部分模块的非法目录配置不能静默忽略");
  assert.strictEqual(runBeRules(incompleteRoot, { rules: ["B31"], workspace: false }).coverage.status, "partial");
  fs.writeFileSync(configFile, "{broken");
  const invalidConfig = sourceIndex.buildSourceIndex(incompleteRoot, { cache: false });
  assert.strictEqual(invalidConfig.contracts.length, 0, "损坏的 Catalog 配置不得静默退回默认目录");
  assert.ok(invalidConfig.diagnostics.some((item) => item.code === "SOURCE_CONFIG_INVALID"));
  sourceIndex.clearSourceIndexMemoryCache();
  const persistent = sourceIndex.buildSourceIndex(root);
  assert.strictEqual(persistent.cache.level, "persistent");

  fs.writeFileSync(contract, JSON.stringify({
    entity: { table: "demo_table" },
    fields: [{ column: "id" }, { column: "name" }],
  }));
  const invalidated = sourceIndex.buildSourceIndex(root);
  assert.strictEqual(invalidated.cache.level, "miss", "文件状态变化必须使缓存失效");
  assert.ok(invalidated.contracts[0].fields.has("name"));

  fs.writeFileSync(path.join(root, sourceIndex.CACHE_FILE), "{broken");
  sourceIndex.clearSourceIndexMemoryCache();
  const rebuilt = sourceIndex.buildSourceIndex(root);
  assert.strictEqual(rebuilt.cache.level, "miss", "缓存损坏必须安全重建");
  assert.ok(rebuilt.contracts[0].fields.has("name"));

  for (let index = 0; index < 17; index += 1) {
    const rel = `contracts/partition-${index}`;
    fs.mkdirSync(path.join(root, rel), { recursive: true });
    fs.writeFileSync(path.join(root, rel, "sample.json"), JSON.stringify({
      entity: { table: `demo_${index}` }, fields: [{ column: "id" }],
    }));
    sourceIndex.buildSourceIndex(root, { contractsRel: rel });
  }
  assert.ok(sourceIndex.sourceIndexMemoryCacheStats().entries <= 16, "内存 Source Index 必须按条目数淘汰");
  assert.ok(sourceIndex.sourceIndexMemoryCacheStats().bytes <= sourceIndex.sourceIndexMemoryCacheStats().maxBytes);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("✅ source index cache：内存/持久化命中、指纹失效、损坏重建与原子落盘通过");
