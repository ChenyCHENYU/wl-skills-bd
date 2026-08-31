"use strict";

const assert = require("assert");
const { HANDLERS, TOOLS } = require("../mcp/registry");
const { applyResultBudget, clearResultStore, readCursor } = require("../mcp/result-budget");
const { validateSchema } = require("../mcp/schema-validator");

clearResultStore();
for (const tool of TOOLS) {
  assert.ok(tool.inputSchema.properties.response, `${tool.name} 必须支持统一 response 预算`);
  assert.match(tool.description, /response\.mode/);
}

const codegenSchema = HANDLERS.wls_be_codegen.inputSchema;
assert.strictEqual(validateSchema(codegenSchema, { response: { cursor: `${"a".repeat(32)}:0` } }).valid, true, "游标续取不应要求重复原始入参");
assert.strictEqual(validateSchema(codegenSchema, { response: { maxBytes: 4096 } }).valid, false, "首次调用仍必须满足工具原始必填参数");

const original = {
  text: "x".repeat(30000),
  structuredContent: { ok: true, rows: Array.from({ length: 100 }, (_, id) => ({ id, body: "y".repeat(1000) })) },
};
const budgeted = applyResultBudget("wls_be_standards", { mode: "summary", maxItems: 5, maxBytes: 6000 }, original);
const encoded = JSON.stringify({ text: budgeted.text, structuredContent: budgeted.structuredContent });
assert.ok(Buffer.byteLength(encoded, "utf8") <= 6000, "统一预算不得超出 maxBytes");
assert.strictEqual(budgeted.structuredContent.response.truncated, true);
assert.match(budgeted.structuredContent.response.nextCursor, /^[a-f0-9]{32}:0$/);
assert.ok(budgeted.structuredContent.response.estimatedTokens <= 1500);

let cursor = budgeted.structuredContent.response.nextCursor;
let chunks = "";
while (cursor) {
  const page = readCursor("wls_be_standards", cursor, 4096);
  assert.strictEqual(page.structuredContent.ok, true);
  chunks += page.text;
  cursor = page.structuredContent.response.nextCursor;
}
assert.ok(chunks.includes("structuredContent"), "游标必须可续取原始结构化结果");
const expired = readCursor("wls_be_standards", `${"f".repeat(32)}:0`, 4096);
assert.strictEqual(expired.isError, true);

console.log("✅ MCP budget：17 工具统一预算、token 估算、输入兼容、大结果游标与过期阻断通过");
