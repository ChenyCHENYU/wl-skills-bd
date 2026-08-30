"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { validateContract } = require("../lib/contract");
const governance = require("../lib/integration-contract");

const ROOT = path.resolve(__dirname, "..");
const contract = JSON.parse(fs.readFileSync(path.join(ROOT, "files", ".github", "templates", "examples", "feature-category.contract.json"), "utf8"));
contract.fields.push({
  name: "businessId",
  column: "BUSINESS_ID",
  javaType: "String",
  dbType: "VARCHAR2(64 CHAR)",
  comment: "跨系统业务标识",
  writable: false,
  queryMode: "eq",
  maxLength: 64,
});
contract.logicalIds = [{
  id: "MDM_FEATURE_BUSINESS_ID",
  field: "businessId",
  strategy: "sha256",
  sourceFields: [contract.fields[0].name],
  maxLength: 64,
  algorithmVersion: "v1",
  canonicalization: { trim: true, case: "upper", nullToken: "~", charset: "UTF-8" },
}];
contract.errors = [{
  code: "MDM_DELIVERY_FAILED",
  httpStatus: 503,
  message: "主数据投递失败",
  owner: "mdm-team",
  retryable: true,
  operations: ["create"],
}];
contract.integrations = [{
  id: "MDM_FEATURE_OUTBOUND",
  direction: "outbound",
  producer: "mdm",
  consumer: "erp",
  transport: "transactional-outbox",
  payloadVersion: "v1",
  contractRef: "docs/contracts/mdm-feature-v1.json",
  identityId: "MDM_FEATURE_BUSINESS_ID",
  orderingKey: "businessId",
  retry: { maxAttempts: 3, backoff: "exponential", initialDelayMs: 1000, maxDelayMs: 30000 },
  acknowledgement: "async",
  deadLetter: true,
  replay: true,
  operations: ["create"],
  errorCodes: ["MDM_DELIVERY_FAILED"],
}];
const valid = validateContract(contract, { projectRoot: ROOT });
assert.strictEqual(valid.ok, true, JSON.stringify(valid.errors));
assert.strictEqual(valid.contract.logicalIds[0].algorithmVersion, "v1");
assert.strictEqual(valid.contract.integrations[0].retry.maxAttempts, 3);

const missingDeadLetter = structuredClone(contract);
missingDeadLetter.integrations[0].deadLetter = false;
assert.ok(validateContract(missingDeadLetter, { projectRoot: ROOT }).errors.some((item) => /死信/u.test(item.message)));
const oversizedId = structuredClone(contract);
oversizedId.logicalIds[0].maxLength = 65;
assert.ok(validateContract(oversizedId, { projectRoot: ROOT }).errors.some((item) => /字段容量/u.test(item.message)));
const dbTypeBound = structuredClone(contract);
delete dbTypeBound.fields.find((field) => field.name === "businessId").maxLength;
dbTypeBound.fields.find((field) => field.name === "businessId").dbType = "VARCHAR2(32 CHAR)";
assert.ok(validateContract(dbTypeBound, { projectRoot: ROOT }).errors.some((item) => /字段容量 32/u.test(item.message)));
const missingRetryable = structuredClone(contract);
missingRetryable.errors[0].retryable = false;
assert.ok(validateContract(missingRetryable, { projectRoot: ROOT }).errors.some((item) => /retryable=true/u.test(item.message)));
const retryStorm = structuredClone(contract);
retryStorm.integrations[0].retry.maxAttempts = 4;
assert.ok(validateContract(retryStorm, { projectRoot: ROOT }).errors.some((item) => /重试风暴/u.test(item.message)));

const projection = {
  owner: "炼钢MES",
  consumer: "L2",
  transport: "DBA OMS",
  omsFields: [["business_id", "VARCHAR(64)", false, "业务标识"]],
};
const inspected = governance.inspectLegacyProjection(projection);
assert.strictEqual(inspected.readiness, "partial");
assert.strictEqual(inspected.checks.identity, true);
assert.ok(inspected.warnings.some((item) => /retry/u.test(item.path)));

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-integration-audit-"));
try {
  const config = {
    schemaVersion: 1,
    project: { id: "integration-audit", name: "集成审计" },
    docsRoot: "docs/backend",
    modules: { pl: { displayName: "炼钢", contractRoots: ["contracts"], sourceRoots: ["src"], upstream: [], downstream: [], owners: ["steel-team"] } },
  };
  fs.mkdirSync(path.join(tempRoot, ".wl-skills-bd"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, ".wl-skills-bd", "catalog.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  fs.mkdirSync(path.join(tempRoot, "src", "a"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "src", "b"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "src", "a", "StableBusinessId.java"), "package a; public class StableBusinessId { String make() { return \"a\"; } }\n", "utf8");
  fs.writeFileSync(path.join(tempRoot, "src", "b", "StableBusinessId.java"), "package b; public class StableBusinessId { String make() { return \"b\"; } }\n", "utf8");
  const audit = governance.auditIntegrationUtilities(tempRoot, { module: "pl" });
  assert.strictEqual(audit.ok, false);
  assert.deepStrictEqual(audit.findings.map((item) => item.code), ["N303"]);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("✅ integration contract：逻辑 ID、投递闭环、错误码引用与重复工具审计通过");
