"use strict";

const fs = require("fs");
const path = require("path");
const { validateContract } = require("./contract");
const { applyFilePlan, buildFilePlan, publicFilePlan } = require("./file-transaction");
const { normalizeRel, resolveWithin } = require("./manifest");

const CONTRACT_KINDS = new Set(["crud", "schema-mirror", "integration-projection"]);
const GOVERNANCE_COLUMNS = new Set([
  "id", "company_id", "is_delete", "revision", "create_user_no", "update_user_no",
  "create_date_time", "update_date_time",
]);

function object(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function issue(code, location, message, severity = "error") {
  return { code, path: location, message, severity };
}

function inferKind(raw, strictResult) {
  if (CONTRACT_KINDS.has(raw && raw.contractKind)) return raw.contractKind;
  if (strictResult && strictResult.ok) return "crud";
  if (raw && (Array.isArray(raw.omsFields) || Array.isArray(raw.mesInternalFields))) return "integration-projection";
  if (raw && Array.isArray(raw.fields) && object(raw.entity)) return "schema-mirror";
  return null;
}

function inferJavaType(dbType) {
  const value = String(dbType || "").toUpperCase();
  if (/^(?:CHAR|VARCHAR|VARCHAR2|TEXT|CLOB|LONGTEXT)/.test(value)) return "String";
  if (/^(?:BIGINT|NUMBER\(19(?:,0)?\))/.test(value)) return "Long";
  if (/^(?:INT|INTEGER|SMALLINT|TINYINT|NUMBER\([1-9][0-9]?(?:,0)?\))/.test(value)) return "Integer";
  if (/^(?:DECIMAL|NUMERIC|NUMBER)/.test(value)) return "BigDecimal";
  if (/^(?:DATETIME|TIMESTAMP)/.test(value)) return "LocalDateTime";
  if (/^DATE/.test(value)) return "LocalDate";
  return "String";
}

function camelCase(value) {
  return String(value || "").toLowerCase().replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());
}

function normalizeDbType(value) {
  return String(value || "").trim().toUpperCase().replace(/^(TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT)\(\d+\)$/u, "$1");
}

function normalizeMirrorField(raw, index, errors, warnings) {
  const location = `$.fields[${index}]`;
  if (!object(raw)) {
    errors.push(issue("K121", location, "字段必须是对象"));
    return null;
  }
  for (const key of ["name", "column", "dbType"]) {
    if (typeof raw[key] !== "string" || !raw[key].trim()) errors.push(issue("K122", `${location}.${key}`, "必须是非空字符串"));
  }
  if (typeof raw.name === "string" && !/^[a-z][A-Za-z0-9]*$/.test(raw.name)) {
    errors.push(issue("K123", `${location}.name`, "必须是 lowerCamelCase 字段名"));
  }
  if (typeof raw.column === "string" && !/^[A-Za-z][A-Za-z0-9_]*$/.test(raw.column)) {
    errors.push(issue("K124", `${location}.column`, "物理列名格式不合法"));
  }
  const normalizedType = normalizeDbType(raw.dbType);
  if (normalizedType !== String(raw.dbType || "").trim().toUpperCase()) {
    warnings.push(issue("K221", `${location}.dbType`, `${raw.dbType} 的整数显示宽度不表示容量，语义按 ${normalizedType} 处理`, "warn"));
  }
  return {
    name: raw.name,
    column: raw.column,
    javaType: raw.javaType || inferJavaType(normalizedType),
    dbType: normalizedType,
    rawDbType: raw.dbType,
    comment: raw.comment || "",
    nullable: raw.nullable !== undefined ? raw.nullable : raw.requiredOnCreate !== true,
    maxLength: Number.isInteger(raw.maxLength) ? raw.maxLength : null,
    sourceShape: "field-object",
  };
}

