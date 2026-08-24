"use strict";

/**
 * MCP 统一结果预算与短期游标存储。
 *
 * 所有工具都经过同一层限制 text/structuredContent；大结果保留在 MCP 进程内，
 * 用 response.cursor 分块续取，避免每次重跑工具或把完整正文塞入模型上下文。
 */

const crypto = require("crypto");

const DEFAULT_MAX_ITEMS = 20;
const DEFAULT_MAX_BYTES = 20_000;
const MAX_STORED_RESULTS = 32;
const MAX_STORED_BYTES = 8 * 1024 * 1024;
const RESULT_TTL_MS = 5 * 60 * 1000;
const CURSOR_PATTERN = "^[a-f0-9]{32}:[0-9]+$";

const RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    mode: { type: "string", enum: ["summary", "compact", "full"], description: "统一输出模式；默认 summary" },
    maxItems: { type: "integer", minimum: 1, maximum: 500, description: "任一数组最多返回项数，默认 20" },
    maxBytes: { type: "integer", minimum: 4096, maximum: 200000, description: "text + structuredContent 总字节预算，默认 20000" },
    cursor: { type: "string", pattern: CURSOR_PATTERN, description: "大结果续取游标；续取时无需重新执行工具" },
  },
  additionalProperties: false,
});

const resultStore = new Map();

function byteLength(value) {
  return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8");
}

function trimStore() {
  const now = Date.now();
  for (const [id, entry] of resultStore) if (entry.expiresAt <= now) resultStore.delete(id);
  while (resultStore.size >= MAX_STORED_RESULTS) resultStore.delete(resultStore.keys().next().value);
}

function putResult(toolName, result) {
  trimStore();
  const id = crypto.randomBytes(16).toString("hex");
  const original = Buffer.from(JSON.stringify(result), "utf8");
  const complete = original.length <= MAX_STORED_BYTES;
  const data = complete ? original : original.subarray(0, MAX_STORED_BYTES);
  resultStore.set(id, { toolName, data, complete, expiresAt: Date.now() + RESULT_TTL_MS });
  return { cursor: `${id}:0`, bytes: data.length, complete };
}

function parseCursor(cursor) {
  const match = String(cursor || "").match(/^([a-f0-9]{32}):(\d+)$/);
  return match ? { id: match[1], offset: Number(match[2]) } : null;
}

function readCursor(toolName, cursor, maxBytes = DEFAULT_MAX_BYTES) {
  trimStore();
  const parsed = parseCursor(cursor);
  const entry = parsed && resultStore.get(parsed.id);
  if (!entry || entry.toolName !== toolName || !Number.isSafeInteger(parsed.offset) || parsed.offset < 0 || parsed.offset >= entry.data.length) {
    return {
      text: "❌ 结果游标无效或已过期，请重新执行原工具",
      structuredContent: { ok: false, state: "cursor-invalid", response: { cursorExpired: true } },
      isError: true,
    };
  }
  const budget = Math.max(4096, Math.min(Number(maxBytes) || DEFAULT_MAX_BYTES, 200000));
  let end = Math.min(entry.data.length, parsed.offset + Math.max(1024, budget - 1024));
  while (end < entry.data.length && end > parsed.offset && (entry.data[end] & 0xc0) === 0x80) end -= 1;
  const chunk = entry.data.subarray(parsed.offset, end).toString("utf8");
  const nextCursor = end < entry.data.length ? `${parsed.id}:${end}` : null;
  if (!nextCursor) resultStore.delete(parsed.id);
  return {
    text: chunk,
    structuredContent: {
      ok: true,
      state: nextCursor ? "result-page" : "result-complete",
      response: {
        chunkOffset: parsed.offset,
        chunkBytes: byteLength(chunk),
        totalBytes: entry.data.length,
        nextCursor,
        storedComplete: entry.complete,
        estimatedTokens: Math.ceil(byteLength(chunk) / 4),
      },
    },
  };
}

function truncateUtf8(value, limit) {
  if (byteLength(value) <= limit) return value;
  let output = Buffer.from(value, "utf8").subarray(0, Math.max(0, limit - 16)).toString("utf8");
  if (output.endsWith("�")) output = output.slice(0, -1);
  return `${output}…[truncated]`;
}

