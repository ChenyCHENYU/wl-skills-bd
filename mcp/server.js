#!/usr/bin/env node
"use strict";

/**
 * wl-skills-bd MCP Server
 *
 * 实现 MCP 协议（stdio transport，JSON-RPC 2.0），对标 wl-skills-kit/mcp/server.js。
 * 后端精简版：无需网关/token（无菜单字典同步），核心是暴露 be-rules / audit 工具。
 *
 * 启动（由 .cursor/mcp.json 等编辑器配置注入）：
 *   node node_modules/@agile-team/wl-skills-bd/mcp/server.js
 */

const readline = require("readline");
const { TOOLS, HANDLERS } = require("./registry");
const { validateSchema } = require("./schema-validator");
const PKG = require("../package.json");

const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];

// ─── JSON-RPC 协议层 ────────────────────────────────────────────────────

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

// ─── Tool 调度 ──────────────────────────────────────────────────────────

async function dispatchTool(id, toolName, toolArgs) {
  const desc = HANDLERS[toolName];
  if (!desc) {
    sendError(id, -32601, `未知工具: ${toolName}`);
    return;
  }

  const validation = validateSchema(desc.inputSchema, toolArgs);
  if (!validation.valid) {
    sendError(id, -32602, `参数校验失败: ${validation.errors.join("；")}`);
    return;
  }

  try {
    const handlerResult = await desc.handle(toolArgs);
    const normalized =
      typeof handlerResult === "string" ? { text: handlerResult } : handlerResult;
    sendResult(id, {
      content: [{ type: "text", text: normalized.text }],
      ...(normalized.structuredContent
        ? { structuredContent: normalized.structuredContent }
        : {}),
      ...(normalized.isError ? { isError: true } : {}),
    });
  } catch (e) {
    sendResult(id, {
      content: [{ type: "text", text: `❌ 工具执行异常: ${e.message}` }],
      isError: true,
    });
  }
}

// ─── 消息循环 ────────────────────────────────────────────────────────────

function parseMessage(line) {
  const raw = line.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    send({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
    return null;
  }
}

function initialize(id, params) {
  const requestedVersion = params.protocolVersion;
  const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)
    ? requestedVersion
    : SUPPORTED_PROTOCOL_VERSIONS[0];
  sendResult(id, {
    protocolVersion,
    capabilities: { tools: {} },
    serverInfo: { name: "wl-skills-bd", version: PKG.version },
    instructions:
      "后端规范检查工具。wls_be_validate 扫描 Java 工程输出 B1~B8 偏差；wls_be_standards 查询规范条款；wls_be_templates 查代码模板占位符。",
  });
}

async function handleMessage(msg) {
  const { id, method, params = {} } = msg;
  if (id === undefined || id === null) return;
  if (method === "initialize") return initialize(id, params);
  if (method === "notifications/initialized") return; // ack，无需响应
  if (method === "tools/list") return sendResult(id, { tools: TOOLS });
  if (method === "tools/call")
    return dispatchTool(id, params.name, params.arguments || {});
  if (method === "ping") return sendResult(id, {});
  return sendError(id, -32601, `Method not found: ${method}`);
}

function startServer() {
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });
  rl.on("line", async (line) => {
    const msg = parseMessage(line);
    if (msg) await handleMessage(msg);
  });
  rl.on("close", () => process.exit(0));
}

if (require.main === module) {
  printBanner();
  startServer();
}

function printBanner() {
  const projectRoot = process.env.WL_PROJECT_ROOT || process.cwd();
  const lines = [
    "",
    "═══════════════════════════════════════════════════",
    `  wl-skills-bd MCP Server v${PKG.version}`,
    "═══════════════════════════════════════════════════",
    `  项目根 (WL_PROJECT_ROOT): ${projectRoot}`,
    `  已注册工具 (${TOOLS.length}):`,
    ...TOOLS.map((t) => `    • ${t.name} — ${t.description.split("\n")[0]}`),
    "═══════════════════════════════════════════════════",
    "",
  ];
  process.stderr.write(lines.join("\n") + "\n");
}

module.exports = {
  TOOLS,
  HANDLERS,
  dispatchTool,
  handleMessage,
  parseMessage,
  startServer,
};
