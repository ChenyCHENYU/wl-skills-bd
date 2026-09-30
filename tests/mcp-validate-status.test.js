"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { handleValidate } = require("../mcp/tools/beRulesTools");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-mcp-status-"));
const previous = process.env.WL_PROJECT_ROOT;
try {
  process.env.WL_PROJECT_ROOT = root;
  const source = path.join(root, "src", "main", "java", "Demo.java");
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, "class Demo { RedisTemplate redis; void put(String k,String v){ redis.opsForValue().set(k,v); } }");
  const filtered = handleValidate({ rules: ["B13"], severity: "warn" });
  assert.strictEqual(filtered.structuredContent.view.total, 0);
  assert.strictEqual(filtered.structuredContent.error, 1, "筛选展示不得掩盖全局 error");
  assert.strictEqual(filtered.structuredContent.ok, false);
  assert.strictEqual(filtered.structuredContent.status, "failed");
  assert.strictEqual(filtered.isError, true);

  const partial = handleValidate({ rules: ["B9"], quick: true });
  assert.strictEqual(partial.structuredContent.coverage.status, "partial");
  assert.strictEqual(partial.structuredContent.status, "partial");
  assert.strictEqual(partial.structuredContent.ok, false);

  const spec = path.join(root, "docs", "db-spec", "demo.json");
  fs.mkdirSync(path.dirname(spec), { recursive: true });
  fs.writeFileSync(spec, JSON.stringify({ tables: [{ name: "demo", fields: [{ name: "is_enabled", dbType: "tinyint(1)", nullable: false, comment: "启用标志" }] }] }));
  const filteredWarning = handleValidate({ rules: ["B31"], severity: "error" });
  assert.strictEqual(filteredWarning.structuredContent.view.total, 0, JSON.stringify(filteredWarning.structuredContent));
  assert.ok(filteredWarning.structuredContent.warn > 0);
  assert.strictEqual(filteredWarning.structuredContent.status, "warning");
  assert.match(filteredWarning.text, /完整扫描仍有警告/);
} finally {
  if (previous === undefined) delete process.env.WL_PROJECT_ROOT;
  else process.env.WL_PROJECT_ROOT = previous;
  fs.rmSync(root, { recursive: true, force: true });
}
