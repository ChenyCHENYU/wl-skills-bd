"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sourceIndex = require("../lib/source-index");

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
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("✅ source index cache：内存/持久化命中、指纹失效、损坏重建与原子落盘通过");
