"use strict";

const assert = require("assert");
const path = require("path");
const { spawnSync } = require("child_process");

const server = path.resolve(__dirname, "..", "mcp", "server.js");
const messages = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
  { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "wls_be_standards", arguments: { id: "04" } } },
  { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "wls_be_codegen", arguments: { mode: "bad", contract: "x" } } },
];
const result = spawnSync(process.execPath, [server], {
  cwd: path.resolve(__dirname, ".."),
  env: { ...process.env, WL_PROJECT_ROOT: path.resolve(__dirname, "..") },
  input: `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`,
  encoding: "utf8",
  timeout: 15000,
  windowsHide: true,
});
assert.strictEqual(result.status, 0, result.stderr);
const responses = result.stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
assert.strictEqual(responses.length, 4, result.stdout);
const byId = new Map(responses.map((response) => [response.id, response]));
assert.strictEqual(byId.get(1).result.serverInfo.name, "wl-skills-bd");
assert.strictEqual(byId.get(1).result.protocolVersion, "2025-06-18");
assert.strictEqual(byId.get(2).result.tools.length, 15);
assert.match(byId.get(3).result.content[0].text, /^# 04/m);
assert.strictEqual(byId.get(4).error.code, -32602);

console.log("✅ MCP server：initialize、15 tools/list、tools/call 与严格参数错误通过");