function compactValue(value, controls, state, depth = 0) {
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const stringLimit = controls.mode === "full"
      ? controls.maxBytes
      : controls.mode === "compact" ? Math.min(8192, controls.maxBytes / 2) : Math.min(2048, controls.maxBytes / 4);
    const next = truncateUtf8(value, Math.floor(stringLimit));
    if (next !== value) state.truncated = true;
    return next;
  }
  if (Array.isArray(value)) {
    const selected = value.slice(0, controls.maxItems);
    if (selected.length < value.length) state.truncated = true;
    return selected.map((item) => compactValue(item, controls, state, depth + 1));
  }
  if (typeof value === "object") {
    if (depth > 12) {
      state.truncated = true;
      return "[depth-limited]";
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, compactValue(item, controls, state, depth + 1)]));
  }
  return String(value);
}

function scalarSummary(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  const preferred = new Set(["ok", "state", "mode", "status", "reason", "planHash", "contractId", "module", "error", "warn", "total", "issueCount", "scenarioCount", "durationMs"]);
  for (const [key, item] of Object.entries(value)) {
    if (preferred.has(key) && (item === null || ["string", "number", "boolean"].includes(typeof item))) output[key] = item;
  }
  for (const key of ["summary", "stats", "coverage", "selection", "features"]) {
    if (value[key] && typeof value[key] === "object") output[key] = value[key];
  }
  return output;
}

function normalizeControls(response = {}) {
  return {
    mode: response.mode || "summary",
    maxItems: Math.max(1, Math.min(Number(response.maxItems) || DEFAULT_MAX_ITEMS, 500)),
    maxBytes: Math.max(4096, Math.min(Number(response.maxBytes) || DEFAULT_MAX_BYTES, 200000)),
  };
}

function applyResultBudget(toolName, response, result) {
  const controls = normalizeControls(response);
  const original = typeof result === "string" ? { text: result } : result;
  const beforeBytes = byteLength({ text: original.text || "", structuredContent: original.structuredContent || {} });
  const state = { truncated: false };
  let text = compactValue(String(original.text || ""), controls, state);
  let structuredContent = compactValue(original.structuredContent || {}, controls, state);
  let returnedBytes = byteLength({ text, structuredContent });
  let stored;
  if (state.truncated || returnedBytes > controls.maxBytes) {
    stored = putResult(toolName, original);
    if (returnedBytes > controls.maxBytes) {
      state.truncated = true;
      text = truncateUtf8(text, Math.floor(controls.maxBytes * 0.55));
      structuredContent = scalarSummary(structuredContent);
    }
  }
  const responseMeta = {
    mode: controls.mode,
    maxItems: controls.maxItems,
    maxBytes: controls.maxBytes,
    originalBytes: beforeBytes,
    truncated: state.truncated,
    nextCursor: stored ? stored.cursor : null,
    storedBytes: stored ? stored.bytes : 0,
    storedComplete: stored ? stored.complete : true,
  };
  structuredContent = { ...structuredContent, response: responseMeta };
  returnedBytes = byteLength({ text, structuredContent });
  if (returnedBytes > controls.maxBytes) {
    if (!stored) {
      stored = putResult(toolName, original);
      responseMeta.truncated = true;
      responseMeta.nextCursor = stored.cursor;
      responseMeta.storedBytes = stored.bytes;
      responseMeta.storedComplete = stored.complete;
    }
    text = truncateUtf8(text, Math.max(512, controls.maxBytes - byteLength(structuredContent) - 512));
    returnedBytes = byteLength({ text, structuredContent });
  }
  responseMeta.returnedBytes = 0;
  responseMeta.estimatedTokens = 0;
  for (let index = 0; index < 3; index += 1) {
    returnedBytes = byteLength({ text, structuredContent });
    responseMeta.returnedBytes = returnedBytes;
    responseMeta.estimatedTokens = Math.ceil(returnedBytes / 4);
  }
  return { text, structuredContent, ...(original.isError ? { isError: true } : {}) };
}

function withResponseControls(tool) {
  const original = tool.inputSchema || { type: "object", properties: {}, additionalProperties: false };
  const required = original.required || [];
  const inputSchema = {
    ...original,
    properties: { ...(original.properties || {}), response: RESPONSE_SCHEMA },
  };
  if (required.length > 0) {
    delete inputSchema.required;
    inputSchema.anyOf = [
      { type: "object", required },
      {
        type: "object",
        required: ["response"],
        properties: { response: { type: "object", required: ["cursor"] } },
      },
    ];
  }
  return {
    ...tool,
    description: `${tool.description} 所有响应统一支持 response.mode/maxItems/maxBytes；大结果用 response.cursor 续取。`,
    inputSchema,
  };
}

function clearResultStore() {
  resultStore.clear();
}

module.exports = {
  RESPONSE_SCHEMA,
  applyResultBudget,
  clearResultStore,
  normalizeControls,
  readCursor,
  withResponseControls,
};
