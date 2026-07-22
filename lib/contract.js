"use strict";

const fs = require("fs");
const path = require("path");
const { normalizeRel, resolveWithin } = require("./manifest");
const { resolveGovernance, softDeleteComment, validateGovernance } = require("./governance");

const PACKAGE_ROOT = path.resolve(__dirname, "..");
const PACKAGE_FILES = path.join(PACKAGE_ROOT, "files");
const DELIVERY_PROFILE_NAME = "wl-delivery-profile.v1.json";
const RESERVED_FIELDS = new Set([
  "id", "companyId", "isDelete", "revision", "createUserNo", "updateUserNo",
  "createDateTime", "updateDateTime",
]);
const JAVA_TYPES = new Set([
  "String", "Integer", "Long", "Boolean", "BigDecimal", "LocalDate",
  "LocalDateTime", "List<String>", "List<Long>",
]);
const CUSTOM_FIELD_JAVA_TYPES = new Set([
  "String", "Integer", "Long", "Boolean", "BigDecimal", "LocalDate", "LocalDateTime",
]);
const TYPE_IMPORTS = {
  BigDecimal: "java.math.BigDecimal",
  LocalDate: "java.time.LocalDate",
  LocalDateTime: "java.time.LocalDateTime",
  "List<String>": "java.util.List",
  "List<Long>": "java.util.List",
};
const DEFAULT_OUTPUT = Object.freeze({
  modelJava: "src/main/java",
  serviceJava: "src/main/java",
  serviceResources: "src/main/resources",
  testJava: "src/test/java",
  migration: "src/main/resources/db/migration",
  rollback: "db/rollback-manual",
  collaboration: "docs/contracts",
});
const JAVA_KEYWORDS = new Set([
  "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char", "class",
  "const", "continue", "default", "do", "double", "else", "enum", "extends", "final",
  "finally", "float", "for", "goto", "if", "implements", "import", "instanceof", "int",
  "interface", "long", "native", "new", "package", "private", "protected", "public", "return",
  "short", "static", "strictfp", "super", "switch", "synchronized", "this", "throw", "throws",
  "transient", "try", "void", "volatile", "while", "true", "false", "null",
]);
const STABLE_ID_PATTERN = /^[A-Z][A-Z0-9_-]{1,63}$/;
const STANDARD_OPERATIONS = ["page", "detail", "create", "update", "remove"];
const TEAM_DB_CLUSTERS = Object.freeze({
  "com.jhict.sale": "cx",
  "com.jhict.quality": "cx",
  "com.jhict.produce": "cx",
  "com.jhict.cost": "cx",
  "com.jhict.safe": "non_cx",
  "com.jhict.env": "non_cx",
  "com.jhict.logistics": "non_cx",
  "com.jhict.energy": "non_cx",
  "com.jhict.mdm": "pt",
});

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file}: JSON 读取失败：${error.message}`);
  }
}

function fail(errors, location, message) {
  errors.push({ path: location, message });
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function checkKeys(errors, value, location, allowed, required = []) {
  if (!object(value)) {
    fail(errors, location, "必须是对象");
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(errors, `${location}.${key}`, "不支持的属性");
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) fail(errors, `${location}.${key}`, "缺少必填属性");
  }
  return true;
}

function checkString(errors, value, location, pattern, maxLength) {
  if (typeof value !== "string" || value.length === 0) {
    fail(errors, location, "必须是非空字符串");
    return false;
  }
  if (maxLength && value.length > maxLength) fail(errors, location, `长度不能超过 ${maxLength}`);
  if (pattern && !pattern.test(value)) fail(errors, location, "格式不合法");
  return true;
}

function validateDbType(database, dbType) {
  const patterns = database === "oracle"
    ? [
      /^VARCHAR2\([1-9]\d{0,3} CHAR\)$/,
      /^NUMBER\([1-9]\d?(?:,[0-9]\d?)?\)$/,
      /^DATE$/,
      /^TIMESTAMP(?:\([0-9]\))?$/,
      /^CLOB$/,
    ]
    : [
      /^VARCHAR\([1-9]\d{0,4}\)$/,
      /^DECIMAL\([1-9]\d?,[0-9]\d?\)$/,
      /^INT$/,
      /^BIGINT$/,
      /^TINYINT\(1\)$/,
      /^DATE$/,
      /^DATETIME(?:\([0-6]\))?$/,
      /^TEXT$/,
      /^JSON$/,
    ];
  return typeof dbType === "string" && patterns.some((pattern) => pattern.test(dbType));
}

function javaDbTypeCompatible(javaType, database, dbType) {
  const families = {
    String: database === "oracle" ? /^(VARCHAR2|CLOB)/ : /^(VARCHAR|TEXT)/,
    Integer: database === "oracle" ? /^NUMBER\([1-9]\d?\)$/ : /^INT$/,
    Long: database === "oracle" ? /^NUMBER\([1-9]\d?\)$/ : /^BIGINT$/,
    Boolean: database === "oracle" ? /^NUMBER\(1\)$/ : /^TINYINT\(1\)$/,
    BigDecimal: database === "oracle" ? /^NUMBER\(/ : /^DECIMAL\(/,
    LocalDate: /^DATE$/,
    LocalDateTime: database === "oracle" ? /^TIMESTAMP/ : /^DATETIME/,
    "List<String>": database === "oracle" ? /^CLOB$/ : /^(JSON|TEXT)$/,
    "List<Long>": database === "oracle" ? /^CLOB$/ : /^(JSON|TEXT)$/,
  };
  return families[javaType] ? families[javaType].test(dbType) : false;
}

function safeJavaText(value) {
  return typeof value === "string" && !/["\\\r\n]/.test(value) && !value.includes("*/");
}

function validMigrationVersion(value) {
  if (typeof value !== "string" || !/^\d{8}_\d{6}$/.test(value)) return false;
  const compact = value.replace("_", "");
  const year = Number(compact.slice(0, 4));
  const month = Number(compact.slice(4, 6));
  const day = Number(compact.slice(6, 8));
  const hour = Number(compact.slice(8, 10));
  const minute = Number(compact.slice(10, 12));
  const second = Number(compact.slice(12, 14));
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day && hour <= 23 && minute <= 59 && second <= 59;
}

function normalizeOutput(errors, rawOutput, projectRoot) {
  const result = { ...DEFAULT_OUTPUT };
  if (rawOutput === undefined) return result;
  const keys = Object.keys(DEFAULT_OUTPUT);
  if (!checkKeys(errors, rawOutput, "$.output", keys)) return result;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(rawOutput, key)) continue;
    const value = rawOutput[key];
    if (!checkString(errors, value, `$.output.${key}`)) continue;
    const normalized = normalizeRel(value);
    try {
      resolveWithin(projectRoot, normalized);
      result[key] = normalized;
    } catch (error) {
      fail(errors, `$.output.${key}`, error.message);
    }
  }
  return result;
}

function resolveProfile(profileId, projectRoot) {
  const candidates = [
    path.join(projectRoot, ".wl-skills-bd", "profiles", `${profileId}.json`),
    path.join(PACKAGE_FILES, ".wl-skills-bd", "profiles", `${profileId}.json`),
  ];
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) throw new Error(`未找到兼容性 profile：${profileId}`);
  const profile = readJson(file);
  if (profile.id !== profileId || profile.schemaVersion !== 1) {
    throw new Error(`${file}: profile id/schemaVersion 不匹配`);
  }
  if (profile.status !== "supported" || profile.codegenEnabled === false) {
    throw new Error(`${file}: profile ${profileId} 不允许代码生成`);
  }
  if (profile.java !== 8 || profile.springBootMajor !== 2 || profile.serviceStyle !== "direct" || profile.apiDocumentation !== "openapi3") {
    throw new Error(`${file}: 代码生成 profile 必须明确为 Java 8 / Spring Boot 2 / direct Service / OpenAPI 3`);
  }
  const governanceValidation = validateGovernance(profile);
  if (!governanceValidation.ok) {
    throw new Error(`${file}: 治理列 profile 非法：${governanceValidation.errors.join("；")}`);
  }
  const operationNames = [...STANDARD_OPERATIONS];
  if (profile.apiDefaults && profile.apiDefaults.export) operationNames.push("export");
  if (!object(profile.apiDefaults) || operationNames.some((name) => {
    const item = profile.apiDefaults[name];
    return !object(item) || !["GET", "POST", "PUT", "DELETE", "PATCH"].includes(item.method)
      || !/^[A-Za-z][A-Za-z0-9]*(?:\/(?:[A-Za-z][A-Za-z0-9]*|\{[a-z][A-Za-z0-9]*\}))*$/.test(item.path || "");
  })) {
    throw new Error(`${file}: apiDefaults 必须完整声明五个标准操作（export 可选）的 HTTP method/path`);
  }
  if (!object(profile.response) || profile.response.successCode !== 2000
    || JSON.stringify(profile.response.envelope) !== JSON.stringify(["code", "message", "data"])
    || profile.response.pageRecordsPath !== "data.records" || profile.response.pageTotalPath !== "data.total") {
    throw new Error(`${file}: response 必须声明 code=2000、code/message/data 外壳和 data.records/data.total 分页路径`);
  }
  const deliveryCandidates = [
    path.join(projectRoot, ".wl-skills-bd", "contracts", DELIVERY_PROFILE_NAME),
    path.join(PACKAGE_FILES, ".wl-skills-bd", "contracts", DELIVERY_PROFILE_NAME),
  ];
  const deliveryFile = deliveryCandidates.find((candidate) => fs.existsSync(candidate));
  if (!deliveryFile) throw new Error(`未找到统一交付 profile：${DELIVERY_PROFILE_NAME}`);
  const deliveryProfile = readJson(deliveryFile);
  if (deliveryProfile.profileId !== profileId || deliveryProfile.protocolVersion !== "1.0") {
    throw new Error(`${deliveryFile}: profileId/protocolVersion 与 ${profileId}@1.0 不一致`);
  }
  for (const name of STANDARD_OPERATIONS) {
    const backend = profile.apiDefaults[name];
    const shared = deliveryProfile.transport && deliveryProfile.transport.operations
      && deliveryProfile.transport.operations[name];
    if (!shared || backend.method !== shared.method || backend.path !== shared.path) {
      throw new Error(`${file}: apiDefaults.${name} 与统一交付 profile 漂移`);
    }
  }
  const sharedResponse = deliveryProfile.transport && deliveryProfile.transport.responseEnvelope;
  const sharedPagination = deliveryProfile.transport && deliveryProfile.transport.pagination;
  if (!sharedResponse || sharedResponse.successCode !== profile.response.successCode
    || [sharedResponse.codeField, sharedResponse.messageField, sharedResponse.dataField].join("/") !== profile.response.envelope.join("/")
    || !sharedPagination || sharedPagination.responseRecords !== profile.response.pageRecordsPath
    || sharedPagination.responseTotal !== profile.response.pageTotalPath
    || deliveryProfile.transport.concurrency.field !== profile.optimisticLock.javaField) {
    throw new Error(`${file}: response/concurrency 与统一交付 profile 漂移`);
  }
  return { file, profile, deliveryFile, deliveryProfile };
}

const GOVERNANCE_COLUMNS = new Set([
  "ID", "COMPANY_ID", "IS_DELETE", "REVISION", "CREATE_USER_NO", "UPDATE_USER_NO",
  "CREATE_DATE_TIME", "UPDATE_DATE_TIME",
]);

function validateIndexes(errors, rawIndexes, location, database, allowedColumns) {
  if (rawIndexes === undefined) return [];
  if (!Array.isArray(rawIndexes)) {
    fail(errors, location, "必须是数组");
    return [];
  }
  const names = new Set();
  const identifierLimit = database === "oracle" ? 30 : 64;
  return rawIndexes.map((entry, index) => {
    const loc = `${location}[${index}]`;
    if (!checkKeys(errors, entry, loc, ["name", "columns", "unique"], ["name", "columns"])) return null;
    checkString(errors, entry.name, `${loc}.name`, /^[A-Za-z][A-Za-z0-9_]*$/);
    if (typeof entry.name === "string" && entry.name.length > identifierLimit) {
      fail(errors, `${loc}.name`, `${database} 标识符不能超过 ${identifierLimit} 字符`);
    }
    if (names.has(entry.name)) fail(errors, `${loc}.name`, "索引名重复");
    names.add(entry.name);
    if (!Array.isArray(entry.columns) || entry.columns.length === 0) {
      fail(errors, `${loc}.columns`, "columns 必须是非空数组");
    } else {
      const seenColumns = new Set();
      entry.columns.forEach((col, ci) => {
        checkString(errors, col, `${loc}.columns[${ci}]`, /^[A-Z][A-Z0-9_]*$/);
        if (seenColumns.has(col)) fail(errors, `${loc}.columns[${ci}]`, "同一索引不能重复声明列");
        seenColumns.add(col);
        if (allowedColumns && !allowedColumns.has(col)) fail(errors, `${loc}.columns[${ci}]`, `索引引用了不存在的列 ${col}`);
      });
    }
    if (entry.unique !== undefined && typeof entry.unique !== "boolean") fail(errors, `${loc}.unique`, "必须是布尔值");
    if (entry.unique === true && entry.columns.includes("IS_DELETE")) {
      fail(errors, `${loc}.columns`, "唯一索引禁止包含 IS_DELETE：重复创建/删除会在已删除值上冲突；默认采用业务键不复用策略");
    }
    return { name: entry.name, columns: entry.columns, unique: entry.unique === true };
  }).filter(Boolean);
}

function validateVerificationSql(errors, statements, location) {
  if (!Array.isArray(statements) || statements.length === 0) {
    fail(errors, location, "必须至少包含一条只读验证 SQL");
    return;
  }
  const unsafe = /;|--|\/\*|\*\/|\b(?:FOR\s+UPDATE|INTO\s+(?:OUTFILE|DUMPFILE)|SLEEP|BENCHMARK|DBMS_[A-Z0-9_]*|UTL_[A-Z0-9_]*|NEXTVAL|CURRVAL)\b/i;
  statements.forEach((sql, index) => {
    if (!checkString(errors, sql, `${location}[${index}]`)) return;
    if (!/^SELECT\b/i.test(sql.trim()) || unsafe.test(sql)) {
      fail(errors, `${location}[${index}]`, "只能填写无锁、无副作用、无注释且不带分号的 SELECT 验证语句");
    }
  });
}

function validateCustomField(errors, raw, location, contractFieldNames) {
  if (!checkKeys(
    errors,
    raw,
    location,
    ["name", "javaType", "comment", "required", "maxLength", "classification", "masking", "logPolicy"],
    ["name", "javaType", "comment"],
  )) return null;
  checkString(errors, raw.name, `${location}.name`, /^[a-z][A-Za-z0-9]*$/);
  if (typeof raw.name === "string" && RESERVED_FIELDS.has(raw.name)) fail(errors, `${location}.name`, "不能覆盖平台治理字段");
  if (typeof raw.name === "string" && JAVA_KEYWORDS.has(raw.name)) fail(errors, `${location}.name`, "字段名不能是 Java 关键字");
  if (typeof raw.name === "string" && contractFieldNames && contractFieldNames.has(raw.name)) {
    fail(errors, `${location}.name`, "与契约字段重名");
  }
  if (!CUSTOM_FIELD_JAVA_TYPES.has(raw.javaType)) fail(errors, `${location}.javaType`, "Java 类型不在 customField 白名单");
  checkString(errors, raw.comment, `${location}.comment`, null, 100);
  if (!safeJavaText(raw.comment)) fail(errors, `${location}.comment`, "不能包含换行、双引号、反斜杠或注释闭合符");
  if (raw.required !== undefined && typeof raw.required !== "boolean") fail(errors, `${location}.required`, "必须是布尔值");
  if (raw.maxLength !== undefined && (!Number.isInteger(raw.maxLength) || raw.maxLength < 1 || raw.maxLength > 4000)) {
    fail(errors, `${location}.maxLength`, "必须是 1~4000 的整数");
  }
  if (raw.maxLength !== undefined && raw.javaType !== "String") fail(errors, `${location}.maxLength`, "maxLength 只适用于 String");
  validateDataProtection(errors, raw, location);
  return raw;
}

const DATA_CLASSIFICATIONS = ["public", "internal", "confidential", "restricted"];
const SENSITIVE_NAME_PATTERN = /(?:password|passwd|pwd|secret|token|credential|privateKey|idCard|identityNo|bankCard|mobile|phone|email)/i;

function validateDataProtection(errors, field, location) {
  if (field.classification !== undefined && !DATA_CLASSIFICATIONS.includes(field.classification)) {
    fail(errors, `${location}.classification`, "只允许 public/internal/confidential/restricted");
  }
  if (field.masking !== undefined && !["none", "partial", "full"].includes(field.masking)) {
    fail(errors, `${location}.masking`, "只允许 none/partial/full");
  }
  if (field.logPolicy !== undefined && !["allow", "exclude"].includes(field.logPolicy)) {
    fail(errors, `${location}.logPolicy`, "只允许 allow/exclude");
  }
  if (typeof field.name === "string" && SENSITIVE_NAME_PATTERN.test(field.name) && field.classification === undefined) {
    fail(errors, `${location}.classification`, "字段名疑似敏感数据，必须显式声明 classification，禁止依赖默认日志策略");
  }
  if (["confidential", "restricted"].includes(field.classification)) {
    if (field.logPolicy === "allow") fail(errors, `${location}.logPolicy`, "机密/受限字段禁止写入对象 toString 和业务日志");
    if (field.masking === undefined) fail(errors, `${location}.masking`, "机密/受限字段必须显式声明响应脱敏策略 none/partial/full");
  }
}

function validateAssurance(errors, assurance, location, projectRoot) {
  if (assurance === undefined) return undefined;
  const allowed = ["level", "criticality", "slo", "recovery", "security", "dataGovernance", "consistency", "resilience", "evidence"];
  if (!checkKeys(errors, assurance, location, allowed, ["level"])) return assurance;
  if (!["standard", "production"].includes(assurance.level)) fail(errors, `${location}.level`, "只允许 standard/production");
  if (assurance.criticality !== undefined && !["core", "important", "standard"].includes(assurance.criticality)) {
    fail(errors, `${location}.criticality`, "只允许 core/important/standard");
  }
  const production = assurance.level === "production";
  if (production && !assurance.criticality) fail(errors, `${location}.criticality`, "生产保障必须声明业务关键度");
  if (assurance.slo !== undefined || production) {
    if (!checkKeys(errors, assurance.slo, `${location}.slo`, ["availabilityPercent", "p95LatencyMs", "p99LatencyMs", "maxErrorRatePercent"], ["availabilityPercent", "p95LatencyMs", "p99LatencyMs", "maxErrorRatePercent"])) return assurance;
    const slo = assurance.slo || {};
    if (typeof slo.availabilityPercent !== "number" || slo.availabilityPercent < 90 || slo.availabilityPercent > 100) fail(errors, `${location}.slo.availabilityPercent`, "必须是 90~100 的数字");
    for (const key of ["p95LatencyMs", "p99LatencyMs"]) {
      if (!Number.isInteger(slo[key]) || slo[key] < 1 || slo[key] > 600000) fail(errors, `${location}.slo.${key}`, "必须是 1~600000 毫秒整数");
    }
    if (Number.isInteger(slo.p95LatencyMs) && Number.isInteger(slo.p99LatencyMs) && slo.p99LatencyMs < slo.p95LatencyMs) {
      fail(errors, `${location}.slo.p99LatencyMs`, "p99 不能小于 p95");
    }
    if (typeof slo.maxErrorRatePercent !== "number" || slo.maxErrorRatePercent < 0 || slo.maxErrorRatePercent > 10) {
      fail(errors, `${location}.slo.maxErrorRatePercent`, "必须是 0~10 的数字");
    }
  }
  if (assurance.recovery !== undefined || production) {
    if (!checkKeys(errors, assurance.recovery, `${location}.recovery`, ["rtoMinutes", "rpoMinutes"], ["rtoMinutes", "rpoMinutes"])) return assurance;
    const recovery = assurance.recovery || {};
    for (const key of ["rtoMinutes", "rpoMinutes"]) {
      if (!Number.isInteger(recovery[key]) || recovery[key] < 0 || recovery[key] > 525600) fail(errors, `${location}.recovery.${key}`, "必须是 0~525600 分钟整数");
    }
  }
  if (assurance.security !== undefined || production) {
    if (!checkKeys(
      errors,
      assurance.security,
      `${location}.security`,
      ["authorizationModel", "methodSecurityRequired", "auditRequired"],
      ["authorizationModel", "methodSecurityRequired", "auditRequired"],
    )) return assurance;
    const security = assurance.security || {};
    if (!["tenant", "tenant-data-scope", "custom"].includes(security.authorizationModel)) fail(errors, `${location}.security.authorizationModel`, "只允许 tenant/tenant-data-scope/custom");
    if (security.methodSecurityRequired !== true) fail(errors, `${location}.security.methodSecurityRequired`, "生产保障必须强制方法级授权");
    if (security.auditRequired !== true) fail(errors, `${location}.security.auditRequired`, "生产保障必须强制敏感写审计");
  }
  if (assurance.dataGovernance !== undefined || production) {
    if (!checkKeys(
      errors,
      assurance.dataGovernance,
      `${location}.dataGovernance`,
      ["owner", "sourceOfTruth", "classificationDefault", "retentionPolicy"],
      ["owner", "sourceOfTruth", "classificationDefault", "retentionPolicy"],
    )) return assurance;
    const governance = assurance.dataGovernance || {};
    checkString(errors, governance.owner, `${location}.dataGovernance.owner`, null, 100);
    checkString(errors, governance.sourceOfTruth, `${location}.dataGovernance.sourceOfTruth`, null, 100);
    checkString(errors, governance.retentionPolicy, `${location}.dataGovernance.retentionPolicy`, null, 500);
    if (!DATA_CLASSIFICATIONS.includes(governance.classificationDefault)) fail(errors, `${location}.dataGovernance.classificationDefault`, "数据默认分级不合法");
  }
  if (assurance.consistency !== undefined || production) {
    if (!checkKeys(
      errors,
      assurance.consistency,
      `${location}.consistency`,
      ["idempotencyStrategy", "eventDelivery", "crossServiceTransaction"],
      ["idempotencyStrategy", "eventDelivery", "crossServiceTransaction"],
    )) return assurance;
    const consistency = assurance.consistency || {};
    if (!["request-key", "business-key", "state-machine"].includes(consistency.idempotencyStrategy)) fail(errors, `${location}.consistency.idempotencyStrategy`, "只允许 request-key/business-key/state-machine");
    if (!["none", "outbox", "transactional-message"].includes(consistency.eventDelivery)) fail(errors, `${location}.consistency.eventDelivery`, "只允许 none/outbox/transactional-message");
    if (!["none", "saga", "seata"].includes(consistency.crossServiceTransaction)) fail(errors, `${location}.consistency.crossServiceTransaction`, "只允许 none/saga/seata");
  }
  if (assurance.resilience !== undefined || production) {
    if (!checkKeys(
      errors,
      assurance.resilience,
      `${location}.resilience`,
      ["dependencyTimeoutMs", "retryMaxAttempts", "circuitBreakerRequired", "rateLimitRequired"],
      ["dependencyTimeoutMs", "retryMaxAttempts", "circuitBreakerRequired", "rateLimitRequired"],
    )) return assurance;
    const resilience = assurance.resilience || {};
    if (!Number.isInteger(resilience.dependencyTimeoutMs) || resilience.dependencyTimeoutMs < 1 || resilience.dependencyTimeoutMs > 300000) fail(errors, `${location}.resilience.dependencyTimeoutMs`, "必须是 1~300000 毫秒整数");
    if (!Number.isInteger(resilience.retryMaxAttempts) || resilience.retryMaxAttempts < 0 || resilience.retryMaxAttempts > 3) fail(errors, `${location}.resilience.retryMaxAttempts`, "必须是 0~3，且只对幂等调用重试");
    for (const key of ["circuitBreakerRequired", "rateLimitRequired"]) {
      if (typeof resilience[key] !== "boolean") fail(errors, `${location}.resilience.${key}`, "必须显式声明布尔值");
    }
  }
  if (assurance.evidence !== undefined || production) {
    const evidenceKeys = ["threatModelRef", "authorizationReviewRef", "loadTestRef", "runbookRef", "restoreDrillRef", "dataReviewRef"];
    if (!checkKeys(errors, assurance.evidence, `${location}.evidence`, evidenceKeys, evidenceKeys)) return assurance;
    for (const key of evidenceKeys) {
      if (!checkString(errors, assurance.evidence && assurance.evidence[key], `${location}.evidence.${key}`)) continue;
      try {
        resolveWithin(projectRoot, assurance.evidence[key]);
      } catch (error) {
        fail(errors, `${location}.evidence.${key}`, error.message);
      }
    }
  }
  return assurance;
}

function patchValueKind(javaType, value) {
  if (javaType === "String") return typeof value === "string";
  if (javaType === "Integer" || javaType === "Long") return Number.isInteger(value);
  if (javaType === "Boolean") return typeof value === "boolean";
  if (javaType === "BigDecimal") return typeof value === "string" || typeof value === "number";
  if (javaType === "LocalDate") return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
  if (javaType === "LocalDateTime") return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}Z`));
  return false;
}

