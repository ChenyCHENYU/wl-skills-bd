"use strict";

/**
 * db-drift：线上库结构 ↔ 契约/Flyway 的漂移检测 + DDL 执行账本
 *
 * 背景：2026-08-20 事故——pl_slab_main 被现场直接 ALTER 加 4 列、pl_fin_plan
 * 无主出现在库里，均绕过 codegen/Flyway/审批，仅靠人工 CHANGELOG 事后发现。
 *
 * 闭环设计：
 * - `db drift --snapshot <file>`：对账“DBA 导出的结构快照” vs 契约 + 迁移推导结构
 *   · 库有、契约+迁移+账本都没有 → error（无源变更，直接改库）
 *   · 库缺、契约有 → error（迁移未执行/漏建）
 * - `db executed`：把已审批执行的 DDL 记入 ddl-ledger（带 planHash/审批单），
 *   drift 检测时对账本内变更放行并标“已审批”。
 *
 * 本模块不连接数据库：快照由 DBA/只读账号导出（安全边界与包一致：DDL 只生成不执行）。
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { writeJsonAtomic } = require("./manifest");
const sourceIndex = require("./source-index");

const LEDGER_FILE = ".wl-skills-bd/.state/ddl-ledger.json";

function readJsonIfExists(file) {
  try {
    let text = fs.readFileSync(file, "utf8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function normalizeRel(rel) {
  return rel.split(path.sep).join("/");
}

/**
 * 解析结构快照。兼容 columns:["id"]；推荐 columns:[{name,ordinal,dbType,nullable,defaultValue,comment}]。
 */
function loadSnapshot(file) {
  const parsed = readJsonIfExists(file);
  if (!parsed) return { ok: false, errors: [`快照文件不存在或不是合法 JSON：${file}`], tables: new Map() };
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed.tables) ? parsed.tables : null;
  if (!rows) return { ok: false, errors: ["快照格式：顶层数组或 {tables:[{name,columns:[...]}]}"], tables: new Map() };
  const tables = new Map();
  for (const row of rows) {
    const name = row.table || row.name;
    if (!name || !Array.isArray(row.columns)) continue;
    const fields = row.columns.map((column, index) => {
      const object = column && typeof column === "object" ? column : {};
      const fieldName = String(object.name || object.column || column).trim();
      return {
        name: fieldName,
        key: fieldName.toLowerCase(),
        ordinal: Number.isInteger(object.ordinal) ? object.ordinal : index + 1,
        dbType: object.dbType || object.type,
        nullable: typeof object.nullable === "boolean" ? object.nullable : undefined,
        defaultValue: Object.prototype.hasOwnProperty.call(object, "defaultValue") ? object.defaultValue : object.default,
        comment: object.comment,
      };
    });
    tables.set(String(name).toLowerCase(), {
      name: String(name),
      comment: row.comment,
      columns: new Set(fields.map((field) => field.key)),
      fields,
    });
  }
  return { ok: true, errors: [], tables };
}

// 从统一 Source Index 汇聚表->字段集，避免模块配置存在时全仓猜事实源。
function collectFromContracts(projectRoot, contractsRel) {
  return sourceIndex.collectContractTables(projectRoot, contractsRel ? { contractsRel } : {}).tables;
}

/** 粗粒度迁移推导：从 db/migration/**.sql 提取 CREATE TABLE 表名与 ADD COLUMN 列 */
function collectFromMigrations(projectRoot, migrationRel) {
  const index = sourceIndex.buildSourceIndex(projectRoot, migrationRel ? { migrationRel } : {});
  const roots = migrationRel ? [migrationRel] : index.migrationRoots;
  const tables = new Map();
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.toLowerCase().endsWith(".sql")) continue;
      const sql = fs.readFileSync(full, "utf8");
      for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?[`\[]?([\w$]+)[`\]]?/gi)) {
        const t = m[1].toLowerCase();
        if (!tables.has(t)) tables.set(t, new Set());
      }
      for (const m of sql.matchAll(/alter\s+table\s+[`\[]?([\w$]+)[`\]]?\s+add\s+(?:column\s+)?[`\[]?([\w$]+)[`\]]?/gi)) {
        const t = m[1].toLowerCase();
        if (!tables.has(t)) tables.set(t, new Set());
        tables.get(t).add(m[2].toLowerCase());
      }
    }
  };
  for (const rel of roots) {
    try { walk(path.resolve(projectRoot, rel)); } catch { /* Catalog 报告非法根 */ }
  }
  return tables;
}

