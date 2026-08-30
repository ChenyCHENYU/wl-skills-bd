"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { renderMigration } = require("../lib/codegen");
const { buildContext, loadContract, validateContract } = require("../lib/contract");
const { databaseIdType, resolveProfilePolicies } = require("../lib/profile-policy");

const ROOT = path.resolve(__dirname, "..");
const CONTRACT_FILE = path.join(ROOT, "files", ".github", "templates", "examples", "feature-category.contract.json");
const CONTRACT_SCHEMA_FILE = path.join(ROOT, "files", ".wl-skills-bd", "schemas", "contract.schema.json");
const PROFILE_SCHEMA_FILE = path.join(ROOT, "files", ".wl-skills-bd", "schemas", "profile-local.schema.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function messages(result) {
  return (result.errors || []).map((item) => `${item.path}: ${item.message}`).join("\n");
}

const schema = readJson(CONTRACT_SCHEMA_FILE);
readJson(PROFILE_SCHEMA_FILE);
assert.strictEqual(schema.properties.indexes.items.properties.name.maxLength, 64);
assert.ok(schema.properties.databaseTarget);
assert.ok(schema.properties.errors);
assert.ok(schema.allOf.some((rule) => (rule.then.required || []).includes("databaseTarget")));

const loaded = loadContract(CONTRACT_FILE, { projectRoot: ROOT });
assert.strictEqual(loaded.ok, true, messages(loaded));
const { idPolicy, auditColumns } = resolveProfilePolicies(loaded.profile);
assert.strictEqual(databaseIdType("oracle", loaded.profile), `VARCHAR2(${idPolicy.maxLength} CHAR)`);
assert.strictEqual(databaseIdType("mysql", loaded.profile), `VARCHAR(${idPolicy.maxLength})`);
assert.strictEqual(auditColumns.createUserNullable, false);
assert.strictEqual(auditColumns.createTimeNullable, false);

const context = buildContext(loaded.contract, loaded.profile);
assert.strictEqual(context.idMaxLength, idPolicy.maxLength);
const ddl = renderMigration(loaded.contract, loaded.profile);
assert.match(ddl, new RegExp(`ID VARCHAR2\\(${idPolicy.maxLength} CHAR\\) NOT NULL`));
assert.match(ddl, new RegExp(`CREATE_USER_NO VARCHAR2\\(${auditColumns.actorMaxLength} CHAR\\) NOT NULL`));
assert.match(ddl, /CREATE_DATE_TIME [A-Z0-9() ]+ NOT NULL/);

const raw = readJson(CONTRACT_FILE);
const overflow = structuredClone(raw);
overflow.fields[0].constraints = { maxLength: overflow.fields[0].maxLength + 1 };
overflow.fields[0].constraintSource = "test:overflow-boundary";
const overflowResult = validateContract(overflow, { projectRoot: ROOT });
assert.ok(overflowResult.errors.some((item) => item.path === "$.fields[0].constraints.maxLength" && /容量/.test(item.message)));

const longOracleIndex = structuredClone(raw);
longOracleIndex.indexes = [{ name: `IDX_${"X".repeat(27)}`, columns: [raw.fields[0].column] }];
const longIndexResult = validateContract(longOracleIndex, { projectRoot: ROOT });
assert.ok(longIndexResult.errors.some((item) => item.path === "$.indexes[0].name" && /30/.test(item.message)));

const invalidError = structuredClone(raw);
invalidError.errors = [{
  code: "FEATURE_UNKNOWN",
  httpStatus: 404,
  message: "资源不存在",
  owner: "mdm-owner",
  retryable: false,
  operations: ["missingOperation"],
}];
const invalidErrorResult = validateContract(invalidError, { projectRoot: ROOT });
assert.ok(invalidErrorResult.errors.some((item) => item.path === "$.errors[0].operations[0]"));

const incompleteProduction = structuredClone(raw);
incompleteProduction.assurance = { level: "production" };
const productionResult = validateContract(incompleteProduction, { projectRoot: ROOT });
for (const requiredPath of ["$.databaseTarget", "$.errors"]) {
  assert.ok(productionResult.errors.some((item) => item.path === requiredPath), `${requiredPath} 必须由运行时强制`);
}
assert.ok(productionResult.errors.some((item) => item.path === "$.fields[0].semanticId"));

console.log("✓ contract invariants：Schema/Profile/运行时/API/DDL 的 ID、审计列、错误码与生产目标策略一致");