function validateCustomOperations(errors, rawOps, location, contractFields, contractFieldNames, permissionPrefix) {
  if (rawOps === undefined) return [];
  if (!Array.isArray(rawOps)) {
    fail(errors, location, "必须是数组");
    return [];
  }
  const fieldByName = new Map(contractFields.map((f) => [f.name, f]));
  const names = new Set();
  const permissions = new Set();
  return rawOps.map((op, index) => {
    const loc = `${location}[${index}]`;
    const allowed = ["name", "summary", "method", "path", "permission", "kind", "idFrom", "requestFields", "preconditions", "patch", "externalId"];
    if (!checkKeys(errors, op, loc, allowed, ["name", "summary", "method", "path", "permission", "kind"])) return null;
    checkString(errors, op.name, `${loc}.name`, /^[a-z][A-Za-z0-9]*$/);
    if (typeof op.name === "string" && JAVA_KEYWORDS.has(op.name)) fail(errors, `${loc}.name`, "不能是 Java 关键字");
    if (STANDARD_OPERATIONS.includes(op.name) || op.name === "export") fail(errors, `${loc}.name`, "不能与标准操作重名");
    if (names.has(op.name)) fail(errors, `${loc}.name`, "操作名重复");
    names.add(op.name);
    checkString(errors, op.summary, `${loc}.summary`, null, 50);
    if (!safeJavaText(op.summary)) fail(errors, `${loc}.summary`, "不能包含换行、双引号、反斜杠或注释闭合符");
    if (!["GET", "POST", "PUT", "DELETE", "PATCH"].includes(op.method)) fail(errors, `${loc}.method`, "HTTP 方法不合法");
    checkString(errors, op.path, `${loc}.path`, /^[A-Za-z][A-Za-z0-9]*(?:\/(?:[A-Za-z][A-Za-z0-9]*|\{[a-z][A-Za-z0-9]*\}))*$/);
    checkString(errors, op.permission, `${loc}.permission`, /^[a-z][a-z0-9_:-]*$/);
    if (permissions.has(op.permission)) fail(errors, `${loc}.permission`, "权限码重复");
    permissions.add(op.permission);
    if (typeof op.permission === "string" && permissionPrefix && !op.permission.startsWith(`${permissionPrefix}_`)) {
      fail(errors, `${loc}.permission`, "权限码必须以 permissionPrefix 开头");
    }
    if (!["stateTransition", "command", "batch"].includes(op.kind)) fail(errors, `${loc}.kind`, "kind 不合法");
    const defaultIdFrom = op.kind === "batch" ? "body" : "path";
    const idFrom = op.idFrom || defaultIdFrom;
    if (!["path", "body", "none"].includes(idFrom)) fail(errors, `${loc}.idFrom`, "idFrom 不合法");
    if (idFrom === "path" && typeof op.path === "string" && !op.path.includes("{id}")) {
      fail(errors, `${loc}.path`, "idFrom=path 时路径必须包含 {id}");
    }
    if (op.kind === "batch" && idFrom !== "body") fail(errors, `${loc}.idFrom`, "batch 操作必须从 body 接收 ids");
    if (op.externalId !== undefined) checkString(errors, op.externalId, `${loc}.externalId`, STABLE_ID_PATTERN);
    let requestFields = [];
    if (op.requestFields !== undefined) {
      if (!Array.isArray(op.requestFields)) fail(errors, `${loc}.requestFields`, "必须是数组");
      else {
        const requestNames = new Set();
        requestFields = op.requestFields.map((rf, ri) => {
          const item = validateCustomField(errors, rf, `${loc}.requestFields[${ri}]`, contractFieldNames);
          if (item && requestNames.has(item.name)) fail(errors, `${loc}.requestFields[${ri}].name`, "请求字段名重复");
          if (item) requestNames.add(item.name);
          return item;
        }).filter(Boolean);
      }
    }
    if (op.preconditions !== undefined) {
      if (!Array.isArray(op.preconditions)) fail(errors, `${loc}.preconditions`, "必须是数组");
      else op.preconditions.forEach((pc, pi) => {
        const pLoc = `${loc}.preconditions[${pi}]`;
        if (!checkKeys(errors, pc, pLoc, ["field", "operator", "value", "message"], ["field", "operator", "value", "message"])) return;
        const target = fieldByName.get(pc.field);
        if (!target) fail(errors, `${pLoc}.field`, `引用了不存在的契约字段 ${pc.field}`);
        if (!["equals", "notEquals", "in", "notIn", "isNull", "notNull"].includes(pc.operator)) {
          fail(errors, `${pLoc}.operator`, "operator 不合法");
        }
        if (["in", "notIn"].includes(pc.operator) && !Array.isArray(pc.value)) fail(errors, `${pLoc}.value`, "in/notIn 的 value 必须是数组");
        if (["isNull", "notNull"].includes(pc.operator) && pc.value !== null) fail(errors, `${pLoc}.value`, "isNull/notNull 的 value 必须为 null");
        if (target && ["equals", "notEquals"].includes(pc.operator) && !patchValueKind(target.javaType, pc.value)) {
          fail(errors, `${pLoc}.value`, `值类型与字段 ${pc.field} (${target.javaType}) 不匹配`);
        }
        if (target && ["in", "notIn"].includes(pc.operator) && Array.isArray(pc.value)
          && pc.value.some((value) => !patchValueKind(target.javaType, value))) {
          fail(errors, `${pLoc}.value`, `数组值类型与字段 ${pc.field} (${target.javaType}) 不匹配`);
        }
        const conditionValues = ["in", "notIn"].includes(pc.operator) ? pc.value : [pc.value];
        if (target && Array.isArray(target.enumValues) && !["isNull", "notNull"].includes(pc.operator)
          && conditionValues.some((value) => !target.enumValues.map((item) => JSON.stringify(item)).includes(JSON.stringify(value)))) {
          fail(errors, `${pLoc}.value`, `前置条件值不在字段 ${pc.field} 的 enumValues 中`);
        }
        checkString(errors, pc.message, `${pLoc}.message`, null, 100);
      });
    }
    if (op.patch !== undefined) {
      if (!Array.isArray(op.patch)) fail(errors, `${loc}.patch`, "必须是数组");
      else op.patch.forEach((pa, pi) => {
        const pLoc = `${loc}.patch[${pi}]`;
        if (!checkKeys(errors, pa, pLoc, ["field", "value", "fromRequest"], ["field"])) return;
        const target = fieldByName.get(pa.field);
        if (!target) fail(errors, `${pLoc}.field`, `引用了不存在的契约字段 ${pa.field}`);
        const hasValue = Object.prototype.hasOwnProperty.call(pa, "value");
        const hasFromRequest = Object.prototype.hasOwnProperty.call(pa, "fromRequest");
        if (hasValue === hasFromRequest) fail(errors, pLoc, "value 与 fromRequest 必须且只能声明一个");
        if (target && hasValue && !patchValueKind(target.javaType, pa.value)) {
          fail(errors, `${pLoc}.value`, `值类型与字段 ${pa.field} (${target.javaType}) 不匹配`);
        }
        if (hasFromRequest) {
          const requestField = requestFields.find((field) => field.name === pa.fromRequest);
          if (!requestField) fail(errors, `${pLoc}.fromRequest`, `引用了不存在的请求字段 ${pa.fromRequest}`);
          else if (target && requestField.javaType !== target.javaType) {
            fail(errors, `${pLoc}.fromRequest`, `请求字段 ${pa.fromRequest} (${requestField.javaType}) 与目标字段 ${pa.field} (${target.javaType}) 类型不一致`);
          }
        }
      });
    }
    const consumedRequestFields = new Set((op.patch || []).map((item) => item.fromRequest).filter(Boolean));
    for (const requestField of requestFields) {
      if (!consumedRequestFields.has(requestField.name)) {
        fail(errors, `${loc}.requestFields`, `请求字段 ${requestField.name} 未被 patch.fromRequest 消费，禁止生成静默丢弃参数的接口`);
      }
    }
    if (idFrom === "none" && ((op.preconditions || []).length > 0 || (op.patch || []).length > 0)) {
      fail(errors, loc, "idFrom=none 的全局命令不能声明实体 preconditions/patch");
    }
    if (op.kind === "stateTransition" && (op.patch || []).length === 0) {
      fail(errors, `${loc}.patch`, "stateTransition 必须声明非空 patch");
    }
    return { ...op, idFrom };
  }).filter(Boolean);
}

