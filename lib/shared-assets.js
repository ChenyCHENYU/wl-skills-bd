"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SHARED_MARKDOWN = new Set([
  "AGENTS.md", "CLAUDE.md", ".github/copilot-instructions.md",
  ".github/skills/_registry.md", ".github/skills/_pipeline.md",
  ".github/standards/index.md", ".github/guides/architecture.md", ".github/guides/usage.md",
]);

function hash(value) {
  return crypto.createHash("sha256").update(String(value).replace(/\r\n/g, "\n")).digest("hex");
}

function preflight(root, rel) {
  const base = path.resolve(root);
  const file = path.resolve(base, rel);
  if (!rel || path.isAbsolute(rel) || file === base || !file.startsWith(base + path.sep)) throw new Error(`非法目标路径：${rel}`);
  let current = base;
  const parts = path.relative(base, file).split(path.sep);
  for (let index = 0; index <= parts.length; index += 1) {
    if (fs.existsSync(current) || (() => { try { fs.lstatSync(current); return true; } catch { return false; } })()) {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) throw new Error(`目标包含符号链接：${rel}`);
      if (index === parts.length ? !stat.isFile() : !stat.isDirectory()) throw new Error(`目标路径类型不正确：${rel}`);
    }
    if (index < parts.length) current = path.join(current, parts[index]);
  }
  return file;
}

function block(text, owner) {
  const begin = `<!-- ${owner}:begin -->`;
  const end = `<!-- ${owner}:end -->`;
  const starts = [...text.matchAll(new RegExp(begin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))];
  const ends = [...text.matchAll(new RegExp(end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))];
  if (!starts.length && !ends.length) return null;
  if (starts.length !== 1 || ends.length !== 1 || ends[0].index < starts[0].index) throw new Error(`受管区块标记损坏：${owner}`);
  const start = starts[0].index;
  let finish = ends[0].index + end.length;
  if ((start && text[start - 1] !== "\n") || (text[finish] && !/^[\r\n]/.test(text[finish]))) throw new Error(`受管区块标记必须独占一行：${owner}`);
  if (text.slice(finish, finish + 2) === "\r\n") finish += 2;
  else if (text[finish] === "\n") finish += 1;
  return { start, end: finish, text: text.slice(start, finish) };
}

function renderBlock(source, owner, eol = "\n") {
  return `<!-- ${owner}:begin -->\n${source.replace(/\r\n/g, "\n").replace(/\n*$/, "\n")}<!-- ${owner}:end -->\n`.replace(/\n/g, eol);
}

function planMarkdown(current, source, old, owner, force = false) {
  const part = block(current || "", owner);
  const eol = current?.includes("\r\n") ? "\r\n" : "\n";
  const value = renderBlock(source, owner, eol);
  const record = { kind: "block", installedHash: hash(value), sourceHash: hash(source), prefix: old?.prefix || "",
    createdFile: current === null || (old?.kind === "block" && old.createdFile === true) };
  if (part) {
    if (!old || old.kind === "reference") {
      if (hash(part.text) === hash(value)) return { content: current, record: { kind: "reference", installedHash: hash(part.text), scope: "block" } };
      throw new Error("已有区块不属于本包安装记录");
    }
    if (hash(part.text) !== old.installedHash && !force) throw new Error("本包受管区块有本地改动");
    return { content: current.slice(0, part.start) + value + current.slice(part.end), record };
  }
  if (old?.kind === "block" && !force) throw new Error("本包受管区块已被本地移除");
  const legacyHash = current === null ? null : crypto.createHash("sha256").update(current).digest("hex");
  if (current !== null && old && old.kind !== "reference" && old.kind !== "block" && [hash(current), legacyHash].includes(old.installedHash)) {
    return { content: value, record: { ...record, prefix: "" } };
  }
  if (current !== null && hash(current) === hash(source)) return { content: current, record: { kind: "reference", scope: "file", installedHash: hash(current) } };
  const prefix = current && !current.endsWith("\n") ? eol : "";
  return { content: (current || "") + prefix + value, record: { ...record, prefix } };
}

function removeMarkdown(current, old, owner) {
  if (old.kind === "reference") return { content: current, preserved: true };
  const part = block(current, owner);
  if (old.kind !== "block") return { content: current, preserved: true };
  if (!part || hash(part.text) !== old.installedHash) return { content: current, preserved: true };
  let start = part.start;
  if (old.prefix && current.slice(start - old.prefix.length, start) === old.prefix) start -= old.prefix.length;
  return { content: current.slice(0, start) + current.slice(part.end), preserved: false, keepFile: old.createdFile !== true };
}

