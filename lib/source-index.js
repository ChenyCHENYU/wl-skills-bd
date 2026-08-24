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
const { normalizeRel, resolveWithin } = require("./manifest");

const DEFAULT_CONTRACT_ROOTS = ["docs/contracts/db", "docs/contracts", "contracts"];
const DEFAULT_MIGRATION_ROOTS = ["src/main/resources/db/migration", "db/migration"];

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
  if (!fs.existsSync(configFile)) return [];
  const loaded = readJson(configFile);
  if (!loaded.ok || !loaded.value || !loaded.value.modules) return [];
  return Object.values(loaded.value.modules).flatMap((module) => Array.isArray(module.contractRoots) ? module.contractRoots : []);
}

function walkFiles(projectRoot, roots, predicate) {
  const result = [];
  const visit = (absolute) => {
    if (!fs.existsSync(absolute)) return;
    let stat;
    try { stat = fs.lstatSync(absolute); } catch { return; }
    if (stat.isSymbolicLink()) return;
    if (stat.isFile()) {
      if (!predicate || predicate(absolute)) result.push(normalizeRel(path.relative(projectRoot, absolute)));
      return;
    }
    if (!stat.isDirectory()) return;
    let entries;
    try { entries = fs.readdirSync(absolute, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) visit(path.join(absolute, entry.name));
  };
  for (const rel of unique(roots)) {
    try { visit(resolveWithin(projectRoot, rel)); } catch { /* invalid configured root is handled by Catalog */ }
  }
  return unique(result);
}

function contractRoots(projectRoot, options = {}) {
  if (options.contractsRel) return [options.contractsRel];
  const configured = catalogContractRoots(projectRoot);
  // 一旦项目登记了 contractRoots，就只信任这些显式事实根；默认目录仅用于
  // 没有 Catalog 的旧项目兼容，避免“配置了局部模块却偷偷全仓扫描”。
  return unique(configured.length > 0 ? configured : DEFAULT_CONTRACT_ROOTS);
}

function readContractEntry(projectRoot, rel) {
  const file = resolveWithin(projectRoot, rel);
  const loaded = readJson(file);
  if (!loaded.ok || !loaded.value || typeof loaded.value !== "object") return { rel, file, error: loaded.error || "契约必须是 JSON 对象" };
  const raw = loaded.value;
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
  const files = walkFiles(projectRoot, contractRoots(projectRoot, options), (file) => file.toLowerCase().endsWith(".json"));
  const entries = [];
  const diagnostics = [];
  for (const rel of files) {
    const entry = readContractEntry(projectRoot, rel);
    if (entry.error) {
      // backend-contract/api.md 等生成协作文件不是原始数据库契约，不应伪装成事实源。
      if (path.basename(rel) === "wl-contract.json" || rel.includes("/contracts/") || rel.startsWith("contracts/")) {
        diagnostics.push({ severity: "warn", code: "SOURCE_CONTRACT_INVALID", file: rel, message: entry.error });
      }
      continue;
    }
    entries.push(entry);
  }
  const migrationRoots = options.migrationRel
    ? [options.migrationRel]
    : unique([...entries.map((entry) => entry.migrationRoot), ...DEFAULT_MIGRATION_ROOTS]);
  return {
    schemaVersion: 1,
    contractRoots: contractRoots(projectRoot, options),
    migrationRoots,
    contracts: entries.sort((left, right) => left.rel.localeCompare(right.rel)),
    diagnostics,
  };
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

module.exports = {
  DEFAULT_CONTRACT_ROOTS,
  DEFAULT_MIGRATION_ROOTS,
  buildSourceIndex,
  collectContractTables,
  walkFiles,
};