function validateRelations(errors, rawRelations, location, contractId) {
  if (rawRelations === undefined) return [];
  if (!Array.isArray(rawRelations)) {
    fail(errors, location, "必须是数组");
    return [];
  }
  const names = new Set();
  return rawRelations.map((rel, index) => {
    const loc = `${location}[${index}]`;
    const allowed = ["name", "type", "detailEntity", "detailContractId", "joinColumn", "cascadeSoftDelete", "exposeQuery", "externalId"];
    if (!checkKeys(errors, rel, loc, allowed, ["name", "type", "detailEntity", "detailContractId", "joinColumn"])) return null;
    checkString(errors, rel.name, `${loc}.name`, /^[a-z][A-Za-z0-9]*$/);
    if (names.has(rel.name)) fail(errors, `${loc}.name`, "关联名重复");
    names.add(rel.name);
    if (rel.type !== "one-to-many") fail(errors, `${loc}.type`, "当前只支持 one-to-many");
    checkString(errors, rel.detailEntity, `${loc}.detailEntity`, /^[A-Z][A-Za-z0-9]*$/);
    checkString(errors, rel.detailContractId, `${loc}.detailContractId`, /^[a-z][a-z0-9-]{2,79}$/);
    if (rel.detailContractId === contractId) fail(errors, `${loc}.detailContractId`, "不能自引用");
    checkString(errors, rel.joinColumn, `${loc}.joinColumn`, /^[A-Z][A-Z0-9_]*$/);
    if (rel.cascadeSoftDelete !== undefined && typeof rel.cascadeSoftDelete !== "boolean") fail(errors, `${loc}.cascadeSoftDelete`, "必须是布尔值");
    if (rel.exposeQuery !== undefined && typeof rel.exposeQuery !== "boolean") fail(errors, `${loc}.exposeQuery`, "必须是布尔值");
    if (rel.externalId !== undefined) checkString(errors, rel.externalId, `${loc}.externalId`, STABLE_ID_PATTERN);
    return {
      name: rel.name,
      type: rel.type,
      detailEntity: rel.detailEntity,
      detailContractId: rel.detailContractId,
      joinColumn: rel.joinColumn,
      cascadeSoftDelete: rel.cascadeSoftDelete === true,
      exposeQuery: rel.exposeQuery !== false,
      ...(rel.externalId ? { externalId: rel.externalId } : {}),
    };
  }).filter(Boolean);
}

