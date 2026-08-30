"use strict";

const fs = require("fs");
const path = require("path");
const { hashBuffer, normalizeRel, resolveWithin } = require("./manifest");

const ID_PATTERN = /^[A-Z][A-Z0-9_-]{1,63}$/;
const FIELD_PATTERN = /^[a-z][A-Za-z0-9]*$/;
const SKIP_DIRECTORIES = new Set([".git", ".state", "node_modules", "target", "dist", "build"]);

function object(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function issue(code, location, message, severity = "error") {
  return { code, path: location, message, severity };
}

function checkKeys(value, allowed, required, location, issues) {
  if (!object(value)) {
    issues.push(issue("N101", location, "必须是对象"));
    return false;
  }
  for (const key of Object.keys(value)) if (!allowed.includes(key)) issues.push(issue("N102", `${location}.${key}`, "不支持的属性"));
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(value, key)) issues.push(issue("N103", `${location}.${key}`, "缺少必填属性"));
  return true;
}

function checkString(value, location, issues, pattern, maxLength = 200) {
  if (typeof value !== "string" || !value.trim()) {
    issues.push(issue("N104", location, "必须是非空字符串"));
    return false;
  }
  if (value.length > maxLength) issues.push(issue("N105", location, `长度不能超过 ${maxLength}`));
  if (pattern && !pattern.test(value)) issues.push(issue("N106", location, "格式不合法"));
  return true;
}

function stringStorageCapacity(field) {
  const dbType = String(field && field.dbType || "").toUpperCase();
  const match = dbType.match(/^(?:N?VARCHAR2?|CHAR)\((\d+)/u);
  if (match) return Number(match[1]);
  if (field && Number.isInteger(field.maxLength)) return field.maxLength;
  return field && field.constraints && Number.isInteger(field.constraints.maxLength)
    ? field.constraints.maxLength
    : null;
}

function validateLogicalIds(value, fields) {
  const issues = [];
  if (value === undefined) return { ok: true, values: [], issues };
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
    return { ok: false, values: [], issues: [issue("N110", "$.logicalIds", "必须是 1~50 项的数组")] };
  }
  const fieldMap = new Map((fields || []).map((field) => [field.name, field]));
  const ids = new Set();
  const outputs = new Set();
  const normalized = value.map((entry, index) => {
    const location = `$.logicalIds[${index}]`;
    const allowed = ["id", "field", "strategy", "sourceFields", "delimiter", "maxLength", "algorithmVersion", "namespace", "canonicalization"];
    const required = ["id", "field", "strategy", "sourceFields", "maxLength", "algorithmVersion", "canonicalization"];
    if (!checkKeys(entry, allowed, required, location, issues)) return entry;
    checkString(entry.id, `${location}.id`, issues, ID_PATTERN, 64);
    checkString(entry.field, `${location}.field`, issues, FIELD_PATTERN, 100);
    checkString(entry.algorithmVersion, `${location}.algorithmVersion`, issues, /^v[1-9][0-9]*$/u, 20);
    if (ids.has(entry.id)) issues.push(issue("N111", `${location}.id`, "逻辑 ID 定义重复"));
    if (outputs.has(entry.field)) issues.push(issue("N112", `${location}.field`, "同一输出字段只能有一个逻辑 ID 策略"));
    ids.add(entry.id);
    outputs.add(entry.field);
    if (!["business-key", "uuid-v5", "sha256"].includes(entry.strategy)) issues.push(issue("N113", `${location}.strategy`, "只支持 business-key/uuid-v5/sha256"));
    const output = fieldMap.get(entry.field);
    if (!output) issues.push(issue("N114", `${location}.field`, `引用了不存在的输出字段 ${entry.field}`));
    else if (output.javaType !== "String") issues.push(issue("N115", `${location}.field`, "逻辑 ID 输出字段必须是 String"));
    if (!Array.isArray(entry.sourceFields) || entry.sourceFields.length === 0) issues.push(issue("N116", `${location}.sourceFields`, "至少声明一个来源字段"));
    else {
      if (new Set(entry.sourceFields).size !== entry.sourceFields.length) issues.push(issue("N117", `${location}.sourceFields`, "来源字段不能重复"));
      for (const [sourceIndex, source] of entry.sourceFields.entries()) {
        if (!fieldMap.has(source)) issues.push(issue("N118", `${location}.sourceFields[${sourceIndex}]`, `引用了不存在的字段 ${source}`));
      }
    }
    if (!Number.isInteger(entry.maxLength) || entry.maxLength < 1 || entry.maxLength > 256) issues.push(issue("N119", `${location}.maxLength`, "必须是 1~256 的整数"));
    const outputCapacity = stringStorageCapacity(output);
    if (output && Number.isInteger(outputCapacity) && Number.isInteger(entry.maxLength) && entry.maxLength > outputCapacity) {
      issues.push(issue("N120", `${location}.maxLength`, `逻辑 ID 长度 ${entry.maxLength} 超过字段容量 ${outputCapacity}`));
    }
    if (entry.strategy === "business-key" && (typeof entry.delimiter !== "string" || entry.delimiter.length !== 1)) {
      issues.push(issue("N121", `${location}.delimiter`, "business-key 必须声明单字符 delimiter"));
    }
    if (checkKeys(entry.canonicalization, ["trim", "case", "nullToken", "charset"], ["trim", "case", "nullToken", "charset"], `${location}.canonicalization`, issues)) {
      if (entry.canonicalization.trim !== true) issues.push(issue("N124", `${location}.canonicalization.trim`, "必须在生成 ID 前去除首尾空白"));
      if (!["preserve", "upper", "lower"].includes(entry.canonicalization.case)) issues.push(issue("N125", `${location}.canonicalization.case`, "只支持 preserve/upper/lower"));
      checkString(entry.canonicalization.nullToken, `${location}.canonicalization.nullToken`, issues, null, 10);
      if (entry.canonicalization.charset !== "UTF-8") issues.push(issue("N126", `${location}.canonicalization.charset`, "跨系统逻辑 ID 必须固定 UTF-8"));
      if (entry.delimiter && entry.canonicalization.nullToken && entry.canonicalization.nullToken.includes(entry.delimiter)) {
        issues.push(issue("N127", `${location}.canonicalization.nullToken`, "nullToken 不得包含 delimiter"));
      }
    }
    if (entry.strategy === "uuid-v5") {
      checkString(entry.namespace, `${location}.namespace`, issues, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu, 36);
      if (entry.maxLength !== 36) issues.push(issue("N122", `${location}.maxLength`, "uuid-v5 的 maxLength 必须为 36"));
    }
    if (entry.strategy === "sha256" && entry.maxLength !== 64) issues.push(issue("N123", `${location}.maxLength`, "sha256 十六进制输出的 maxLength 必须为 64"));
    return entry;
  });
  return { ok: issues.length === 0, values: normalized, issues };
}