function normalizeProjectionField(tuple, index, errors) {
  const location = `$.omsFields[${index}]`;
  if (!Array.isArray(tuple) || tuple.length < 4) {
    errors.push(issue("K131", location, "OMS 字段必须是 [column, dbType, nullable, comment]"));
    return null;
  }
  const [column, dbType, nullable, comment] = tuple;
  if (typeof column !== "string" || !/^[a-z][a-z0-9_]*$/.test(column)) errors.push(issue("K132", `${location}[0]`, "列名必须是小写 snake_case"));
  if (typeof dbType !== "string" || !dbType.trim()) errors.push(issue("K133", `${location}[1]`, "dbType 必须是非空字符串"));
  if (typeof nullable !== "boolean") errors.push(issue("K134", `${location}[2]`, "nullable 必须是布尔值"));
  if (typeof comment !== "string" || !comment.trim()) errors.push(issue("K135", `${location}[3]`, "comment 必须是非空字符串"));
  const normalizedType = normalizeDbType(dbType);
  const lengthMatch = normalizedType.match(/^(?:VAR)?CHAR2?\((\d+)/u);
  return {
    name: camelCase(column),
    column,
    javaType: inferJavaType(normalizedType),
    dbType: normalizedType,
    rawDbType: dbType,
    comment,
    nullable,
    maxLength: lengthMatch ? Number(lengthMatch[1]) : null,
    sourceShape: "oms-tuple",
  };
}

function validateIdentity(raw, errors) {
  if (!object(raw)) {
    errors.push(issue("K101", "$", "契约必须是 JSON 对象"));
    return;
  }
  if (typeof raw.contractId !== "string" || !/^[a-z][a-z0-9-]{2,79}$/.test(raw.contractId)) {
    errors.push(issue("K102", "$.contractId", "contractId 必须是稳定的 kebab-case 标识"));
  }
  if (!object(raw.entity)) errors.push(issue("K103", "$.entity", "必须声明实体对象"));
  else {
    if (typeof raw.entity.name !== "string" || !/^[A-Z][A-Za-z0-9]*$/.test(raw.entity.name)) errors.push(issue("K104", "$.entity.name", "实体名格式不合法"));
    if (typeof raw.entity.table !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/.test(raw.entity.table)) errors.push(issue("K105", "$.entity.table", "表名格式不合法"));
  }
}

function validateDuplicates(fields, indexes, internalColumns, errors) {
  const names = new Set();
  const columns = new Set();
  for (const [index, field] of fields.entries()) {
    if (!field) continue;
    if (names.has(field.name)) errors.push(issue("K141", `$.fields[${index}].name`, `字段名重复：${field.name}`));
    if (columns.has(field.column)) errors.push(issue("K142", `$.fields[${index}].column`, `列名重复：${field.column}`));
    names.add(field.name);
    columns.add(field.column);
  }
  const available = new Set([...columns, ...GOVERNANCE_COLUMNS, ...internalColumns]);
  const indexNames = new Set();
  for (const [index, item] of (indexes || []).entries()) {
    const location = `$.indexes[${index}]`;
    if (!object(item) || typeof item.name !== "string" || !Array.isArray(item.columns) || item.columns.length === 0) {
      errors.push(issue("K143", location, "索引必须声明 name 和非空 columns"));
      continue;
    }
    const identity = item.name.toLowerCase();
    if (indexNames.has(identity)) errors.push(issue("K144", `${location}.name`, `索引名大小写不敏感重复：${item.name}`));
    indexNames.add(identity);
    for (const column of item.columns) {
      if (!available.has(String(column).toLowerCase())) errors.push(issue("K145", `${location}.columns`, `索引引用未知列：${column}`));
    }
  }
}

function descriptorBase(raw, kind, fields) {
  const moduleId = raw.module || (typeof raw.contractId === "string" ? raw.contractId.split("-")[0] : null);
  const migrations = Array.isArray(raw.migrations)
    ? raw.migrations.slice()
    : raw.migration && raw.migration.version
      ? [...((raw.migration.sourceVersions || []).filter(Boolean)), raw.migration.version]
      : [];
  return {
    contractKind: kind,
    contractId: raw.contractId || null,
    module: moduleId,
    entity: raw.entity || null,
    database: raw.database || null,
    dbCluster: raw.dbCluster || null,
    ownership: raw.ownership || raw.owner || null,
    fields,
    indexes: Array.isArray(raw.indexes) ? raw.indexes : [],
    migrations,
    apiMode: kind === "crud" ? "declared" : raw.api && raw.api.implemented === false ? "none" : "source-observed",
    provenance: {
      generation: raw.generation || null,
      status: raw.status || null,
      verifiedAt: raw.sitVerifiedAt || null,
    },
    codegenSafe: kind === "crud",
  };
}

function inspectContract(raw, options = {}) {
  const strict = validateContract(raw, options);
  const kind = inferKind(raw, strict);
  if (strict.ok && kind === "crud") {
    return {
      ok: true,
      contractKind: "crud",
      codegenSafe: true,
      errors: [],
      warnings: strict.warnings || [],
      descriptor: { ...descriptorBase(strict.contract, "crud", strict.contract.fields), contract: strict.contract },
      strict,
    };
  }
  const errors = [];
  const warnings = [];
  validateIdentity(raw, errors);
  if (!kind) errors.push(issue("K106", "$.contractKind", "无法识别契约类型；请声明 crud/schema-mirror/integration-projection"));
  if (raw && raw.contractKind !== undefined && !CONTRACT_KINDS.has(raw.contractKind)) {
    errors.push(issue("K107", "$.contractKind", "只支持 crud/schema-mirror/integration-projection"));
  }
  if (kind === "crud") {
    errors.push(...(strict.errors || []).map((item) => issue("K110", item.path, item.message)));
    return { ok: false, contractKind: kind, codegenSafe: false, errors, warnings, descriptor: null, strict };
  }
  let fields = [];
  let internalColumns = [];
  if (kind === "schema-mirror") {
    if (!Array.isArray(raw.fields) || raw.fields.length === 0) errors.push(issue("K120", "$.fields", "数据库镜像契约至少声明一个字段"));
    else fields = raw.fields.map((field, index) => normalizeMirrorField(field, index, errors, warnings)).filter(Boolean);
    if (raw.schemaVersion !== 1) warnings.push(issue("K222", "$.schemaVersion", "数据库镜像建议使用 schemaVersion=1 或显式迁移版本", "warn"));
  }
  if (kind === "integration-projection") {
    if (!Array.isArray(raw.omsFields) || raw.omsFields.length === 0) errors.push(issue("K130", "$.omsFields", "集成投影至少声明一个 OMS 字段"));
    else fields = raw.omsFields.map((field, index) => normalizeProjectionField(field, index, errors)).filter(Boolean);
    internalColumns = Array.isArray(raw.mesInternalFields) ? raw.mesInternalFields.map((value) => String(value).toLowerCase()) : [];
    const exposed = new Set(fields.map((field) => field.column));
    for (const [index, column] of internalColumns.entries()) {
      if (!/^[a-z][a-z0-9_]*$/.test(column)) errors.push(issue("K136", `$.mesInternalFields[${index}]`, "内部列必须是小写 snake_case"));
      if (exposed.has(column)) errors.push(issue("K137", `$.mesInternalFields[${index}]`, `内部列不得暴露到 OMS：${column}`));
    }
  }
  validateDuplicates(fields, raw && raw.indexes, internalColumns, errors);
  if (raw && raw.contractKind === undefined && kind) {
    warnings.push(issue("K201", "$.contractKind", `已可靠推断为 ${kind}；建议显式声明，避免未来格式歧义`, "warn"));
  }
  const descriptor = kind ? descriptorBase(raw, kind, fields) : null;
  return { ok: errors.length === 0, contractKind: kind, codegenSafe: false, errors, warnings, descriptor, strict };
}

function loadContractCompat(file, options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const absolute = path.isAbsolute(file) ? path.resolve(file) : resolveWithin(projectRoot, file);
  try {
    const raw = JSON.parse(fs.readFileSync(absolute, "utf8"));
    return { ...inspectContract(raw, { ...options, projectRoot }), file: absolute, raw };
  } catch (error) {
    return { ok: false, contractKind: null, codegenSafe: false, errors: [issue("K100", "$", error.message)], warnings: [], descriptor: null, file: absolute };
  }
}

function buildMigrationPlan(projectRootInput, file) {
  const projectRoot = path.resolve(projectRootInput);
  const loaded = loadContractCompat(file, { projectRoot });
  if (!loaded.ok) return { ok: false, reason: "invalid-contract", errors: loaded.errors, warnings: loaded.warnings || [] };
  const migrated = JSON.parse(JSON.stringify(loaded.raw));
  const actions = [];
  if (!migrated.contractKind) {
    migrated.contractKind = loaded.contractKind;
    actions.push({ path: "$.contractKind", action: "add", value: loaded.contractKind, reason: "固定契约语义，避免启发式误判" });
  }
  if (loaded.contractKind === "schema-mirror") {
    for (const [index, field] of (migrated.fields || []).entries()) {
      const normalized = normalizeDbType(field.dbType);
      if (normalized && normalized !== String(field.dbType || "").trim().toUpperCase()) {
        actions.push({ path: `$.fields[${index}].dbType`, action: "normalize", from: field.dbType, value: normalized, reason: "移除不表示容量的整数显示宽度" });
        field.dbType = normalized;
      }
    }
  }
  const unresolved = [];
  if (!loaded.descriptor.ownership) unresolved.push({ path: "$.ownership", reason: "所有权无法安全推断，需由项目确认" });
  const rel = normalizeRel(path.relative(projectRoot, loaded.file));
  const filePlan = buildFilePlan(projectRoot, rel, `${JSON.stringify(migrated, null, 2)}\n`, {
    kind: "contract-compat-migration",
    metadata: { contractId: loaded.descriptor.contractId, contractKind: loaded.contractKind, actions, unresolved },
  });
  return { ...filePlan, actions, unresolved, inspection: loaded };
}

function publicMigrationPlan(plan) {
  if (!plan.ok) return plan;
  return { ...publicFilePlan(plan), actions: plan.actions, unresolved: plan.unresolved, contractKind: plan.inspection.contractKind };
}

function applyMigrationPlan(plan, options = {}) {
  if (plan.unresolved && plan.unresolved.length > 0 && options.allowUnresolved !== true) {
    return { ok: false, reason: "unresolved-decisions", unresolved: plan.unresolved, applied: [] };
  }
  return applyFilePlan(plan, options);
}

module.exports = {
  CONTRACT_KINDS,
  applyMigrationPlan,
  buildMigrationPlan,
  inferKind,
  inspectContract,
  loadContractCompat,
  normalizeDbType,
  publicMigrationPlan,
};