const { parseJsonc, getJsoncValue, getJsoncNodeText, setJsoncValue } = require("./shared-jsonc.cjs");
function valueHash(value) {
  const stable = (item) => Array.isArray(item) ? item.map(stable) : item && typeof item === "object"
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, stable(item[key])])) : item;
  return hash(JSON.stringify(stable(value)));
}

function planMcp(current, source, old, owner, force = false) {
  const input = parseJsonc(source);
  const container = Object.keys(input).find((key) => ["servers", "mcpServers"].includes(key));
  if (!container || !input[container] || typeof input[container] !== "object" || Array.isArray(input[container])) throw new Error("MCP 模板缺少 servers/mcpServers");
  const keys = Object.keys(input[container]);
  if (keys.some((key) => key !== owner)) throw new Error("MCP 模板只能声明本包服务");
  const server = input[container][owner];
  let content = current === null ? "{}\n" : current;
  const tree = parseJsonc(content);
  const target = tree[container];
  if (target !== undefined && (!target || typeof target !== "object" || Array.isArray(target))) throw new Error("MCP 服务容器必须为对象");
  const existing = getJsoncValue(content, [container, owner]);
  const existingText = getJsoncNodeText(content, [container, owner]);
  const expected = valueHash(server);
  const legacy = old && !["mcp", "reference"].includes(old.kind) && hash(current) === old.installedHash;
  if (existing !== undefined && !legacy && (!old || old.kind !== "mcp" || (!old.installedTextHash && /\/\/|\/\*/.test(existingText)))) {
    if (valueHash(existing) === expected) return { content, record: { kind: "reference", scope: "mcp", container: container, installedHash: expected, installedTextHash: hash(existingText) } };
    throw new Error("同名 MCP 服务不属于本包安装记录");
  }
  if (existing !== undefined && !legacy && old?.kind === "mcp"
    && (valueHash(existing) !== old.installedHash || (old.installedTextHash && hash(existingText) !== old.installedTextHash)) && !force) throw new Error("本包 MCP 服务有本地改动");
  // Unchanged values need no edit: preserve user formatting and internal comments.
  if (existing === undefined || valueHash(existing) !== expected) content = setJsoncValue(content, [container, owner], server);
  parseJsonc(content);
  const nodeText = getJsoncNodeText(content, [container, owner]);
  return { content, record: { kind: "mcp", container: container, installedHash: expected,
    installedTextHash: existing !== undefined && valueHash(existing) === expected && old?.installedTextHash ? old.installedTextHash : hash(nodeText),
    sourceHash: hash(source), createdFile: old?.createdFile ?? current === null } };
}

function removeMcp(current, old, owner) {
  if (old.kind !== "mcp") return { content: current, preserved: true };
  const server = getJsoncValue(current, [old.container, owner]);
  if (server === undefined || valueHash(server) !== old.installedHash) return { content: current, preserved: true };
  const nodeText = getJsoncNodeText(current, [old.container, owner]);
  if (old.installedTextHash ? hash(nodeText) !== old.installedTextHash : /\/\/|\/\*/.test(nodeText)) return { content: current, preserved: true };
  const content = setJsoncValue(current, [old.container, owner], undefined);
  parseJsonc(content);
  // A previously existing config, including its comments and empty containers,
  // remains on disk. Only a config created by this installation may be removed.
  const remainder = parseJsonc(content);
  const empty = Object.keys(remainder).every((key) => ["servers", "mcpServers"].includes(key) && Object.keys(remainder[key]).length === 0);
  return { content: old.createdFile && empty && !/\/\/|\/\*/.test(content) ? "" : content, preserved: false };
}

function contributionHash(current, old, owner) {
  if (old.kind === "block" || (old.kind === "reference" && old.scope === "block")) return hash(block(current, owner)?.text || "");
  if (old.kind === "mcp" || (old.kind === "reference" && old.scope === "mcp")) {
    const server = getJsoncValue(current, [old.container, owner]);
    return server === undefined ? null : valueHash(server);
  }
  return hash(current);
}

function contributionModified(current, old, owner) {
  if (contributionHash(current, old, owner) !== old.installedHash) return true;
  if ((old.kind === "mcp" || old.scope === "mcp") && old.installedTextHash) {
    const nodeText = getJsoncNodeText(current, [old.container, owner]);
    return nodeText === undefined || hash(nodeText) !== old.installedTextHash;
  }
  return false;
}

module.exports = { SHARED_MARKDOWN, block, contributionHash, contributionModified, hash, parseJsonc, planMarkdown, planMcp, preflight, removeMarkdown, removeMcp };