function validateRetry(value, location, issues) {
  const allowed = ["maxAttempts", "backoff", "initialDelayMs", "maxDelayMs"];
  if (!checkKeys(value, allowed, allowed, location, issues)) return value;
  if (!Number.isInteger(value.maxAttempts) || value.maxAttempts < 0 || value.maxAttempts > 3) issues.push(issue("N131", `${location}.maxAttempts`, "必须是 0~3 的整数，避免重试风暴"));
  if (!["fixed", "exponential"].includes(value.backoff)) issues.push(issue("N132", `${location}.backoff`, "只支持 fixed/exponential"));
  for (const key of ["initialDelayMs", "maxDelayMs"]) {
    if (!Number.isInteger(value[key]) || value[key] < 0 || value[key] > 86400000) issues.push(issue("N133", `${location}.${key}`, "必须是 0~86400000 毫秒整数"));
  }
  if (Number.isInteger(value.initialDelayMs) && Number.isInteger(value.maxDelayMs) && value.initialDelayMs > value.maxDelayMs) {
    issues.push(issue("N134", location, "initialDelayMs 不能大于 maxDelayMs"));
  }
  return value;
}

function validateIntegrations(value, context = {}) {
  const issues = [];
  if (value === undefined) return { ok: true, values: [], issues };
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
    return { ok: false, values: [], issues: [issue("N140", "$.integrations", "必须是 1~50 项的数组")] };
  }
  const logicalIds = new Set((context.logicalIds || []).map((item) => item.id));
  const operations = new Set(context.operations || []);
  const errorCodes = new Set((context.errors || []).map((item) => item.code));
  const retryableErrorCodes = new Set((context.errors || []).filter((item) => item.retryable).map((item) => item.code));
  const fields = new Set((context.fields || []).map((item) => item.name));
  const integrationIds = new Set();
  const normalized = value.map((entry, index) => {
    const location = `$.integrations[${index}]`;
    const allowed = [
      "id", "direction", "producer", "consumer", "transport", "payloadVersion", "contractRef",
      "identityId", "orderingKey", "retry", "acknowledgement", "deadLetter", "replay", "operations", "errorCodes",
    ];
    const required = ["id", "direction", "producer", "consumer", "transport", "payloadVersion", "contractRef", "identityId", "retry", "acknowledgement", "deadLetter", "replay", "operations", "errorCodes"];
    if (!checkKeys(entry, allowed, required, location, issues)) return entry;
    checkString(entry.id, `${location}.id`, issues, ID_PATTERN, 64);
    for (const key of ["producer", "consumer", "transport", "payloadVersion", "contractRef"]) checkString(entry[key], `${location}.${key}`, issues, null, 300);
    if (integrationIds.has(entry.id)) issues.push(issue("N141", `${location}.id`, "集成 ID 重复"));
    integrationIds.add(entry.id);
    if (!["inbound", "outbound", "bidirectional"].includes(entry.direction)) issues.push(issue("N142", `${location}.direction`, "只支持 inbound/outbound/bidirectional"));
    if (!logicalIds.has(entry.identityId)) issues.push(issue("N143", `${location}.identityId`, `引用了不存在的逻辑 ID ${entry.identityId}`));
    if (entry.orderingKey !== undefined && (!FIELD_PATTERN.test(entry.orderingKey) || !fields.has(entry.orderingKey))) issues.push(issue("N144", `${location}.orderingKey`, "必须引用已存在字段"));
    validateRetry(entry.retry, `${location}.retry`, issues);
    if (!["none", "sync", "async"].includes(entry.acknowledgement)) issues.push(issue("N145", `${location}.acknowledgement`, "只支持 none/sync/async"));
    for (const key of ["deadLetter", "replay"]) if (typeof entry[key] !== "boolean") issues.push(issue("N146", `${location}.${key}`, "必须是布尔值"));
    if (!Array.isArray(entry.operations) || entry.operations.length === 0) issues.push(issue("N147", `${location}.operations`, "至少关联一个操作"));
    else {
      if (new Set(entry.operations).size !== entry.operations.length) issues.push(issue("N153", `${location}.operations`, "操作不能重复"));
      for (const [operationIndex, operation] of entry.operations.entries()) if (!operations.has(operation)) issues.push(issue("N148", `${location}.operations[${operationIndex}]`, `引用了不存在的操作 ${operation}`));
    }
    if (!Array.isArray(entry.errorCodes) || entry.errorCodes.length === 0) issues.push(issue("N149", `${location}.errorCodes`, "至少关联一个错误码"));
    else {
      if (new Set(entry.errorCodes).size !== entry.errorCodes.length) issues.push(issue("N154", `${location}.errorCodes`, "错误码不能重复"));
      for (const [errorIndex, code] of entry.errorCodes.entries()) if (!errorCodes.has(code)) issues.push(issue("N150", `${location}.errorCodes[${errorIndex}]`, `引用了不存在的错误码 ${code}`));
    }
    if (entry.retry && entry.retry.maxAttempts > 0 && entry.deadLetter !== true) issues.push(issue("N151", `${location}.deadLetter`, "启用重试时必须声明死信闭环"));
    if (entry.retry && entry.retry.maxAttempts > 0 && Array.isArray(entry.errorCodes)
      && !entry.errorCodes.some((code) => retryableErrorCodes.has(code))) {
      issues.push(issue("N155", `${location}.errorCodes`, "启用重试时至少关联一个 retryable=true 的错误码"));
    }
    if (entry.direction !== "inbound" && !entry.orderingKey) issues.push(issue("N152", `${location}.orderingKey`, "出站/双向集成必须声明排序键"));
    return entry;
  });
  return { ok: issues.length === 0, values: normalized, issues };
}