/** DDL 执行账本 */
function loadLedger(projectRoot) {
  const file = path.join(projectRoot, LEDGER_FILE);
  const parsed = readJsonIfExists(file);
  if (!parsed || !Array.isArray(parsed.executed)) return { executed: [], file, corrupt: fs.existsSync(file) };
  return { executed: parsed.executed, file, corrupt: false };
}

function receiptId(entry) {
  return crypto.createHash("sha256").update(JSON.stringify({
    table: String(entry.table || "").toLowerCase(),
    column: entry.column ? String(entry.column).toLowerCase() : null,
    scope: entry.scope || (entry.column ? "column" : "table"),
    planHash: entry.planHash,
    migrationHash: entry.migrationHash,
    approvalRef: entry.approvalRef,
    sourceRef: entry.sourceRef,
  })).digest("hex");
}

function validateLedgerEntry(entry, options = {}) {
  const errors = [];
  const hash = (value, label) => {
    if (!/^[a-f0-9]{64}$/.test(String(value || ""))) errors.push(`${label} 必须是 64 位 SHA-256 十六进制值`);
  };
  if (!entry || typeof entry !== "object") return { ok: false, errors: ["receipt 必须是对象"] };
  if (!String(entry.table || "").trim()) errors.push("table 必填");
  if (!String(entry.sourceRef || "").match(/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,127}$/)) errors.push("sourceRef 格式非法");
  if (!String(entry.approvalRef || "").match(/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,127}$/)) errors.push("approvalRef 格式非法");
  hash(entry.planHash, "planHash");
  hash(entry.migrationHash, "migrationHash");
  if (!entry.expiresAt || !Number.isFinite(Date.parse(entry.expiresAt)) || Date.parse(entry.expiresAt) <= Date.now()) errors.push("expiresAt 必须是未来时间（现场变更仅允许短期宽限）");
  if (options.confirm !== true) errors.push("必须显式 confirm=true");
  const scope = entry.scope || (entry.column ? "column" : "table");
  if (!["column", "table"].includes(scope)) errors.push("scope 只允许 column/table");
  if (scope === "column" && !String(entry.column || "").trim()) errors.push("column scope 必须提供 column");
  if (scope === "table" && entry.column) errors.push("table scope 不得携带 column");
  if (entry.column && String(entry.column).includes("*")) errors.push("禁止使用 column=* 通配放行");
  return { ok: errors.length === 0, errors, scope };
}

function withLedgerLock(file, action) {
  const lock = `${file}.lock`;
  let descriptor;
  try { descriptor = fs.openSync(lock, "wx", 0o600); }
  catch (error) { if (error.code === "EEXIST") return { ok: false, reason: "ledger-busy" }; throw error; }
  try { return action(); }
  finally { try { fs.closeSync(descriptor); } catch {} try { fs.unlinkSync(lock); } catch {} }
}

