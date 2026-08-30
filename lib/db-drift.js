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
const fileTransaction = require("./file-transaction");

const LEDGER_FILE = ".wl-skills-bd/.state/ddl-ledger.json";
const MAX_LEDGER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

// 从契约目录（docs/contracts/db 下各契约）汇聚 表->字段集
function collectFromContracts(projectRoot, contractsRel = "docs/contracts/db") {
  const dir = path.join(projectRoot, contractsRel);
  const tables = new Map();
  if (!fs.existsSync(dir)) return tables;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dir, entry.name, "wl-contract.json");
    const parsed = readJsonIfExists(file);
    if (!parsed) continue;
    const table = (parsed.entity && parsed.entity.table) || entry.name;
    const fields = new Set((parsed.fields || []).map((f) => String(f.column || "").toLowerCase()).filter(Boolean));
    tables.set(String(table).toLowerCase(), fields);
  }
  return tables;
}

/** 粗粒度迁移推导：从 db/migration/**.sql 提取 CREATE TABLE 表名与 ADD COLUMN 列 */
function collectFromMigrations(projectRoot, migrationRel = "db/migration") {
  const root = path.join(projectRoot, migrationRel);
  const tables = new Map();
  if (!fs.existsSync(root)) return tables;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
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
  walk(root);
  return tables;
}

/** DDL 执行账本 */
function loadLedger(projectRoot) {
  const file = path.join(projectRoot, LEDGER_FILE);
  if (!fs.existsSync(file)) return { ok: true, state: "missing", executed: [], file };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    return { ok: false, reason: "ledger-invalid-json", errors: [error.message], executed: [], file };
  }
  if (!parsed || !Array.isArray(parsed.executed)) {
    return { ok: false, reason: "ledger-invalid-shape", errors: ["DDL 台账必须是 {executed: [...]}"], executed: [], file };
  }
  return { ok: true, state: "loaded", executed: parsed.executed, file };
}