function inspectLegacyProjection(raw) {
  const checks = {
    producer: Boolean(raw.owner),
    consumer: Boolean(raw.consumer),
    transport: Boolean(raw.transport),
    payloadSchema: Array.isArray(raw.omsFields) && raw.omsFields.length > 0,
    payloadVersion: Boolean(raw.payloadVersion || (raw.omsFields || []).some((item) => Array.isArray(item) && item[0] === "payload_version")),
    identity: Boolean(raw.logicalIds || (raw.omsFields || []).some((item) => Array.isArray(item) && ["business_id", "event_id", "operation_id"].includes(item[0]))),
    retry: Boolean(raw.integrations && raw.integrations.some((item) => item.retry)),
    acknowledgement: Boolean(raw.integrations && raw.integrations.some((item) => item.acknowledgement)),
    deadLetter: Boolean(raw.integrations && raw.integrations.some((item) => item.deadLetter !== undefined)),
    replay: Boolean(raw.integrations && raw.integrations.some((item) => item.replay !== undefined)),
  };
  const warnings = Object.entries(checks).filter(([, present]) => !present)
    .map(([key]) => issue("N201", `$.integration.${key}`, `集成治理项尚未机器化：${key}`, "warn"));
  return { ok: true, readiness: warnings.length === 0 ? "complete" : "partial", checks, warnings };
}

