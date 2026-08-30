"use strict";

const path = require("path");
const { hashJson, stable } = require("./deterministic");
const { loadDbSpec, normalizeType } = require("./db-spec");

const PLATFORM_FIELDS = new Set([
  "id", "company_id", "is_delete", "revision", "create_user_no", "update_user_no",
  "create_date_time", "update_date_time",
]);

function words(value) {
  return String(value || "").trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
}

function lowerCamel(value) {
  const parts = words(value).map((part) => part.toLowerCase());
  return parts.map((part, index) => index === 0 ? part : `${part[0].toUpperCase()}${part.slice(1)}`).join("");
}

function upperCamel(value) {
  return words(value).map((part) => `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`).join("");
}

function kebab(value) {
  return words(value).map((part) => part.toLowerCase()).join("-");
}

function javaTypeFor(dbType) {
  const value = normalizeType(dbType);
  if (/^(?:var)?char2?\b|^(?:tiny|medium|long)?text\b|^clob\b/.test(value)) return "String";
  if (/^bigint\b/.test(value)) return "Long";
  if (/^(?:tinyint|smallint|mediumint|int|integer)\b/.test(value)) return "Integer";
  if (/^(?:boolean|bool|bit\s*\(\s*1\s*\))\b/.test(value)) return "Boolean";
  if (/^(?:decimal|numeric|number)\b/.test(value)) {
    const precision = value.match(/\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)/);
    if (precision && Number(precision[2] || 0) > 0) return "BigDecimal";
    if (precision && Number(precision[1]) <= 9) return "Integer";
    return "Long";
  }
  if (/^(?:date|datetime|timestamp)\b/.test(value)) return "LocalDateTime";
  return null;
}

function storageConstraints(dbType, javaType) {
  if (javaType !== "String") return undefined;
  const match = normalizeType(dbType).match(/^(?:var)?char2?\s*\(\s*(\d+)/);
  return match ? { maxLength: Number(match[1]) } : undefined;
}

function buildContractSeed(projectRootInput, options = {}) {
  const projectRoot = path.resolve(projectRootInput || process.cwd());
  if (!options.table) return { ok: false, reason: "table-required", errors: [{ path: "$.table", message: "必须指定 docs/db-spec 中的表名" }] };
  if (!["oracle", "mysql"].includes(options.database)) {
    return { ok: false, reason: "database-required", errors: [{ path: "$.database", message: "必须明确指定 oracle 或 mysql，禁止根据字段文本猜数据库方言" }] };
  }
  const loaded = loadDbSpec(projectRoot);
  if (!loaded.ok) return { ok: false, reason: "db-spec-invalid", errors: loaded.errors };
  const table = loaded.tables.get(String(options.table).toLowerCase());
  if (!table) {
    return {
      ok: false,
      reason: "table-not-found",
      errors: [{ path: "$.table", message: `docs/db-spec 未定义表 ${options.table}` }],
      availableTables: [...loaded.tables.values()].map((item) => item.name).sort(),
    };
  }

  const unresolved = [];
  const fields = table.fields.filter((field) => !PLATFORM_FIELDS.has(field.key)).map((field, index) => {
    const javaType = javaTypeFor(field.dbType);
    const constraints = storageConstraints(field.dbType, javaType);
    const location = `$.fields[${index}]`;
    if (!javaType) unresolved.push({ path: `${location}.javaType`, question: `字段 ${field.name} 的数据库类型 ${field.dbType || "<缺失>"} 无确定性 Java 映射` });
    for (const property of ["writable", "requiredOnCreate", "queryMode", "classification", "semanticId"]) {
      unresolved.push({ path: `${location}.${property}`, question: `字段 ${field.name} 的 ${property} 无法由数据库结构推导` });
    }
    return stable({
      name: lowerCamel(field.name),
      column: field.name,
      ...(javaType ? { javaType } : {}),
      ...(field.dbType ? { dbType: String(field.dbType).trim().toUpperCase() } : {}),
      comment: field.comment,
      nullable: field.nullable,
      ...(Object.prototype.hasOwnProperty.call(field, "defaultValue") && field.defaultValue !== undefined
        ? { defaultValue: field.defaultValue } : {}),
      ...(constraints ? { constraints, constraintSource: `db-spec:${table.source}#${table.name}.${field.name}` } : {}),
      writable: false,
      queryMode: "none",
      detail: true,
      list: true,
      evidence: { source: table.source, ordinal: field.ordinal },
    });
  });
  const base = stable({
    schemaVersion: 1,
    kind: "wl-backend-contract-seed",
    source: { kind: "db-spec", file: table.source, table: table.name },
    database: options.database,
    suggestions: {
      contractId: options.contractId || kebab(table.name),
      profile: options.profile || "jh4j3-openapi3",
      ...(options.rootPackage ? { rootPackage: options.rootPackage } : {}),
      ...(options.module ? { module: options.module } : {}),
      entity: { name: options.entity || upperCamel(table.name), table: table.name, description: table.comment },
      fields,
    },
    unresolved,
    policy: {
      inferred: ["name", "column", "javaType", "dbType", "storageConstraints", "nullable", "defaultValue"],
      conservativeDefaults: { writable: false, queryMode: "none", detail: true, list: true },
      neverInferred: ["writable", "requiredOnCreate", "queryMode", "classification", "semanticId", "API", "permissions", "migrationRisk"],
    },
  });
  return { ok: true, ...base, seedHash: hashJson(base) };
}

module.exports = { buildContractSeed, javaTypeFor, lowerCamel, storageConstraints, upperCamel };
