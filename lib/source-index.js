"use strict";

/**
 * 统一数据库事实源索引。
 *
 * B31、db-drift 和 Catalog 不能各自猜测契约/迁移目录；优先读取
 * catalog.config.json 中登记的 contractRoots，再回退到兼容旧项目的
 * docs/contracts/db、docs/contracts、contracts 目录。索引只读取显式根，
 * 不把整个工程当作数据库事实源。
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { normalizeRel, resolveWithin, writeJsonAtomic } = require("./manifest");

const DEFAULT_CONTRACT_ROOTS = ["docs/contracts/db", "docs/contracts", "contracts"];
const DEFAULT_MIGRATION_ROOTS = ["src/main/resources/db/migration", "db/migration"];
const CACHE_FILE = ".wl-skills-bd/.state/source-index-cache-v1.json";
const CACHE_ENTRY_LIMIT = 8;
const MEMORY_CACHE_ENTRY_LIMIT = 16;
const MEMORY_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const memoryCache = new Map();
let memoryCacheBytes = 0;

function rememberMemory(key, snapshot, index) {
  const bytes = Buffer.byteLength(JSON.stringify(index), "utf8");
  const previous = memoryCache.get(key);
  if (previous) {
    memoryCacheBytes -= previous.bytes;
    memoryCache.delete(key);
  }
  if (bytes > MEMORY_CACHE_MAX_BYTES) return;
  memoryCache.set(key, { snapshot, index, bytes });
  memoryCacheBytes += bytes;
  while (memoryCache.size > MEMORY_CACHE_ENTRY_LIMIT || memoryCacheBytes > MEMORY_CACHE_MAX_BYTES) {
    const oldest = memoryCache.keys().next().value;
    memoryCacheBytes -= memoryCache.get(oldest).bytes;
    memoryCache.delete(oldest);
  }
}

function readJson(file) {
  try {
    let text = fs.readFileSync(file, "utf8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map((value) => normalizeRel(String(value))))].sort();
}

function catalogContractRoots(projectRoot) {
  const configFile = path.join(projectRoot, ".wl-skills-bd", "catalog.config.json");
  if (!fs.existsSync(configFile)) return { configured: false, roots: [], diagnostics: [] };
  const loaded = readJson(configFile);
  if (!loaded.ok || !loaded.value || !loaded.value.modules || typeof loaded.value.modules !== "object"
    || Array.isArray(loaded.value.modules) || Object.keys(loaded.value.modules).length === 0) {
    return { configured: true, roots: [], diagnostics: [{ severity: "error", code: "SOURCE_CONFIG_INVALID",
      file: ".wl-skills-bd/catalog.config.json", message: loaded.error || "Catalog modules 配置无效" }] };
  }
  const roots = [];
  const diagnostics = [];
  for (const [moduleId, module] of Object.entries(loaded.value.modules)) {
    if (!module || typeof module !== "object" || Array.isArray(module)
      || !Array.isArray(module.contractRoots) || module.contractRoots.length === 0) {
      diagnostics.push({ severity: "error", code: "SOURCE_CONFIG_INVALID",
        file: ".wl-skills-bd/catalog.config.json", message: `模块 ${moduleId} 未登记有效 contractRoots` });
      continue;
    }
    for (const root of module.contractRoots) {
      if (typeof root !== "string" || !root.trim()) {
        diagnostics.push({ severity: "error", code: "SOURCE_CONFIG_INVALID",
          file: ".wl-skills-bd/catalog.config.json", message: `模块 ${moduleId} 的 contractRoots 含无效路径` });
      } else roots.push(root);
    }
  }
  return { configured: true, roots, diagnostics };
}

function walkFiles(projectRoot, roots, predicate, diagnostics = [], requiredRoots = []) {
  const result = [];
  const required = new Set(requiredRoots.map((rel) => normalizeRel(rel)));
  const visit = (absolute, optionalRoot = false) => {
    const rel = normalizeRel(path.relative(projectRoot, absolute));
    let stat;
    try { stat = fs.lstatSync(absolute); } catch (error) {
      if (error.code !== "ENOENT" || !optionalRoot || required.has(rel)) diagnostics.push({ severity: "error", code: "SOURCE_SCAN_INCOMPLETE",
        file: rel, message: `事实源状态读取失败：${error.message}` });
      return;
    }
    if (stat.isSymbolicLink()) {
      diagnostics.push({ severity: "error", code: "SOURCE_SCAN_INCOMPLETE", file: rel, message: "事实源符号链接未跟随" });
      return;
    }
    if (stat.isFile()) {
      if (!predicate || predicate(absolute)) result.push(normalizeRel(path.relative(projectRoot, absolute)));
      return;
    }
    if (!stat.isDirectory()) return;
    let entries;
    try { entries = fs.readdirSync(absolute, { withFileTypes: true }); } catch (error) {
      diagnostics.push({ severity: "error", code: "SOURCE_SCAN_INCOMPLETE", file: rel,
        message: `事实源目录读取失败：${error.message}` });
      return;
    }
    for (const entry of entries) visit(path.join(absolute, entry.name));
  };
  for (const rel of unique(roots)) {
    try { visit(resolveWithin(projectRoot, rel), true); } catch (error) {
      diagnostics.push({ severity: "error", code: "SOURCE_SCAN_INCOMPLETE", file: rel,
        message: `事实源目录无效：${error.message}` });
    }
  }
  return unique(result);
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function snapshotFiles(projectRoot, files, diagnostics = []) {
  const rows = [];
  for (const rel of files) {
    try {
      const file = resolveWithin(projectRoot, rel);
      const stat = fs.statSync(file);
      rows.push([rel, stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs]);
    } catch (error) {
      rows.push([rel, "unreadable", error.code || error.message]);
      diagnostics.push({ severity: "error", code: "SOURCE_SCAN_INCOMPLETE", file: rel,
        message: `事实源文件状态读取失败：${error.message}` });
    }
  }
  return hash(JSON.stringify(rows));
}

function cacheEnabled(projectRoot, options) {
  return options.cache !== false
    && process.env.WL_SKILLS_BD_DISABLE_CACHE !== "1"
    && fs.existsSync(path.join(projectRoot, ".wl-skills-bd"));
}

function cachePath(projectRoot) {
  return resolveWithin(projectRoot, CACHE_FILE);
}

function loadPersistentCache(projectRoot) {
  const file = cachePath(projectRoot);
  if (!fs.existsSync(file)) return { schemaVersion: 1, entries: {} };
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) return { schemaVersion: 1, entries: {} };
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (value.schemaVersion !== 1 || !value.entries || typeof value.entries !== "object") return { schemaVersion: 1, entries: {} };
    return value;
  } catch {
    // 缓存永远不是事实源；损坏时重建，不能让缓存损坏阻断准确扫描。
    return { schemaVersion: 1, entries: {} };
  }
}

function serializeIndex(index) {
  return {
    schemaVersion: index.schemaVersion,
    contractRoots: index.contractRoots,
    migrationRoots: index.migrationRoots,
    contracts: index.contracts.map((entry) => ({
      rel: entry.rel,
      raw: entry.raw,
      table: entry.table,
      fields: [...entry.fields].sort(),
      migrationRoot: entry.migrationRoot,
    })),
    diagnostics: index.diagnostics,
  };
}

function hydrateIndex(projectRoot, value, cacheLevel) {
  return {
    schemaVersion: value.schemaVersion,
    contractRoots: value.contractRoots,
    migrationRoots: value.migrationRoots,
    contracts: value.contracts.map((entry) => ({
      ...entry,
      file: resolveWithin(projectRoot, entry.rel),
      fields: new Set(entry.fields),
    })),
    diagnostics: value.diagnostics || [],
    cache: { level: cacheLevel, hit: cacheLevel !== "miss" },
  };
}

function persistCache(projectRoot, key, snapshot, index) {
  try {
    const cache = loadPersistentCache(projectRoot);
    cache.entries[key] = { snapshot, index: serializeIndex(index), updatedAt: new Date().toISOString() };
    const sorted = Object.entries(cache.entries)
      .sort((left, right) => String(right[1].updatedAt).localeCompare(String(left[1].updatedAt)))
      .slice(0, CACHE_ENTRY_LIMIT);
    cache.entries = Object.fromEntries(sorted);
    writeJsonAtomic(cachePath(projectRoot), cache);
  } catch {
    // 只读文件系统或状态目录异常时退化为内存缓存，扫描结果仍然有效。
  }
}

function contractRoots(projectRoot, options = {}) {
  if (options.contractsRel) return { roots: [options.contractsRel], diagnostics: [], requiredRoots: [options.contractsRel] };
  const configured = catalogContractRoots(projectRoot);
  // 一旦项目登记了 contractRoots，就只信任这些显式事实根；默认目录仅用于
  // 没有 Catalog 的旧项目兼容，避免“配置了局部模块却偷偷全仓扫描”。
  return { roots: unique(configured.configured ? configured.roots : DEFAULT_CONTRACT_ROOTS),
    diagnostics: configured.diagnostics, requiredRoots: configured.configured ? configured.roots : [] };
}

function readContractEntry(projectRoot, rel) {
  const file = resolveWithin(projectRoot, rel);
  const loaded = readJson(file);
  if (!loaded.ok || !loaded.value || typeof loaded.value !== "object") return { rel, file, error: loaded.error || "契约必须是 JSON 对象" };
  const raw = loaded.value;
  // contracts/ 也可能存放集成协议或 API 契约；只有数据库契约候选才参与事实源校验。
  const dbPath = rel === "docs/contracts/db" || rel.startsWith("docs/contracts/db/")
    || rel.includes("/contracts/db/") || path.basename(rel) === "wl-contract.json";
  const dbShape = ["entity", "fields", "database", "migration", "alter"].some((key) =>
    Object.prototype.hasOwnProperty.call(raw, key));
  if (!dbPath && !dbShape) return { rel, file, ignored: true };
  const table = raw.entity && raw.entity.table;
  const fields = Array.isArray(raw.fields)
    ? raw.fields.map((field) => String(field && field.column || "").toLowerCase()).filter(Boolean)
    : [];
  if (!table || fields.length === 0) return { rel, file, raw, error: "缺少 entity.table 或 fields" };
  return {
    rel,
    file,
    raw,
    table: String(table).toLowerCase(),
    fields: new Set(fields),
    migrationRoot: raw.output && raw.output.migration,
  };
}

function buildSourceIndex(projectRoot, options = {}) {
  const selected = contractRoots(projectRoot, options);
  const roots = selected.roots;
  const diagnostics = [...selected.diagnostics];
  const files = walkFiles(projectRoot, roots, (file) => file.toLowerCase().endsWith(".json"), diagnostics, selected.requiredRoots);
  const snapshot = snapshotFiles(projectRoot, files, diagnostics);
  const key = hash(JSON.stringify({ roots, contractsRel: options.contractsRel || null, parserVersion: 2 }));
  const memoryKey = `${path.resolve(projectRoot)}\u0000${key}`;
  const useCache = diagnostics.length === 0 && cacheEnabled(projectRoot, options);
  if (useCache) {
    const memory = memoryCache.get(memoryKey);
    if (memory && memory.snapshot === snapshot) {
      memoryCache.delete(memoryKey);
      memoryCache.set(memoryKey, memory);
      return hydrateIndex(projectRoot, memory.index, "memory");
    }
    const persistent = loadPersistentCache(projectRoot).entries[key];
    if (persistent && persistent.snapshot === snapshot && persistent.index) {
      rememberMemory(memoryKey, snapshot, persistent.index);
      return hydrateIndex(projectRoot, persistent.index, "persistent");
    }
  }
  const entries = [];
  for (const rel of files) {
    const entry = readContractEntry(projectRoot, rel);
    if (entry.ignored) continue;
    if (entry.error) {
      // backend-contract/api.md 等生成协作文件不是原始数据库契约，不应伪装成事实源。
      if (path.basename(rel) === "wl-contract.json" || rel.includes("/contracts/") || rel.startsWith("contracts/")) {
        diagnostics.push({ severity: "error", code: "SOURCE_CONTRACT_INVALID", file: rel, message: entry.error });
      }
      continue;
    }
    entries.push(entry);
  }
  const migrationRoots = options.migrationRel
    ? [options.migrationRel]
    : unique([...entries.map((entry) => entry.migrationRoot), ...DEFAULT_MIGRATION_ROOTS]);
  const index = {
    schemaVersion: 1,
    contractRoots: roots,
    migrationRoots,
    contracts: entries.sort((left, right) => left.rel.localeCompare(right.rel)),
    diagnostics,
    cache: { level: "miss", hit: false },
  };
  if (useCache && diagnostics.length === 0) {
    const serialized = serializeIndex(index);
    rememberMemory(memoryKey, snapshot, serialized);
    persistCache(projectRoot, key, snapshot, index);
  }
  return index;
}

function collectContractTables(projectRoot, options = {}) {
  const index = buildSourceIndex(projectRoot, options);
  const tables = new Map();
  for (const entry of index.contracts) {
    if (!tables.has(entry.table)) tables.set(entry.table, new Set());
    for (const field of entry.fields) tables.get(entry.table).add(field);
  }
  return { tables, index };
}

function clearSourceIndexMemoryCache() {
  memoryCache.clear();
  memoryCacheBytes = 0;
}

function sourceIndexMemoryCacheStats() {
  return { entries: memoryCache.size, bytes: memoryCacheBytes, maxBytes: MEMORY_CACHE_MAX_BYTES };
}

module.exports = {
  CACHE_FILE,
  DEFAULT_CONTRACT_ROOTS,
  DEFAULT_MIGRATION_ROOTS,
  buildSourceIndex,
  clearSourceIndexMemoryCache,
  collectContractTables,
  sourceIndexMemoryCacheStats,
  walkFiles,
};