function validateLedgerEntry(entry, now = Date.now()) {
  const errors = [];
  const identifier = /^[A-Za-z][A-Za-z0-9_$#]{0,127}$/;
  if (!identifier.test(String(entry.table || ""))) errors.push("table 必须是 1~128 位数据库标识符");
  if (!identifier.test(String(entry.column || ""))) errors.push("column 必须是精确的 1~128 位列标识符；不允许整表通配");
  if (!/^[a-f0-9]{64}$/.test(String(entry.ddlPlanHash || ""))) errors.push("ddlPlanHash 必须是已审批 DDL 计划的 64 位 sha256");
  for (const field of ["approvalRef", "sourceRef", "executedBy"]) {
    const value = String(entry[field] || "").trim();
    if (!value || value.length > 256) errors.push(`${field} 必须是 1~256 位非空文本`);
  }
  if (String(entry.note || "").length > 1000) errors.push("note 最多 1000 字符");
  const executedAt = Date.parse(entry.executedAt);
  const expiresAt = Date.parse(entry.expiresAt);
  if (!Number.isFinite(executedAt)) errors.push("executedAt 必须是合法 ISO 时间");
  if (!Number.isFinite(expiresAt)) errors.push("expiresAt 必须是合法 ISO 时间");
  if (Number.isFinite(executedAt) && executedAt > now + 5 * 60 * 1000) errors.push("executedAt 不得晚于当前时间 5 分钟以上");
  if (Number.isFinite(executedAt) && Number.isFinite(expiresAt)) {
    if (expiresAt <= now) errors.push("expiresAt 必须晚于当前时间");
    if (expiresAt <= executedAt) errors.push("expiresAt 必须晚于 executedAt");
    if (expiresAt - executedAt > MAX_LEDGER_TTL_MS) errors.push("DDL 台账宽限期不得超过 7 天");
  }
  return errors;
}

function buildLedgerPlan(projectRoot, entry) {
  const ledger = loadLedger(projectRoot);
  if (!ledger.ok) return { ok: false, reason: ledger.reason, errors: ledger.errors, applied: [] };
  const normalized = {
    table: String(entry.table || "").trim(),
    column: String(entry.column || "").trim(),
    ddlPlanHash: String(entry.ddlPlanHash || "").trim(),
    approvalRef: String(entry.approvalRef || "").trim(),
    sourceRef: String(entry.sourceRef || "").trim(),
    executedBy: String(entry.executedBy || "").trim(),
    executedAt: String(entry.executedAt || "").trim(),
    expiresAt: String(entry.expiresAt || "").trim(),
    note: String(entry.note || "").trim(),
  };
  const errors = validateLedgerEntry(normalized);
  if (errors.length > 0) return { ok: false, reason: "ledger-entry-invalid", errors, applied: [] };
  const record = {
    ...normalized,
  };
  const next = { executed: [...ledger.executed, record] };
  const plan = fileTransaction.buildFilePlan(projectRoot, LEDGER_FILE, `${JSON.stringify(next, null, 2)}\n`, {
    kind: "ddl-ledger-append",
    metadata: { entry: record, total: next.executed.length },
  });
  return { ...plan, entry: record, total: next.executed.length };
}

function publicLedgerPlan(plan) {
  if (!plan.ok) return plan;
  return { ...fileTransaction.publicFilePlan(plan), entry: plan.entry, total: plan.total };
}

function applyLedgerPlan(plan, options = {}) {
  return fileTransaction.applyFilePlan(plan, options);
}

function appendLedger(projectRoot, entry, options = {}) {
  const plan = buildLedgerPlan(projectRoot, entry);
  if (!plan.ok) return plan;
  return applyLedgerPlan(plan, options);
}

/** 账本内已审批的 表/列 → 放行集合 */
function approvedFromLedger(ledger) {
  const approved = new Map(); // table -> Set<column|"*">
  for (const e of ledger.executed) {
    if (!e || !e.table || !e.expiresAt || Date.parse(e.expiresAt) <= Date.now()) continue;
    const t = String(e.table).toLowerCase();
    if (!approved.has(t)) approved.set(t, new Set());
    if (!e.column) continue;
    approved.get(t).add(String(e.column).toLowerCase());
  }
  return approved;
}

/**
 * 漂移检测主入口
 * @param projectRoot 项目根
 * @param snapshotFile DBA 导出的结构快照 JSON
 */
function detectDrift(projectRoot, snapshotFile, options = {}) {
  const prefix = options.tablePrefix === undefined ? "" : options.tablePrefix;
  const snap = loadSnapshot(snapshotFile);
  if (!snap.ok) return { ok: false, errors: snap.errors, issues: [] };

  const contracts = collectFromContracts(projectRoot, options.contractsRel);
  const migrations = collectFromMigrations(projectRoot, options.migrationRel);
  const dbSpec = require("./db-spec");
  const spec = dbSpec.loadDbSpec(projectRoot);
  const ledger = loadLedger(projectRoot);
  if (!ledger.ok) return { ok: false, reason: ledger.reason, errors: ledger.errors, issues: [], summary: { tables: snap.tables.size, errors: 1, warns: 0, ledgerEntries: 0 } };
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
      if (ledgerCols && ledgerCols.has(col)) {
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
  const errors = issues.filter((i) => i.severity === "error").length;
  const warns = issues.filter((i) => i.severity === "warn").length;
  return { ok: errors === 0, errors: [], issues, summary: { tables: snap.tables.size, errors, warns, ledgerEntries: ledger.executed.length } };
}

module.exports = {
  LEDGER_FILE,
  MAX_LEDGER_TTL_MS,
  loadSnapshot,
  collectFromContracts,
  collectFromMigrations,
  loadLedger,
  applyLedgerPlan,
  appendLedger,
  buildLedgerPlan,
  publicLedgerPlan,
  validateLedgerEntry,
  detectDrift,
};