function validateAlter(errors, rawAlter, location, database, allowedColumns) {
  if (rawAlter === undefined) return null;
  const allowed = ["version", "phase", "approvalRef", "rollbackStrategy", "verificationSql", "operations", "indexes"];
  if (!checkKeys(errors, rawAlter, location, allowed, ["version", "phase", "rollbackStrategy", "verificationSql", "operations"])) return null;
  checkString(errors, rawAlter.version, `${location}.version`, /^[0-9]{8}_[0-9]{6}$/);
  if (!validMigrationVersion(rawAlter.version)) fail(errors, `${location}.version`, "必须是真实的 YYYYMMDD_HHmmss 时间");
  if (!checkString(errors, rawAlter.rollbackStrategy, `${location}.rollbackStrategy`) || rawAlter.rollbackStrategy.length < 20) {
    fail(errors, `${location}.rollbackStrategy`, "必须给出至少 20 个字符的可执行恢复策略");
  }
  if (!["expand", "contract"].includes(rawAlter.phase)) fail(errors, `${location}.phase`, "phase 只允许 expand/contract");
  if (rawAlter.phase === "contract") {
    checkString(errors, rawAlter.approvalRef, `${location}.approvalRef`, /^[A-Z][A-Z0-9_-]{5,63}$/);
  } else if (rawAlter.approvalRef !== undefined) {
    checkString(errors, rawAlter.approvalRef, `${location}.approvalRef`, /^[A-Z][A-Z0-9_-]{5,63}$/);
  }
  validateVerificationSql(errors, rawAlter.verificationSql, `${location}.verificationSql`);
  if (!Array.isArray(rawAlter.operations) || rawAlter.operations.length === 0) {
    fail(errors, `${location}.operations`, "operations 必须是非空数组");
    return null;
  }
  const fieldKeys = ["name", "column", "javaType", "dbType", "comment", "requiredOnCreate", "queryMode", "maxLength"];
  const ops = rawAlter.operations.map((op, i) => {
    const loc = `${location}.operations[${i}]`;
    if (!checkKeys(errors, op, loc, ["type", "field", "column", "fromDbType", "dbType", "comment", "compatibility"], ["type"])) return null;
    if (!["add", "drop", "modify"].includes(op.type)) { fail(errors, `${loc}.type`, "type 只能是 add/drop/modify"); return null; }
    if (op.type === "add") {
      if (!object(op.field)) { fail(errors, `${loc}.field`, "add 操作必须提供 field 对象"); return null; }
      const f = op.field;
      if (!checkKeys(errors, f, `${loc}.field`, fieldKeys, ["name", "column", "javaType", "dbType", "comment"])) return null;
      checkString(errors, f.name, `${loc}.field.name`, /^[a-z][A-Za-z0-9]*$/);
      checkString(errors, f.column, `${loc}.field.column`, /^[A-Z][A-Z0-9_]*$/);
      checkString(errors, f.comment, `${loc}.field.comment`, null, 100);
      if (!safeJavaText(f.comment)) fail(errors, `${loc}.field.comment`, "不能包含换行、双引号、反斜杠或注释闭合符");
      if (!JAVA_TYPES.has(f.javaType)) fail(errors, `${loc}.field.javaType`, "Java 类型不在安全白名单");
      if (!validateDbType(database, f.dbType)) fail(errors, `${loc}.field.dbType`, `不是受支持的 ${database} 字段类型`);
      else if (JAVA_TYPES.has(f.javaType) && !javaDbTypeCompatible(f.javaType, database, f.dbType)) fail(errors, `${loc}.field.dbType`, `与 Java 类型 ${f.javaType} 不兼容`);
      if (f.requiredOnCreate === true) fail(errors, `${loc}.field.requiredOnCreate`, "expand 阶段新增列必须先允许 NULL；回填完成后再用独立迁移收紧约束");
      return { type: "add", field: f };
    }
    if (op.type === "drop") {
      checkString(errors, op.column, `${loc}.column`, /^[A-Z][A-Z0-9_]*$/);
      return { type: "drop", column: op.column };
    }
    checkString(errors, op.column, `${loc}.column`, /^[A-Z][A-Z0-9_]*$/);
    checkString(errors, op.fromDbType, `${loc}.fromDbType`);
    if (!validateDbType(database, op.fromDbType)) fail(errors, `${loc}.fromDbType`, `不是受支持的 ${database} 字段类型`);
    checkString(errors, op.dbType, `${loc}.dbType`);
    if (!validateDbType(database, op.dbType)) fail(errors, `${loc}.dbType`, `不是受支持的 ${database} 字段类型`);
    checkString(errors, op.comment, `${loc}.comment`, null, 100);
    if (op.compatibility !== "widening") fail(errors, `${loc}.compatibility`, "modify 只允许显式声明 widening；缩窄或类型转换必须走人工迁移方案");
    return { type: "modify", column: op.column, fromDbType: op.fromDbType, dbType: op.dbType, comment: op.comment, compatibility: op.compatibility };
  }).filter(Boolean);
  if (rawAlter.phase === "expand" && ops.some((op) => op.type === "drop")) {
    fail(errors, `${location}.operations`, "expand 阶段禁止 drop；删除列必须使用独立 contract 迁移并提供 approvalRef");
  }
  if (rawAlter.phase === "contract" && ops.some((op) => op.type !== "drop")) {
    fail(errors, `${location}.operations`, "contract 阶段只能包含 drop，禁止与 add/modify 混合");
  }
  const indexes = validateIndexes(errors, rawAlter.indexes, `${location}.indexes`, database, allowedColumns);
  return { ...rawAlter, operations: ops, ...(indexes.length ? { indexes } : {}) };
}