function appendLedger(projectRoot, entry, options = {}) {
  const ledger = loadLedger(projectRoot);
  const validation = validateLedgerEntry(entry, options);
  if (!validation.ok) return { ok: false, reason: "invalid-receipt", errors: validation.errors };
  if (ledger.corrupt) return { ok: false, reason: "ledger-corrupt", file: normalizeRel(LEDGER_FILE) };
  const record = { ...entry, scope: validation.scope, receiptId: entry.receiptId || receiptId(entry), recordedAt: new Date().toISOString() };
  const file = path.join(projectRoot, LEDGER_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (ledger.executed.some((item) => item && item.receiptId === record.receiptId)) return { ok: true, idempotent: true, total: ledger.executed.length, file: normalizeRel(LEDGER_FILE), receiptId: record.receiptId };
  return withLedgerLock(file, () => {
    const fresh = loadLedger(projectRoot);
    if (fresh.corrupt) return { ok: false, reason: "ledger-corrupt", file: normalizeRel(LEDGER_FILE) };
    if (fresh.executed.some((item) => item && item.receiptId === record.receiptId)) return { ok: true, idempotent: true, total: fresh.executed.length, file: normalizeRel(LEDGER_FILE), receiptId: record.receiptId };
    const next = { executed: [...fresh.executed, record] };
    writeJsonAtomic(file, next);
    return { ok: true, total: next.executed.length, file: normalizeRel(LEDGER_FILE), receiptId: record.receiptId };
  });
}

/** 账本内已审批的 表/列 → 放行集合 */
function approvedFromLedger(ledger) {
  const approved = new Map(); // table -> Set<column|"*">
  for (const e of ledger.executed) {
    if (!e || !e.table || !e.expiresAt || Date.parse(e.expiresAt) <= Date.now()) continue;
    const t = String(e.table).toLowerCase();
    if (!approved.has(t)) approved.set(t, new Set());
    const col = e.scope === "table" || !e.column ? "*" : String(e.column).toLowerCase();
    approved.get(t).add(col);
  }
  return approved;
}

/**
 * 漂移检测主入口
 * @param projectRoot 项目根
 * @param snapshotFile DBA 导出的结构快照 JSON
 */
function detectDrift(projectRoot, snapshotFile, options = {}) {
  const prefix = options.tablePrefix || "pl_";
  const snap = loadSnapshot(snapshotFile);
  if (!snap.ok) return { ok: false, errors: snap.errors, issues: [] };

  const contracts = collectFromContracts(projectRoot, options.contractsRel);
  const migrations = collectFromMigrations(projectRoot, options.migrationRel);
  const dbSpec = require("./db-spec");
  const spec = dbSpec.loadDbSpec(projectRoot);
  const ledger = loadLedger(projectRoot);
  const approved = approvedFromLedger(ledger);

  // 期望结构 = 契约字段 ∪ 迁移推导（契约未建但有迁移建表的，字段以迁移为准）
  const expected = new Map();
  if (spec.ok) {
    for (const [table, definition] of spec.tables) {
      expected.set(table, new Set(definition.fields.map((field) => field.key)));
    }
  }
  for (const [t, cols] of contracts) {
    if (!expected.has(t)) expected.set(t, new Set());
    for (const column of cols) expected.get(t).add(column);
  }
  for (const [t, cols] of migrations) {
    if (!expected.has(t)) expected.set(t, new Set());
    for (const c of cols) expected.get(t).add(c);
  }

  const issues = [];
  if (ledger.corrupt) {
    issues.push({ kind: "ledger-corrupt", severity: "error", table: "*", column: "*", message: `DDL 账本无法解析：${normalizeRel(LEDGER_FILE)}；为避免误放行，必须修复或恢复账本后重试` });
  }
  for (const [table, live] of snap.tables) {
    if (prefix && !table.startsWith(prefix)) continue;
    const liveCols = live.columns;
    const expectCols = expected.get(table);
    if (!expectCols) {
      issues.push({
        kind: "unclaimed-table", severity: "error", table, column: "*",
        message: `线上表 ${table} 不存在于任何契约/Flyway 迁移（无主表；若合法请经审批记入 ${normalizeRel(LEDGER_FILE)}）`,
      });
      continue;
    }
    for (const col of liveCols) {
      if (expectCols.has(col)) continue;
      const ledgerCols = approved.get(table);
      if (ledgerCols && (ledgerCols.has(col) || ledgerCols.has("*"))) {
        issues.push({
          kind: "approved-drift", severity: "warn", table, column: col,
          message: `列 ${table}.${col} 处于有时限的现场变更宽限期（${normalizeRel(LEDGER_FILE)}）；到期前必须回写文档、契约和 Flyway`,
        });
        continue;
      }
      issues.push({
        kind: "unclaimed-column", severity: "error", table, column: col,
        message: `线上列 ${table}.${col} 无任何来源（契约/Flyway/账本均无）：疑似绕过审批直接改库；补登记迁移或经审批记入账本`,
      });
    }
    for (const col of expectCols) {
      if (!liveCols.has(col)) {
        issues.push({
          kind: "missing-in-db", severity: "error", table, column: col,
          message: `契约/迁移声明了 ${table}.${col}，但线上快照缺失：迁移未执行或快照过期`,
        });
      }
    }
    const specTable = spec.tables.get(table);
    if (specTable && live.fields.some((field) => field.dbType !== undefined || field.comment !== undefined)) {
      const byKey = new Map(live.fields.map((field) => [field.key, field]));
      for (const expectedField of specTable.fields) {
        const actual = byKey.get(expectedField.key);
        if (!actual) continue;
        if (actual.name !== expectedField.name) {
          issues.push({ kind: "column-case", severity: "error", table, column: actual.name, message: `${table}.${actual.name} 大小写与文档 ${expectedField.name} 不一致` });
        }
        if (actual.ordinal !== expectedField.ordinal) {
          issues.push({ kind: "column-order", severity: "error", table, column: actual.name, message: `${table}.${actual.name} 序号 ${actual.ordinal}，文档要求 ${expectedField.ordinal}` });
        }
        if (expectedField.dbType !== undefined && dbSpec.normalizeType(actual.dbType) !== dbSpec.normalizeType(expectedField.dbType)) {
          issues.push({ kind: "column-type", severity: "error", table, column: actual.name, message: `${table}.${actual.name} 类型 ${actual.dbType}，文档要求 ${expectedField.dbType}` });
        }
        if (expectedField.nullable !== undefined && actual.nullable !== expectedField.nullable) {
          issues.push({ kind: "column-nullable", severity: "error", table, column: actual.name, message: `${table}.${actual.name} nullable=${actual.nullable}，文档要求 ${expectedField.nullable}` });
        }
        if (expectedField.defaultValue !== undefined
          && dbSpec.normalizeDefault(actual.defaultValue) !== dbSpec.normalizeDefault(expectedField.defaultValue)) {
          issues.push({ kind: "column-default", severity: "error", table, column: actual.name, message: `${table}.${actual.name} 默认值与文档不一致` });
        }
        if (expectedField.comment && String(actual.comment || "") !== expectedField.comment) {
          issues.push({ kind: "column-comment", severity: "error", table, column: actual.name, message: `${table}.${actual.name} 注释与文档不一致` });
        }
      }
    }
  }
  for (const [table] of expected) {
    if (prefix && !table.startsWith(prefix)) continue;
    if (!snap.tables.has(table)) {
      issues.push({ kind: "missing-table", severity: "error", table, column: "*", message: `契约/Flyway 声明了表 ${table}，但线上快照完全缺失：迁移未执行或快照过期` });
    }
  }
  const errors = issues.filter((i) => i.severity === "error").length;
  const warns = issues.filter((i) => i.severity === "warn").length;
  return {
    ok: errors === 0,
    status: errors > 0 ? "failed" : warns > 0 ? "warning" : "passed",
    errors: issues.filter((item) => item.severity === "error"),
    issues,
    diagnostics: ledger.corrupt ? [{ code: "LEDGER_CORRUPT", message: `DDL 账本无法解析：${normalizeRel(LEDGER_FILE)}` }] : [],
    summary: { tables: snap.tables.size, expectedTables: expected.size, errors, warns, ledgerEntries: ledger.executed.length },
  };
}

module.exports = {
  LEDGER_FILE,
  loadSnapshot,
  collectFromContracts,
  collectFromMigrations,
  loadLedger,
  appendLedger,
  validateLedgerEntry,
  detectDrift,
};
