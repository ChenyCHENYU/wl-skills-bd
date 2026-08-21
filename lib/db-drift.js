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
  const parsed = readJsonIfExists(file);
  if (!parsed || !Array.isArray(parsed.executed)) return { executed: [], file };
  return { executed: parsed.executed, file };
}

function appendLedger(projectRoot, entry) {
  const ledger = loadLedger(projectRoot);
  const record = {
    ...entry,
    recordedAt: new Date().toISOString(),
  };
  const next = { executed: [...ledger.executed, record] };
  const file = path.join(projectRoot, LEDGER_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return { ok: true, total: next.executed.length, file: normalizeRel(LEDGER_FILE) };
}

/** 账本内已审批的 表/列 → 放行集合 */
function approvedFromLedger(ledger) {
  const approved = new Map(); // table -> Set<column|"*">
  for (const e of ledger.executed) {
    if (!e || !e.table || !e.expiresAt || Date.parse(e.expiresAt) <= Date.now()) continue;
    const t = String(e.table).toLowerCase();
    if (!approved.has(t)) approved.set(t, new Set());
    const col = e.column ? String(e.column).toLowerCase() : "*";
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
  const errors = issues.filter((i) => i.severity === "error").length;
  const warns = issues.filter((i) => i.severity === "warn").length;
  return { ok: errors === 0, errors: [], issues, summary: { tables: snap.tables.size, errors, warns, ledgerEntries: ledger.executed.length } };
}

module.exports = {
  LEDGER_FILE,
  loadSnapshot,
  collectFromContracts,
  collectFromMigrations,
  loadLedger,
  appendLedger,
  detectDrift,
};