function validateContract(raw, options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const errors = [];
  const topKeys = [
    "schemaVersion", "contractId", "profile", "rootPackage", "module", "externalId",
    "environment", "dbCluster",
    "entity", "api", "database", "migration", "output", "fields",
    "indexes", "customOperations", "relations", "alter", "assurance",
  ];
  const topRequired = topKeys.filter((key) => !["output", "externalId", "environment", "dbCluster", "indexes", "customOperations", "relations", "alter", "assurance"].includes(key));
  if (!checkKeys(errors, raw, "$", topKeys, topRequired)) return { ok: false, errors };

  if (raw.schemaVersion !== 1) fail(errors, "$.schemaVersion", "只支持 schemaVersion=1");
  checkString(errors, raw.contractId, "$.contractId", /^[a-z][a-z0-9-]{2,79}$/);
  checkString(errors, raw.profile, "$.profile", /^[a-z][a-z0-9-]+$/);
  checkString(errors, raw.rootPackage, "$.rootPackage", /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/);
  checkString(errors, raw.module, "$.module", /^[a-z][a-zA-Z0-9]*$/);
  if (typeof raw.rootPackage === "string" && raw.rootPackage.split(".").some((part) => JAVA_KEYWORDS.has(part))) fail(errors, "$.rootPackage", "包名不能包含 Java 关键字");
  if (JAVA_KEYWORDS.has(raw.module)) fail(errors, "$.module", "模块名不能是 Java 关键字");
  if (raw.externalId !== undefined) checkString(errors, raw.externalId, "$.externalId", STABLE_ID_PATTERN);
  if (raw.environment !== undefined && !["dev", "sit", "uat", "pre", "prod"].includes(raw.environment)) {
    fail(errors, "$.environment", "environment 只支持 dev/sit/uat/pre/prod");
  }
  if (raw.dbCluster !== undefined && !["cx", "non_cx", "pt"].includes(raw.dbCluster)) {
    fail(errors, "$.dbCluster", "dbCluster 只支持 cx/non_cx/pt（产销/非产销/平台）");
  }
  if (raw.dbCluster && TEAM_DB_CLUSTERS[raw.rootPackage] && raw.dbCluster !== TEAM_DB_CLUSTERS[raw.rootPackage]) {
    fail(errors, "$.dbCluster", `根包 ${raw.rootPackage} 按团队开发手册必须使用 ${TEAM_DB_CLUSTERS[raw.rootPackage]} 集群`);
  }
  const assurance = validateAssurance(errors, raw.assurance, "$.assurance", projectRoot);

  if (checkKeys(errors, raw.entity, "$.entity", ["name", "table", "description"], ["name", "table", "description"])) {
    checkString(errors, raw.entity.name, "$.entity.name", /^[A-Z][A-Za-z0-9]*$/);
    checkString(errors, raw.entity.table, "$.entity.table", /^[A-Za-z][A-Za-z0-9_]*$/);
    checkString(errors, raw.entity.description, "$.entity.description", null, 100);
    if (!safeJavaText(raw.entity.description)) fail(errors, "$.entity.description", "不能包含换行、双引号、反斜杠或注释闭合符");
  }

  const permissionNames = [...STANDARD_OPERATIONS];
  const permissionAllowed = [...STANDARD_OPERATIONS, "export"];
  if (checkKeys(errors, raw.api, "$.api", ["requestPath", "externalBasePath", "permissionPrefix", "permissions"], ["requestPath", "externalBasePath", "permissionPrefix", "permissions"])) {
    checkString(errors, raw.api.requestPath, "$.api.requestPath", /^[a-z][A-Za-z0-9]*$/);
    checkString(errors, raw.api.externalBasePath, "$.api.externalBasePath", /^\/[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/);
    if (typeof raw.api.externalBasePath === "string" && !raw.api.externalBasePath.endsWith(`/${raw.api.requestPath}`)) {
      fail(errors, "$.api.externalBasePath", "必须以 /requestPath 结尾，确保网关外部路径映射到 Controller 路径");
    }
    checkString(errors, raw.api.permissionPrefix, "$.api.permissionPrefix", /^[a-z][a-z0-9_:-]*$/);
    if (checkKeys(errors, raw.api.permissions, "$.api.permissions", permissionAllowed, permissionNames)) {
      const values = [];
      for (const name of permissionAllowed) {
        if (name === "export" && raw.api.permissions.export === undefined) continue;
        checkString(errors, raw.api.permissions[name], `$.api.permissions.${name}`, /^[a-z][a-z0-9_:-]*$/);
        values.push(raw.api.permissions[name]);
      }
      const present = values.filter(Boolean);
      if (new Set(present).size !== present.length) fail(errors, "$.api.permissions", "权限码必须唯一");
      if (typeof raw.api.permissionPrefix === "string" && present.some((value) => typeof value === "string" && !value.startsWith(`${raw.api.permissionPrefix}_`))) {
        fail(errors, "$.api.permissions", "每个权限码都必须以前缀 permissionPrefix 开头");
      }
    }
  }

  if (!['oracle', 'mysql'].includes(raw.database)) fail(errors, "$.database", "只支持 oracle 或 mysql");
  if (checkKeys(errors, raw.migration, "$.migration", ["version", "rollbackStrategy", "verificationSql"], ["version", "rollbackStrategy", "verificationSql"])) {
    checkString(errors, raw.migration.version, "$.migration.version", /^[0-9]{8}_[0-9]{6}$/);
    if (!validMigrationVersion(raw.migration.version)) fail(errors, "$.migration.version", "必须是真实的 YYYYMMDD_HHmmss 时间");
    if (!checkString(errors, raw.migration.rollbackStrategy, "$.migration.rollbackStrategy") || raw.migration.rollbackStrategy.length < 20) {
      fail(errors, "$.migration.rollbackStrategy", "必须给出至少 20 个字符的可执行恢复策略");
    }
    validateVerificationSql(errors, raw.migration.verificationSql, "$.migration.verificationSql");
  }

  const output = normalizeOutput(errors, raw.output, projectRoot);
  const fieldKeys = [
    "name", "column", "javaType", "dbType", "comment", "requiredOnCreate",
    "writable", "queryMode", "detail", "list", "maxLength", "externalId", "semanticId",
    "definition", "enumValues", "initialValue", "classification", "masking", "logPolicy",
    "encryptionRequired", "retentionDays", "dataOwner", "sourceOfTruth",
  ];
  const names = new Set();
  const columns = new Set();
  const contractFieldNames = new Set();
  const fieldList = [];
  if (!Array.isArray(raw.fields) || raw.fields.length === 0) {
    fail(errors, "$.fields", "至少需要一个业务字段");
  } else {
    raw.fields.forEach((field, index) => {
      const location = `$.fields[${index}]`;
      if (!checkKeys(errors, field, location, fieldKeys, ["name", "column", "javaType", "dbType", "comment", "writable"])) return;
      checkString(errors, field.name, `${location}.name`, /^[a-z][A-Za-z0-9]*$/);
      checkString(errors, field.column, `${location}.column`, /^[A-Z][A-Z0-9_]*$/);
      checkString(errors, field.comment, `${location}.comment`, null, 100);
      if (!safeJavaText(field.comment)) fail(errors, `${location}.comment`, "不能包含换行、双引号、反斜杠或注释闭合符");
      if (!JAVA_TYPES.has(field.javaType)) fail(errors, `${location}.javaType`, "Java 类型不在安全白名单");
      if (!validateDbType(raw.database, field.dbType)) fail(errors, `${location}.dbType`, `不是受支持的 ${raw.database} 字段类型`);
      else if (JAVA_TYPES.has(field.javaType) && !javaDbTypeCompatible(field.javaType, raw.database, field.dbType)) fail(errors, `${location}.dbType`, `与 Java 类型 ${field.javaType} 不兼容`);
      if (names.has(field.name)) fail(errors, `${location}.name`, "字段名重复");
      if (columns.has(field.column)) fail(errors, `${location}.column`, "列名重复");
      if (RESERVED_FIELDS.has(field.name)) fail(errors, `${location}.name`, "不能覆盖平台治理字段");
      if (JAVA_KEYWORDS.has(field.name)) fail(errors, `${location}.name`, "字段名不能是 Java 关键字");
      if (["ID", "COMPANY_ID", "IS_DELETE", "REVISION", "CREATE_USER_NO", "UPDATE_USER_NO", "CREATE_DATE_TIME", "UPDATE_DATE_TIME"].includes(field.column)) {
        fail(errors, `${location}.column`, "不能覆盖平台治理列");
      }
      if (field.externalId !== undefined) checkString(errors, field.externalId, `${location}.externalId`, STABLE_ID_PATTERN);
      if (field.semanticId !== undefined) checkString(errors, field.semanticId, `${location}.semanticId`, STABLE_ID_PATTERN);
      if (field.definition !== undefined) checkString(errors, field.definition, `${location}.definition`, null, 500);
      if (field.dataOwner !== undefined) checkString(errors, field.dataOwner, `${location}.dataOwner`, null, 100);
      if (field.sourceOfTruth !== undefined) checkString(errors, field.sourceOfTruth, `${location}.sourceOfTruth`, null, 100);
      validateDataProtection(errors, field, location);
      if (field.encryptionRequired !== undefined && typeof field.encryptionRequired !== "boolean") {
        fail(errors, `${location}.encryptionRequired`, "必须是布尔值");
      }
      if (field.retentionDays !== undefined && (!Number.isInteger(field.retentionDays) || field.retentionDays < 1 || field.retentionDays > 36500)) {
        fail(errors, `${location}.retentionDays`, "必须是 1~36500 的整数");
      }
      names.add(field.name);
      columns.add(field.column);
      contractFieldNames.add(field.name);
      const identifierLimit = raw.database === "oracle" ? 30 : 64;
      if (typeof field.column === "string" && field.column.length > identifierLimit) fail(errors, `${location}.column`, `${raw.database} 标识符不能超过 ${identifierLimit} 字符`);
      for (const key of ["requiredOnCreate", "writable", "detail", "list"]) {
        if (field[key] !== undefined && typeof field[key] !== "boolean") fail(errors, `${location}.${key}`, "必须是布尔值");
      }
      if (field.queryMode !== undefined && !["none", "eq", "like"].includes(field.queryMode)) fail(errors, `${location}.queryMode`, "只允许 none/eq/like");
      if (field.queryMode === "like" && field.javaType !== "String") fail(errors, `${location}.queryMode`, "like 只适用于 String 字段");
      if (field.requiredOnCreate === true && field.writable === false) fail(errors, location, "只读字段不能同时要求新增必填");
      if (Object.prototype.hasOwnProperty.call(field, "initialValue")) {
        if (field.writable !== false) fail(errors, `${location}.initialValue`, "initialValue 只允许用于不可由通用 DTO 写入的治理/状态字段");
        if (!patchValueKind(field.javaType, field.initialValue)) fail(errors, `${location}.initialValue`, "初始值类型与 javaType 不匹配");
        if (!["String", "Integer", "Long", "Boolean", "BigDecimal"].includes(field.javaType)) {
          fail(errors, `${location}.initialValue`, "为保证 Oracle/MySQL 确定性，初始值仅支持 String/Integer/Long/Boolean/BigDecimal");
        }
      }
      if (field.enumValues !== undefined) {
        if (!Array.isArray(field.enumValues) || field.enumValues.length === 0) fail(errors, `${location}.enumValues`, "必须是非空数组");
        else {
          if (field.enumValues.some((value) => !patchValueKind(field.javaType, value))) {
            fail(errors, `${location}.enumValues`, "枚举值类型与 javaType 不匹配");
          }
          const stableValues = field.enumValues.map((value) => JSON.stringify(value));
          if (new Set(stableValues).size !== stableValues.length) fail(errors, `${location}.enumValues`, "枚举值不能重复");
          if (Object.prototype.hasOwnProperty.call(field, "initialValue")
            && !stableValues.includes(JSON.stringify(field.initialValue))) {
            fail(errors, `${location}.initialValue`, "初始值必须包含在 enumValues 中");
          }
        }
      }
      if (field.maxLength !== undefined && (!Number.isInteger(field.maxLength) || field.maxLength < 1 || field.maxLength > 4000)) {
        fail(errors, `${location}.maxLength`, "必须是 1~4000 的整数");
      }
      if (field.maxLength !== undefined && !["String", "List<String>", "List<Long>"].includes(field.javaType)) {
        fail(errors, `${location}.maxLength`, "maxLength 只适用于 String/List 字段");
      }
      fieldList.push(field);
    });
  }

  const allowedColumns = new Set([...GOVERNANCE_COLUMNS, ...columns]);
  const indexes = validateIndexes(errors, raw.indexes, "$.indexes", raw.database, allowedColumns);
  const customOperations = validateCustomOperations(errors, raw.customOperations, "$.customOperations", fieldList, contractFieldNames, raw.api && raw.api.permissionPrefix);
  for (const [operationIndex, operation] of (raw.customOperations || []).entries()) {
    if (!operation || operation.kind !== "stateTransition") continue;
    const stateFields = new Set((operation.preconditions || []).map((item) => item.field));
    for (const stateFieldName of stateFields) {
      const stateField = fieldList.find((field) => field.name === stateFieldName);
      if (!stateField) continue;
      if (!Array.isArray(stateField.enumValues) || stateField.enumValues.length === 0) {
        fail(errors, `$.fields[${fieldList.indexOf(stateField)}].enumValues`, `状态机操作 ${operation.name} 引用的字段必须声明统一 enumValues`);
      }
      if (!raw.alter && !Object.prototype.hasOwnProperty.call(stateField, "initialValue")) {
        fail(errors, `$.fields[${fieldList.indexOf(stateField)}].initialValue`, `新建表的状态机字段必须声明初始值，避免新增后无法进入流程`);
      }
    }
    for (const [patchIndex, item] of (operation.patch || []).entries()) {
      if (!Object.prototype.hasOwnProperty.call(item, "value")) continue;
      const target = fieldList.find((field) => field.name === item.field);
      if (target && Array.isArray(target.enumValues)
        && !target.enumValues.map((value) => JSON.stringify(value)).includes(JSON.stringify(item.value))) {
        fail(errors, `$.customOperations[${operationIndex}].patch[${patchIndex}].value`, `状态变更值不在字段 ${item.field} 的 enumValues 中`);
      }
    }
  }
  const relations = validateRelations(errors, raw.relations, "$.relations", raw.contractId);
  const alter = validateAlter(errors, raw.alter, "$.alter", raw.database, allowedColumns);
  if (alter && indexes.length > 0) fail(errors, "$.indexes", "ALTER 契约的新索引必须声明在 alter.indexes；顶层 indexes 代表建表时索引，禁止在 ALTER 中重复创建");

  if (object(raw.entity)) {
    const identifierLimit = raw.database === "oracle" ? 30 : 64;
    if (typeof raw.entity.table === "string" && raw.entity.table.length > identifierLimit) fail(errors, "$.entity.table", `${raw.database} 标识符不能超过 ${identifierLimit} 字符`);
  }

  let profileInfo;
  if (typeof raw.profile === "string") {
    try {
      profileInfo = resolveProfile(raw.profile, projectRoot);
    } catch (error) {
      fail(errors, "$.profile", error.message);
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const contract = {
    ...raw,
    output,
    fields: fieldList.map((field) => ({
      requiredOnCreate: false,
      writable: false,
      queryMode: "none",
      detail: true,
      list: true,
      ...field,
    })),
    ...(indexes.length > 0 ? { indexes } : {}),
    ...(customOperations.length > 0 ? { customOperations } : {}),
    ...(relations.length > 0 ? { relations } : {}),
    ...(alter ? { alter } : {}),
    ...(assurance ? { assurance } : {}),
  };
  return {
    ok: true,
    errors: [],
    contract,
    profile: profileInfo.profile,
    profileFile: profileInfo.file,
    deliveryProfile: profileInfo.deliveryProfile,
    deliveryProfileFile: profileInfo.deliveryFile,
  };
}

function loadContract(file, options = {}) {
  const absolute = path.resolve(options.projectRoot || process.cwd(), file);
  const raw = readJson(absolute);
  const result = validateContract(raw, { ...options, projectRoot: options.projectRoot || path.dirname(absolute) });
  return { ...result, file: absolute };
}

function upperFirst(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatJavaDeclaration(prefix, params, suffix) {
  const baseIndent = "    ";
  const continuation = "            ";
  const compact = `${baseIndent}${prefix}(${params.join(", ")})${suffix}`;
  if (compact.length <= 100) return compact.slice(baseIndent.length, -suffix.length);
  const combined = `${continuation}${params.join(", ")})${suffix}`;
  if (combined.length <= 100) {
    return `${prefix}(\n${continuation}${params.join(", ")})`;
  }
  return `${prefix}(\n${params.map((param) => `${continuation}${param}`).join(",\n")})`;
}

function importsFor(fields) {
  return [...new Set(fields.map((field) => TYPE_IMPORTS[field.javaType]).filter(Boolean))].sort();
}

function fieldView(field, validationMode) {
  const annotations = [];
  if (validationMode === "create" && field.requiredOnCreate) {
    annotations.push(field.javaType === "String"
      ? `@NotBlank(message = "${field.comment}不能为空")`
      : `@NotNull(message = "${field.comment}不能为空")`);
  }
  if (field.maxLength !== undefined) annotations.push(`@Size(max = ${field.maxLength}, message = "${field.comment}长度不能超过${field.maxLength}")`);
  const persistenceAnnotations = field.javaType.startsWith("List<")
    ? ["@TableField(typeHandler = JacksonTypeHandler.class)"]
    : [];
  return {
    ...field,
    field: field.name,
    Field: upperFirst(field.name),
    COLUMN: field.column,
    fieldType: field.javaType,
    fieldComment: field.comment.replace(/[\r\n]/g, " "),
    validationAnnotations: annotations,
    persistenceAnnotations,
    excludeFromToString: field.logPolicy === "exclude"
      || ["confidential", "restricted"].includes(field.classification)
      || SENSITIVE_NAME_PATTERN.test(field.name),
  };
}

function testValue(javaType) {
  const values = {
    String: '"sample"',
    Integer: "1",
    Long: "1L",
    Boolean: "Boolean.TRUE",
    BigDecimal: 'new java.math.BigDecimal("1.00")',
    LocalDate: "java.time.LocalDate.of(2026, 1, 1)",
    LocalDateTime: "java.time.LocalDateTime.of(2026, 1, 1, 0, 0)",
    "List<String>": 'java.util.Collections.singletonList("sample")',
    "List<Long>": "java.util.Collections.singletonList(1L)",
  };
  return values[javaType];
}

function customFieldView(field) {
  return {
    ...field,
    field: field.name,
    Field: upperFirst(field.name),
    fieldType: field.javaType,
    fieldComment: field.comment.replace(/[\r\n]/g, " "),
    validationAnnotations: [
      ...(field.required ? [field.javaType === "String"
        ? `@NotBlank(message = "${field.comment}不能为空")`
        : `@NotNull(message = "${field.comment}不能为空")`] : []),
      ...(field.maxLength ? [`@Size(max = ${field.maxLength}, message = "${field.comment}长度不能超过${field.maxLength}")`] : []),
    ],
    excludeFromToString: field.logPolicy === "exclude"
      || ["confidential", "restricted"].includes(field.classification)
      || SENSITIVE_NAME_PATTERN.test(field.name),
    testValue: testValue(field.javaType),
  };
}

function literalValue(javaType, value) {
  if (value === null) return "null";
  if (javaType === "String") return JSON.stringify(String(value));
  if (javaType === "Integer" || javaType === "Long") return `${Number(value)}${javaType === "Long" ? "L" : ""}`;
  if (javaType === "Boolean") return value ? "Boolean.TRUE" : "Boolean.FALSE";
  if (javaType === "BigDecimal") return `new java.math.BigDecimal("${value}")`;
  if (javaType === "LocalDate") return `java.time.LocalDate.parse("${value}")`;
  if (javaType === "LocalDateTime") return `java.time.LocalDateTime.parse("${value}")`;
  throw new Error(`不支持的 Java 字面量类型：${javaType}`);
}

function preconditionJava(pc, entityName, javaType) {
  const actual = `${entityName}.get${upperFirst(pc.field)}()`;
  if (pc.operator === "isNull") return `ServiceAssert.isTrue(${actual} == null, "${pc.message}")`;
  if (pc.operator === "notNull") return `ServiceAssert.isNotNull(${actual}, "${pc.message}")`;
  const v = literalValue(javaType, pc.value);
  if (pc.operator === "equals") {
    const statement = `ServiceAssert.isTrue(java.util.Objects.equals(${actual}, ${v}), "${pc.message}")`;
    if (statement.length + 8 <= 100) return statement;
    return `ServiceAssert.isTrue(\n                java.util.Objects.equals(${actual}, ${v}),\n                "${pc.message}")`;
  }
  if (pc.operator === "notEquals") {
    const statement = `ServiceAssert.isTrue(!java.util.Objects.equals(${actual}, ${v}), "${pc.message}")`;
    if (statement.length + 8 <= 100) return statement;
    return `ServiceAssert.isTrue(\n                !java.util.Objects.equals(${actual}, ${v}),\n                "${pc.message}")`;
  }
  if (pc.operator === "in") {
    const set = `java.util.Arrays.asList(${pc.value.map((x) => literalValue(javaType, x)).join(", ")})`;
    return `ServiceAssert.isTrue(\n                ${set}.contains(${actual}),\n                "${pc.message}")`;
  }
  if (pc.operator === "notIn") {
    const set = `java.util.Arrays.asList(${pc.value.map((x) => literalValue(javaType, x)).join(", ")})`;
    return `ServiceAssert.isTrue(\n                !${set}.contains(${actual}),\n                "${pc.message}")`;
  }
  return `// unsupported operator ${pc.operator}`;
}

function customOperationContext(op, contract) {
  const entityVar = "entity";
  const requestFields = (op.requestFields || []).map(customFieldView);
  const preconditions = (op.preconditions || []).map((pc) => {
    const target = contract.fields.find((field) => field.name === pc.field);
    const java = preconditionJava(pc, entityVar, target.javaType);
    return {
      java,
      batchJava: java.replace(/\n {16}/g, "\n                    "),
      message: pc.message,
    };
  });
  const patchLines = (op.patch || []).map((pa) => {
    const target = contract.fields.find((f) => f.name === pa.field);
    const javaType = target ? target.javaType : "String";
    return {
      field: pa.field,
      Field: upperFirst(pa.field),
      value: pa.fromRequest ? `request.get${upperFirst(pa.fromRequest)}()` : literalValue(javaType, pa.value),
    };
  });
  const isBatch = op.kind === "batch";
  const hasId = op.idFrom === "path";
  const hasBodyId = !isBatch && op.idFrom === "body";
  const hasBodyIds = isBatch;
  const methodName = op.name;
  const methodNameCapital = upperFirst(op.name);
  const httpAnnotation = { GET: "GetMapping", POST: "PostMapping", PUT: "PutMapping", DELETE: "DeleteMapping", PATCH: "PatchMapping" }[op.method];
  const controllerParams = [];
  const serviceArgs = [];
  const serviceParams = [];
  if (hasId) {
    controllerParams.push('@Parameter(description = "主键ID") @PathVariable("id") String id');
    serviceArgs.push("id");
    serviceParams.push("String id");
  }
  const requestDtoPresent = hasBodyIds || hasBodyId || requestFields.length > 0;
  const requestDtoName = `${contract.entity.name}${methodNameCapital}RequestDTO`;
  if (requestDtoPresent) {
    controllerParams.push(`@RequestBody @Validated ${requestDtoName} request`);
    serviceArgs.push("request");
    serviceParams.push(`${requestDtoName} request`);
  }
  const controllerParamsJoined = controllerParams.join(",\n            ");
  const serviceArgsJoined = serviceArgs.join(", ");
  const serviceParamsJoined = serviceParams.join(", ");
  const returnType = isBatch ? "java.util.Map<String, Object>" : "Void";
  const serviceReturnExpr = isBatch ? " result" : "";
  const implementationReady = patchLines.length > 0 && (isBatch || hasId || hasBodyId);
  return {
    name: op.name,
    methodName,
    methodNameCapital,
    summary: op.summary,
    method: op.method,
    httpAnnotation,
    path: op.path,
    permission: op.permission,
    kind: op.kind,
    isBatch,
    idFrom: op.idFrom,
    hasId,
    hasBodyId,
    hasBodyIds,
    requestFields,
    requestFieldsPresent: requestFields.length > 0,
    requestDtoPresent,
    requestDtoName,
    requestDtoImports: importsFor(op.requestFields || []),
    requestUsesNotBlank: hasBodyId || requestFields.some((field) => field.required && field.fieldType === "String"),
    requestUsesNotNull: requestFields.some((field) => field.required && field.fieldType !== "String"),
    requestUsesNotEmpty: hasBodyIds,
    requestUsesSize: hasBodyIds || requestFields.some((field) => field.maxLength),
    controllerParams,
    controllerParamsJoined,
    controllerDeclaration: formatJavaDeclaration(
      `public ApiResult<${returnType}> ${methodName}`,
      controllerParams,
      " {",
    ),
    serviceArgs,
    serviceArgsJoined,
    serviceParams,
    serviceParamsJoined,
    returnType,
    idExpression: hasBodyId ? "request.getId()" : "id",
    idsExpression: "request.getIds()",
    implementationReady,
    skeletonReason: implementationReady
      ? ""
      : `${op.name} 缺少可确定生成的实体 patch/主键来源，必须补充业务实现`,
    preconditions,
    preconditionsPresent: preconditions.length > 0,
    patchLines,
    patchPresent: patchLines.length > 0,
    externalId: op.externalId,
  };
}

function relationContext(rel, contract) {
  return {
    name: rel.name,
    Name: upperFirst(rel.name),
    detailEntity: rel.detailEntity,
    detailEntityLower: rel.detailEntity.charAt(0).toLowerCase() + rel.detailEntity.slice(1),
    detailContractId: rel.detailContractId,
    joinColumn: rel.joinColumn,
    joinColumnJava: rel.joinColumn.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
    cascadeSoftDelete: rel.cascadeSoftDelete,
    exposeQuery: rel.exposeQuery,
    queryMethodName: `query${rel.detailEntity}By${upperFirst(rel.name === "items" || rel.name === "details" ? rel.detailEntity + "s" : upperFirst(rel.name))}`,
  };
}

function buildContext(contract, profile) {
  const governance = resolveGovernance(profile);
  const softDelete = governance.softDelete;
  const entityFields = contract.fields.map((field) => fieldView(field));
  const createFields = contract.fields.filter((field) => field.writable).map((field) => fieldView(field, "create"));
  const updateFields = contract.fields.filter((field) => field.writable).map((field) => fieldView(field, "update"));
  const queryFields = contract.fields.filter((field) => field.queryMode !== "none").map((field) => fieldView(field));
  const detailFields = contract.fields.filter((field) => field.detail).map((field) => fieldView(field));
  const pageFields = contract.fields.filter((field) => field.list).map((field) => fieldView(field));
  const listFieldPresent = contract.fields.some((field) => field.javaType.startsWith("List<"));
  const entityImports = importsFor(contract.fields);
  if (listFieldPresent) {
    entityImports.push("com.baomidou.mybatisplus.annotation.TableField", "com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler");
    entityImports.sort();
  }
  const validationImports = (fields, mode) => {
    const result = importsFor(fields);
    if (fields.some((field) => mode === "create" && field.requiredOnCreate && field.javaType === "String")) result.push("javax.validation.constraints.NotBlank");
    if (fields.some((field) => mode === "create" && field.requiredOnCreate && field.javaType !== "String")) result.push("javax.validation.constraints.NotNull");
    if (fields.some((field) => field.maxLength !== undefined)) result.push("javax.validation.constraints.Size");
    return [...new Set(result)].sort();
  };
  const customOps = (contract.customOperations || []).map((op) => customOperationContext(op, contract));
  const relations = (contract.relations || []).map((rel) => relationContext(rel, contract));
  const hasExport = Boolean(contract.api.permissions && contract.api.permissions.export);
  const parameterId = '@Parameter(description = "主键ID") @PathVariable("id") String id';
  return {
    contractId: contract.contractId,
    externalId: contract.externalId,
    environment: contract.environment,
    dbCluster: contract.dbCluster,
    rootPackage: contract.rootPackage,
    module: contract.module,
    Entity: contract.entity.name,
    entity: contract.entity.name.charAt(0).toLowerCase() + contract.entity.name.slice(1),
    table: contract.entity.table,
    tableNameAnnotation: listFieldPresent
      ? `@TableName(value = "${contract.entity.table}", autoResultMap = true)`
      : `@TableName("${contract.entity.table}")`,
    apiDesc: contract.entity.description,
    requestPath: contract.api.requestPath,
    permissionPrefix: contract.api.permissionPrefix,
    pagePermission: contract.api.permissions.page,
    detailPermission: contract.api.permissions.detail,
    createPermission: contract.api.permissions.create,
    updatePermission: contract.api.permissions.update,
    removePermission: contract.api.permissions.remove,
    exportPermission: contract.api.permissions.export,
    database: contract.database,
    successCode: profile.response.successCode,
    softDeleteColumn: softDelete.column,
    softDeleteJavaField: softDelete.javaField,
    softDeleteActiveValue: softDelete.activeValue,
    softDeleteDeletedValue: softDelete.deletedValue,
    softDeleteComment: softDeleteComment(softDelete.activeValue, softDelete.deletedValue),
    entityFields,
    createFields,
    updateFields,
    queryFields,
    detailFields,
    pageFields,
    columns: entityFields,
    queryConditions: queryFields.filter((field) => field.queryMode === "eq"),
    likeConditions: queryFields.filter((field) => field.queryMode === "like"),
    entityImports,
    createImports: validationImports(contract.fields.filter((field) => field.writable), "create"),
    updateImports: validationImports(contract.fields.filter((field) => field.writable), "update")
      .filter((name) => !["javax.validation.constraints.NotBlank", "javax.validation.constraints.NotNull"].includes(name)),
    pageDtoImports: importsFor(contract.fields.filter((field) => field.queryMode !== "none")),
    voImports: importsFor(contract.fields.filter((field) => field.detail)),
    pageVoImports: importsFor(contract.fields.filter((field) => field.list)),
    testCreateAssignments: createFields.filter((field) => field.requiredOnCreate).map((field) => ({ ...field, testValue: testValue(field.javaType) })),
    initialValueAssignments: contract.fields
      .filter((field) => Object.prototype.hasOwnProperty.call(field, "initialValue"))
      .map((field) => ({ Field: upperFirst(field.name), value: literalValue(field.javaType, field.initialValue) })),
    rollbackStrategy: contract.migration.rollbackStrategy,
    verificationSql: contract.migration.verificationSql,
    indexes: contract.indexes || [],
    customOperations: customOps,
    customOperationsPresent: customOps.length > 0,
    batchOperationsPresent: customOps.some((operation) => operation.isBatch),
    customRequestDtos: customOps.filter((operation) => operation.requestDtoPresent),
    getByIdControllerDeclaration: formatJavaDeclaration(
      `public ApiResult<${contract.entity.name}VO> getById`,
      [parameterId],
      " {",
    ),
    deleteByIdControllerDeclaration: formatJavaDeclaration(
      "public ApiResult<Void> deleteById",
      [parameterId],
      " {",
    ),
    exportControllerDeclaration: formatJavaDeclaration(
      "public void export",
      [
        `@Parameter(hidden = true) ${contract.entity.name}PageDTO params`,
        "HttpServletResponse response",
      ],
      " {",
    ),
    queryByIdMapperDeclaration: formatJavaDeclaration(
      `${contract.entity.name}VO queryById`,
      ['@Param("id") String id', "@Param(COMPANY_ID_KEY) String companyId"],
      ";",
    ),
    selectActiveByIdMapperDeclaration: formatJavaDeclaration(
      `${contract.entity.name} selectActiveById`,
      ['@Param("id") String id', "@Param(COMPANY_ID_KEY) String companyId"],
      ";",
    ),
    selectActiveByIdsMapperDeclaration: formatJavaDeclaration(
      `List<${contract.entity.name}> selectActiveByIds`,
      ['@Param("ids") Collection<String> ids', "@Param(COMPANY_ID_KEY) String companyId"],
      ";",
    ),
    updateAtomicMapperDeclaration: formatJavaDeclaration(
      "int updateAtomic",
      [
        `@Param("entity") ${contract.entity.name} entity`,
        "@Param(COMPANY_ID_KEY) String companyId",
        '@Param("expectedRevision") Integer expectedRevision',
      ],
      ";",
    ),
    softDeleteAtomicMapperDeclaration: formatJavaDeclaration(
      "int softDeleteAtomic",
      [`@Param("entity") ${contract.entity.name} entity`, "@Param(COMPANY_ID_KEY) String companyId"],
      ";",
    ),
    relations,
    relationsPresent: relations.length > 0,
    relationVoImports: [...new Set(relations.map((rel) => `${contract.rootPackage}.api.vo.${contract.module}.${rel.detailEntity}VO`))].sort(),
    usesPatchMapping: customOps.some((op) => op.method === "PATCH"),
    hasExport,
    exportPresent: hasExport,
    alter: contract.alter || null,
    isAlter: Boolean(contract.alter),
  };
}

module.exports = {
  CUSTOM_FIELD_JAVA_TYPES,
  DEFAULT_OUTPUT,
  JAVA_TYPES,
  PACKAGE_FILES,
  RESERVED_FIELDS,
  STABLE_ID_PATTERN,
  STANDARD_OPERATIONS,
  buildContext,
  customFieldView,
  customOperationContext,
  loadContract,
  relationContext,
  resolveProfile,
  validateAlter,
  validateContract,
  validateCustomOperations,
  validateIndexes,
  validateRelations,
};