function listJavaFiles(projectRoot, roots) {
  const result = [];
  const visit = (absolute) => {
    if (!fs.existsSync(absolute)) return;
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) return;
    if (stat.isFile()) {
      if (absolute.endsWith(".java")) result.push(normalizeRel(path.relative(projectRoot, absolute)));
      return;
    }
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
      visit(path.join(absolute, entry.name));
    }
  };
  for (const root of roots) visit(resolveWithin(projectRoot, root));
  return result.sort();
}

function auditIntegrationUtilities(projectRootInput, options = {}) {
  const projectRoot = path.resolve(projectRootInput || process.cwd());
  const { loadCatalogConfig } = require("./project-catalog");
  const loaded = loadCatalogConfig(projectRoot, options.configRel);
  if (!loaded.ok) return { ok: false, errors: loaded.errors };
  if (!options.module || !loaded.config.modules[options.module]) return { ok: false, errors: [issue("N301", "$.module", "必须指定已配置模块")] };
  const files = listJavaFiles(projectRoot, loaded.config.modules[options.module].sourceRoots);
  const utilities = [];
  const patterns = [
    { kind: "stable-business-id", pattern: /class\s+([A-Za-z0-9]*StableBusinessId[A-Za-z0-9]*)\b/u },
    { kind: "payload-hash", pattern: /class\s+([A-Za-z0-9]*PayloadHash[A-Za-z0-9]*)\b/u },
  ];
  for (const rel of files) {
    const content = fs.readFileSync(resolveWithin(projectRoot, rel), "utf8");
    for (const candidate of patterns) {
      const match = content.match(candidate.pattern);
      if (match) utilities.push({ kind: candidate.kind, className: match[1], file: rel, contentHash: hashBuffer(Buffer.from(content, "utf8")) });
    }
  }
  const findings = [];
  for (const kind of [...new Set(utilities.map((item) => item.kind))]) {
    const matches = utilities.filter((item) => item.kind === kind);
    if (matches.length < 2) continue;
    const hashes = new Set(matches.map((item) => item.contentHash));
    findings.push(issue(hashes.size === 1 ? "N302" : "N303", `$.utilities.${kind}`, hashes.size === 1
      ? `存在 ${matches.length} 份重复实现，应收敛为一个受管工具`
      : `存在 ${matches.length} 份语义相同但实现漂移的工具，必须统一算法与版本`, hashes.size === 1 ? "warn" : "error"));
  }
  return {
    ok: findings.every((item) => item.severity !== "error"),
    module: options.module,
    scannedFiles: files.length,
    utilities,
    findings,
    summary: { utilities: utilities.length, duplicates: findings.length, errors: findings.filter((item) => item.severity === "error").length, warnings: findings.filter((item) => item.severity === "warn").length },
  };
}

module.exports = {
  auditIntegrationUtilities,
  inspectLegacyProjection,
  validateIntegrations,
  validateLogicalIds,
  stringStorageCapacity,
};
