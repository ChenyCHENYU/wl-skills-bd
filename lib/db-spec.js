"use strict";

/**
 * 数据库事实源门禁：设计文档镜像 -> 契约 -> Flyway -> 数据库快照。
 *
 * docs/db-spec/*.json 是设计文档的机器镜像；契约只能完整复用文档表，
 * 文档字段按原顺序前置。扩展表/字段必须登记来源与审批，扩展字段只能末尾追加。
 * 本模块不连接数据库、不执行 DDL。
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { physicalIdentifier, resolveGovernance, softDeleteComment } = require("./governance");

const DB_SPEC_DIR = "docs/db-spec";
const GOVERNANCE_FILE = ".wl-skills-bd/db-governance.json";
const LEGACY_WAIVERS_FILE = ".wl-skills-bd/naming-waivers.json";
const INSTALL_MANIFEST = ".wl-skills-bd-manifest.json";
const PLATFORM_COLUMNS = new Set([
  "id", "company_id", "is_delete", "revision", "create_user_no", "update_user_no",
  "create_date_time", "update_date_time",
]);

function readJsonIfExists(file) {
  try {
    let text = fs.readFileSync(file, "utf8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function normalizeType(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeDefault(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return String(value).trim().replace(/^\((.*)\)$/s, "$1").replace(/^'(.*)'$/s, "$1").toLowerCase();
}

function normalizeField(raw, ordinal) {
  const object = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const name = String(object.name || object.column || raw || "").trim();
  return {
    name,
    key: name.toLowerCase(),
    ordinal: Number.isInteger(object.ordinal) ? object.ordinal : ordinal,
    comment: String(object.comment ?? object.cname ?? "").trim(),
    dbType: object.dbType === undefined ? undefined : String(object.dbType).trim(),
    nullable: typeof object.nullable === "boolean" ? object.nullable : undefined,
    defaultValue: Object.prototype.hasOwnProperty.call(object, "defaultValue")
      ? object.defaultValue
      : object.default,
  };
}

function normalizeTable(table, source) {
  const name = String(table.name || table.table || "").trim();
  return {
    name,
    key: name.toLowerCase(),
    comment: String(table.comment ?? table.cname ?? table.description ?? "").trim(),
    fields: (table.fields || table.columns || []).map((field, index) => normalizeField(field, index + 1)),
    source,
  };
}

function loadDbSpec(projectRoot) {
  const specDir = path.join(projectRoot, DB_SPEC_DIR);
  const result = { ok: false, tables: new Map(), files: [], errors: [] };
  if (!fs.existsSync(specDir)) {
    result.errors.push({ code: "NO_SPEC_DIR", message: `未找到 ${DB_SPEC_DIR}/；数据库生成必须先建立设计文档机器镜像` });
    return result;
  }
  const entries = fs.readdirSync(specDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (entries.length === 0) {
    result.errors.push({ code: "EMPTY_SPEC_DIR", message: `${DB_SPEC_DIR}/ 为空；禁止脱离文档生成表结构` });
    return result;
  }
  for (const entry of entries) {
    const rel = `${DB_SPEC_DIR}/${entry.name}`;
    const parsed = readJsonIfExists(path.join(specDir, entry.name));
    if (!parsed || !Array.isArray(parsed.tables)) {
      result.errors.push({ code: "BAD_SPEC_FILE", message: `${rel} 缺少 tables 数组或 JSON 非法` });
      continue;
    }
    result.files.push(entry.name);
    for (const rawTable of parsed.tables) {
      const table = normalizeTable(rawTable, rel);
      if (!table.name || table.fields.length === 0) {
        result.errors.push({ code: "BAD_SPEC_TABLE", message: `${rel} 存在无名称或无字段的表定义` });
        continue;
      }
      if (result.tables.has(table.key)) {
        result.errors.push({ code: "DUPLICATE_SPEC_TABLE", message: `文档镜像重复定义表 ${table.name}` });
        continue;
      }
      const duplicate = table.fields.find((field, index) =>
        table.fields.findIndex((candidate) => candidate.key === field.key) !== index);
      if (duplicate) {
        result.errors.push({ code: "DUPLICATE_SPEC_FIELD", message: `${table.name} 重复定义字段 ${duplicate.name}` });
        continue;
      }
      result.tables.set(table.key, table);
    }
  }
  result.ok = result.errors.length === 0 && result.tables.size > 0;
  return result;
}

function validApproval(entry) {
  return Boolean(entry && entry.reason && entry.sourceRef && entry.approvedBy && entry.approvalRef);
}

function loadGovernance(projectRoot) {
  const parsed = readJsonIfExists(path.join(projectRoot, GOVERNANCE_FILE));
  const result = {
    file: GOVERNANCE_FILE,
    enforcement: "strict",
    extensionTables: new Map(),
    extensionFields: new Map(),
    waivers: [],
    errors: [],
  };
  if (!parsed) return result;
  if (parsed.schemaVersion !== 1) result.errors.push(`${GOVERNANCE_FILE}: schemaVersion 必须为 1`);
  if (parsed.enforcement && parsed.enforcement !== "strict") {
    result.errors.push(`${GOVERNANCE_FILE}: enforcement 只能为 strict；特殊情况用逐项审批 waiver，禁止整体降级`);
  } else if (parsed.enforcement) result.enforcement = parsed.enforcement;
  for (const entry of parsed.extensionTables || []) {
    const table = String(entry.table || "").trim().toLowerCase();
    if (!table || !entry.purpose || !validApproval(entry)) {
      result.errors.push(`${GOVERNANCE_FILE}: extensionTables 每项必须含 table/purpose/reason/sourceRef/approvedBy/approvalRef`);
      continue;
    }
    result.extensionTables.set(table, entry);
  }
  for (const entry of parsed.extensionFields || []) {
    const table = String(entry.table || "").trim().toLowerCase();
    const column = String(entry.column || "").trim().toLowerCase();
    if (!table || !column || !entry.purpose || !validApproval(entry)) {
      result.errors.push(`${GOVERNANCE_FILE}: extensionFields 每项必须含 table/column/purpose/reason/sourceRef/approvedBy/approvalRef`);
      continue;
    }
    if (!result.extensionFields.has(table)) result.extensionFields.set(table, new Map());
    result.extensionFields.get(table).set(column, entry);
  }
  result.waivers = Array.isArray(parsed.waivers) ? parsed.waivers : [];
  for (const waiver of result.waivers) {
    if (!waiver.kind || !waiver.table || !validApproval(waiver)) {
      result.errors.push(`${GOVERNANCE_FILE}: waivers 每项必须含 kind/table/reason/sourceRef/approvedBy/approvalRef`);
    } else if (!['field-property', 'table-comment'].includes(waiver.kind)) {
      result.errors.push(`${GOVERNANCE_FILE}: waiver.kind 只允许 field-property/table-comment；表名和字段顺序不得豁免`);
    } else if (waiver.kind === "field-property"
      && (!waiver.column || !["dbType", "nullable", "defaultValue", "comment"].includes(waiver.property))) {
      result.errors.push(`${GOVERNANCE_FILE}: field-property waiver 必须声明 column 和合法 property`);
    }
  }
  return result;
}

function isInstalledProject(projectRoot) {
  if (fs.existsSync(path.join(projectRoot, INSTALL_MANIFEST))) return true;
  const config = readJsonIfExists(path.join(projectRoot, ".wl-skills-bd", "config.json"));
  return config?.databaseGovernance?.enforceDocumentMirror === true;
}

function executionPolicy(environment) {
  const env = String(environment || "unknown").toLowerCase();
  if (["dev", "sit"].includes(env)) {
    return {
      lane: "fast-nonprod",
      approvalMode: "single-approval-continuous",
      steps: ["precheck", "migrate", "validate", "postcheck", "business-smoke"],
      rule: "一次 planHash 审批后连续执行；仅真实门禁失败才停止，修订后整链重跑，不为每个只读步骤重复审批",
    };
  }
  if (env === "uat") {
    return {
      lane: "controlled-nonprod",
      approvalMode: "owner-and-executor",
      steps: ["precheck", "migrate", "validate", "postcheck", "business-smoke"],
      rule: "业务负责人确认范围，执行人按同一冻结包连续执行",
    };
  }
  return {
    lane: ["pre", "prod", "production"].includes(env) ? "protected" : "unspecified",
    approvalMode: "change-ticket-and-dba",
    steps: ["backup", "precheck", "migrate", "validate", "postcheck", "business-smoke", "observe"],
    rule: "受保护环境需要变更单、备份/恢复证据、DBA/CD 与执行窗口；未知环境按受保护口径处理",
  };
}

function descriptorFromContract(contract, source = "wl-contract.json", profile) {
  const governance = resolveGovernance(profile);
  const database = contract.database;
  const column = (value) => physicalIdentifier(database, value);
  const varchar64 = database === "mysql" ? "VARCHAR(64)" : "VARCHAR2(64 CHAR)";
  const auditType = database === "mysql" ? governance.auditTime.mysqlType : governance.auditTime.oracleType;
  const softDeleteType = database === "mysql" ? governance.softDelete.mysqlType : governance.softDelete.oracleType;
  const platformFields = [
    { name: column("ID"), dbType: varchar64, nullable: false, comment: "主键ID" },
    { name: column("COMPANY_ID"), dbType: varchar64, nullable: false, comment: "公司/租户ID" },
    {
      name: column(governance.softDelete.column), dbType: softDeleteType, nullable: false,
      defaultValue: governance.softDelete.activeValue,
      comment: softDeleteComment(governance.softDelete.activeValue, governance.softDelete.deletedValue),
    },
    { name: column("REVISION"), dbType: database === "mysql" ? "INT" : "NUMBER(10)", nullable: false, defaultValue: 0, comment: "乐观锁版本号" },
    { name: column("CREATE_USER_NO"), dbType: varchar64, nullable: true, comment: "创建人工号" },
    { name: column("UPDATE_USER_NO"), dbType: varchar64, nullable: true, comment: "更新人工号" },
    { name: column("CREATE_DATE_TIME"), dbType: auditType, nullable: true, comment: "创建时间" },
    { name: column("UPDATE_DATE_TIME"), dbType: auditType, nullable: true, comment: "更新时间" },
  ].map((field, index) => ({ ...field, key: field.name.toLowerCase(), ordinal: index + 1 }));
  return {
    name: contract.entity?.table || "",
    key: String(contract.entity?.table || "").toLowerCase(),
    comment: String(contract.entity?.description || "").trim(),
    database,
    environment: contract.environment,
    fields: (contract.fields || []).map((field, index) => ({
      name: String(field.column || "").trim(),
      key: String(field.column || "").trim().toLowerCase(),
      ordinal: index + 1,
      comment: String(field.comment || "").trim(),
      dbType: field.dbType,
      nullable: typeof field.nullable === "boolean" ? field.nullable : undefined,
      defaultValue: field.defaultValue,
    })),
    platformFields,
    source,
  };
}

function normalizeContractTables(contractTables) {
  const result = new Map();
  for (const [name, value] of contractTables || []) {
    if (value && Array.isArray(value.fields)) {
      result.set(String(name).toLowerCase(), { ...value, key: String(name).toLowerCase() });
    } else {
      const fields = [...(value || [])].map((field, index) => normalizeField(field, index + 1));
      result.set(String(name).toLowerCase(), { name, key: String(name).toLowerCase(), fields, source: "docs/contracts/db" });
    }
  }
  return result;
}

function waiverFor(governance, table, column, property) {
  return governance.waivers.find((waiver) => waiver.kind === "field-property"
    && String(waiver.table).toLowerCase() === table.key
    && String(waiver.column).toLowerCase() === column.key
    && waiver.property === property);
}

function mismatch(issues, governance, table, column, property, message) {
  const waiver = waiverFor(governance, table, column, property);
  if (waiver) {
    issues.push({
      severity: "warn",
      message: `${message}；已按 ${waiver.approvalRef} 例外（${waiver.reason}，${waiver.approvedBy}）`,
    });
  } else issues.push({ severity: "error", message });
}

function exactFieldIssues(specTable, contractTable, governance) {
  const issues = [];
  const specFields = specTable.fields.filter((field) => !PLATFORM_COLUMNS.has(field.key));
  const contractFields = contractTable.fields.filter((field) => !PLATFORM_COLUMNS.has(field.key));
  const baselineCount = specFields.length;
  for (let index = 0; index < baselineCount; index += 1) {
    const expected = specFields[index];
    const actual = contractFields[index];
    if (!actual) {
      issues.push({ severity: "error", message: `缺少文档字段 ${expected.name}（文档序号 ${expected.ordinal}）` });
      continue;
    }
    if (actual.name !== expected.name) {
      issues.push({ severity: "error", message: `第 ${index + 1} 个业务字段应为 ${expected.name}，实际为 ${actual.name}（名称/大小写/顺序必须一致）` });
      continue;
    }
    if (expected.dbType !== undefined && normalizeType(actual.dbType) !== normalizeType(expected.dbType)) {
      mismatch(issues, governance, specTable, expected, "dbType", `${expected.name} 类型应为 ${expected.dbType}，实际为 ${actual.dbType || "未声明"}`);
    }
    if (expected.comment && actual.comment !== expected.comment) {
      mismatch(issues, governance, specTable, expected, "comment", `${expected.name} 注释应为“${expected.comment}”，实际为“${actual.comment || "空"}”`);
    }
    if (expected.nullable !== undefined && actual.nullable !== expected.nullable) {
      mismatch(issues, governance, specTable, expected, "nullable", `${expected.name} nullable 应为 ${expected.nullable}，契约必须显式声明相同值`);
    }
    if (expected.defaultValue !== undefined
      && normalizeDefault(actual.defaultValue) !== normalizeDefault(expected.defaultValue)) {
      mismatch(issues, governance, specTable, expected, "defaultValue", `${expected.name} 默认值应为 ${JSON.stringify(expected.defaultValue)}，实际为 ${JSON.stringify(actual.defaultValue)}`);
    }
  }
  const extensions = governance.extensionFields.get(specTable.key) || new Map();
  for (const actual of contractFields.slice(baselineCount)) {
    if (!extensions.has(actual.key)) issues.push({ severity: "error", message: `扩展字段 ${actual.name} 未登记来源/用途/审批，禁止无依据追加` });
  }
  for (const [column] of extensions) {
    if (!contractFields.slice(baselineCount).some((field) => field.key === column)) {
      issues.push({ severity: "error", message: `已登记扩展字段 ${column} 未落入契约末尾，请修正登记或实现` });
    }
  }
  const platformByKey = new Map((contractTable.platformFields || []).map((field) => [field.key, field]));
  for (const expected of specTable.fields.filter((field) => PLATFORM_COLUMNS.has(field.key))) {
    const actual = platformByKey.get(expected.key);
    if (!actual) continue;
    if (expected.dbType !== undefined && normalizeType(actual.dbType) !== normalizeType(expected.dbType)) {
      mismatch(issues, governance, specTable, expected, "dbType", `${expected.name} 类型应为 ${expected.dbType}，生成器为 ${actual.dbType}`);
    }
    if (expected.comment && actual.comment !== expected.comment) {
      mismatch(issues, governance, specTable, expected, "comment", `${expected.name} 注释应为“${expected.comment}”，生成器为“${actual.comment}”`);
    }
    if (expected.nullable !== undefined && actual.nullable !== expected.nullable) {
      mismatch(issues, governance, specTable, expected, "nullable", `${expected.name} nullable 应为 ${expected.nullable}，生成器为 ${actual.nullable}`);
    }
    if (expected.defaultValue !== undefined
      && normalizeDefault(actual.defaultValue) !== normalizeDefault(expected.defaultValue)) {
      mismatch(issues, governance, specTable, expected, "defaultValue", `${expected.name} 默认值应为 ${JSON.stringify(expected.defaultValue)}，生成器为 ${JSON.stringify(actual.defaultValue)}`);
    }
  }
  return issues;
}

function compare(projectRoot, contractTables, options = {}) {
  const strictMissing = options.strictMissing ?? isInstalledProject(projectRoot);
  const spec = loadDbSpec(projectRoot);
  const governance = loadGovernance(projectRoot);
  const issues = [];
  if (!spec.ok) {
    for (const error of spec.errors) issues.push({ severity: strictMissing ? "error" : "warn", file: DB_SPEC_DIR, message: error.message });
    return { ok: !strictMissing, issues, spec, governance, fingerprint: null };
  }
  for (const error of governance.errors) issues.push({ severity: "error", file: GOVERNANCE_FILE, message: error });
  const contracts = normalizeContractTables(contractTables);
  const specEntries = options.targetTable
    ? [...spec.tables].filter(([key]) => key === String(options.targetTable).toLowerCase())
    : [...spec.tables];
  for (const [key, specTable] of specEntries) {
    const contractTable = contracts.get(key);
    if (!contractTable) {
      issues.push({ severity: "error", file: specTable.source, message: `文档表 ${specTable.name}(${specTable.comment}) 未被同名契约复用；禁止改名后架空基线表` });
      continue;
    }
    if (contractTable.name !== specTable.name) {
      issues.push({ severity: "error", file: specTable.source, message: `表名大小写必须与文档一致：${specTable.name} != ${contractTable.name}` });
    }
    if (strictMissing && contractTable.database) {
      const missingPlatform = [...PLATFORM_COLUMNS].filter((column) => !specTable.fields.some((field) => field.key === column));
      if (missingPlatform.length > 0) {
        issues.push({
          severity: "error",
          file: specTable.source,
          message: `表 ${specTable.name} 的文档镜像不是完整物理结构，缺少治理字段：${missingPlatform.join(", ")}`,
        });
      }
    }
    if (specTable.comment && specTable.comment !== contractTable.comment) {
      const waiver = governance.waivers.find((entry) => entry.kind === "table-comment"
        && String(entry.table).toLowerCase() === specTable.key);
      issues.push({
        severity: waiver ? "warn" : "error",
        file: specTable.source,
        message: `表 ${specTable.name} 注释应为“${specTable.comment}”，实际为“${contractTable.comment}”${waiver ? `；已按 ${waiver.approvalRef} 例外（${waiver.reason}）` : ""}`,
      });
    }
    for (const fieldIssue of exactFieldIssues(specTable, contractTable, governance)) {
      issues.push({ severity: fieldIssue.severity, file: specTable.source, message: `表 ${specTable.name}: ${fieldIssue.message}` });
    }
  }
  for (const [key, contractTable] of contracts) {
    if (options.targetTable && key !== String(options.targetTable).toLowerCase()) continue;
    if (spec.tables.has(key)) continue;
    if (!governance.extensionTables.has(key)) {
      issues.push({ severity: "error", file: contractTable.source || "docs/contracts/db", message: `扩展表 ${contractTable.name} 不在文档基线且未登记用途/来源/审批；禁止无故新建表` });
    }
  }
  const legacy = readJsonIfExists(path.join(projectRoot, LEGACY_WAIVERS_FILE));
  if (legacy?.waivers?.length) {
    issues.push({ severity: "error", file: LEGACY_WAIVERS_FILE, message: `旧 naming-waivers 不能继续掩盖表改名；请恢复文档表名，或将属性级例外迁入 ${GOVERNANCE_FILE}` });
  }
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify({
    specs: [...spec.tables.values()],
    governance: readJsonIfExists(path.join(projectRoot, GOVERNANCE_FILE)) || {},
  })).digest("hex");
  return { ok: issues.every((issue) => issue.severity !== "error"), issues, spec, governance, fingerprint };
}

function checkDocContractConsistency(projectRoot, contractTables, options = {}) {
  const result = compare(projectRoot, contractTables, options);
  return {
    ...result,
    issues: result.issues.map((issue) => ({
      rule: "B31", file: issue.file, line: 1, col: 1, severity: issue.severity, message: issue.message,
    })),
    specTables: result.spec.tables.size,
    matched: normalizeContractTables(contractTables).size,
    extensions: result.governance.extensionTables.size,
  };
}

function checkContractAgainstDbSpec(projectRoot, contract, options = {}) {
  const descriptor = descriptorFromContract(contract, options.source || "wl-contract.json", options.profile);
  return compare(projectRoot, new Map([[descriptor.key, descriptor]]), { ...options, targetTable: descriptor.key });
}

function checkCodeTableReferences(projectRoot) {
  const spec = loadDbSpec(projectRoot);
  if (!spec.ok) return { ok: true, issues: [] };
  const governance = loadGovernance(projectRoot);
  const allowed = new Set([...spec.tables.keys(), ...governance.extensionTables.keys()]);
  const prefixes = new Set([...allowed].map((table) => {
    const match = table.match(/^([a-z0-9]+_)/);
    return match && match[1];
  }).filter(Boolean));
  const issues = [];
  const roots = ["src/main", "src/test"].map((rel) => path.join(projectRoot, rel)).filter(fs.existsSync);
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!["target", "build", "node_modules", ".git"].includes(entry.name)) visit(file);
        continue;
      }
      if (!entry.isFile() || !/\.(?:java|xml|sql)$/i.test(entry.name)) continue;
      if (normalizePath(file).includes("/db/migration/")) continue;
      const content = fs.readFileSync(file, "utf8");
      const tokens = new Set();
      for (const match of content.matchAll(/@TableName\s*\(\s*(?:value\s*=\s*)?["']([A-Za-z][A-Za-z0-9_]*)["']/g)) tokens.add(match[1]);
      for (const match of content.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO|TABLE)\s+[`"]?([A-Za-z][A-Za-z0-9_]*)[`"]?/gi)) tokens.add(match[1]);
      for (const token of tokens) {
        const key = token.toLowerCase();
        if (![...prefixes].some((prefix) => key.startsWith(prefix)) || allowed.has(key)) continue;
        issues.push({
          rule: "B31", severity: "error", file: normalizePath(path.relative(projectRoot, file)), line: 1, col: 1,
          message: `代码引用未登记或已退役表 ${token}；文档基线/扩展白名单均不存在，禁止遗留旧表读写`,
        });
      }
    }
  };
  for (const root of roots) visit(root);
  return { ok: issues.length === 0, issues };
}

function normalizePath(value) {
  return String(value).replace(/\\/g, "/");
}

module.exports = {
  DB_SPEC_DIR,
  GOVERNANCE_FILE,
  LEGACY_WAIVERS_FILE,
  checkContractAgainstDbSpec,
  checkDocContractConsistency,
  checkCodeTableReferences,
  descriptorFromContract,
  executionPolicy,
  isInstalledProject,
  loadDbSpec,
  loadGovernance,
  normalizeDefault,
  normalizeType,
};
