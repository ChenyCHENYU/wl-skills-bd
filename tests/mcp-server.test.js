// MCP 协议冒烟测试：initialize + tools/list + tools/call(validate)
const { spawn } = require("child_process");
const path = require("path");

const server = spawn("node", [path.join(__dirname, "..", "mcp", "server.js")], {
  cwd: path.join(__dirname, ".."),
  env: { ...process.env, WL_PROJECT_ROOT: path.join(__dirname, "..") },
});

let buf = "";
const results = [];
server.stdout.on("data", (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (line.trim()) {
      try { results.push(JSON.parse(line)); } catch {}
    }
  }
});

function send(msg) {
  server.stdin.write(JSON.stringify(msg) + "\n");
}

setTimeout(() => {
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "wls_be_validate", arguments: {} } });
}, 200);

setTimeout(() => {
  server.kill();
  for (const r of results) {
    if (r.id === 1) console.log("initialize:", r.result.serverInfo.name, r.result.serverInfo.version);
    if (r.id === 2) console.log("tools/list:", r.result.tools.map(t => t.name).join(", "));
    if (r.id === 3) {
      const sc = r.result.structuredContent || {};
      console.log("validate result:", `ok=${sc.ok} error=${sc.error} warn=${sc.warn} total=${sc.total}`);
    }
  }
  if (results.length < 3) console.log("⚠️ 只收到", results.length, "条响应（期望3）");
  else console.log("✅ MCP 协议三工具全部响应正常");
}, 2000);
