"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildContext, validateContract } = require("../lib/contract");

const ROOT = path.resolve(__dirname, "..");
const example = JSON.parse(fs.readFileSync(
  path.join(ROOT, "files", ".github", "templates", "examples", "feature-category.contract.json"),
  "utf8",
));

const valid = validateContract(example, { projectRoot: ROOT });
assert.strictEqual(valid.ok, true, JSON.stringify(valid.errors));
assert.strictEqual(valid.deliveryProfile.profileId, "jh4j3-openapi3");
assert.strictEqual(valid.deliveryProfile.protocolVersion, "1.0");
assert.ok(valid.deliveryProfileFile.endsWith("wl-delivery-profile.v1.json"));
assert.strictEqual(valid.contract.output.migration, "src/main/resources/db/migration");
assert.strictEqual(valid.contract.output.collaboration, "docs/contracts");
const context = buildContext(valid.contract, valid.profile);
assert.strictEqual(context.createFields.length, 3);
assert.strictEqual(context.queryFields.length, 2);
assert.strictEqual(context.pagePermission, example.api.permissions.page);
assert.ok(context.createImports.includes("javax.validation.constraints.NotBlank"));
assert.strictEqual(context.softDeleteColumn, "IS_DELETE");
assert.strictEqual(context.softDeleteActiveValue, 1);
assert.strictEqual(context.softDeleteDeletedValue, 0);

const stateExample = JSON.parse(fs.readFileSync(
  path.join(ROOT, "files", ".github", "templates", "examples", "sale-order-master.contract.json"),
  "utf8",
));
const stateValid = validateContract(stateExample, { projectRoot: ROOT });
assert.strictEqual(stateValid.ok, true, JSON.stringify(stateValid.errors));
const stateContext = buildContext(stateValid.contract, stateValid.profile);
assert.deepStrictEqual(stateContext.initialValueAssignments, [{ Field: "Status", value: '"DRAFT"' }]);

const stateWithoutInitial = structuredClone(stateExample);
delete stateWithoutInitial.fields.find((field) => field.name === "status").initialValue;
const missingInitial = validateContract(stateWithoutInitial, { projectRoot: ROOT });
assert.strictEqual(missingInitial.ok, false);
assert.ok(missingInitial.errors.some((error) => /状态机字段必须声明初始值/.test(error.message)));

const sensitiveWithoutClassification = structuredClone(example);
sensitiveWithoutClassification.fields[0].name = "accessToken";
sensitiveWithoutClassification.fields[0].column = "ACCESS_TOKEN";
const sensitiveResult = validateContract(sensitiveWithoutClassification, { projectRoot: ROOT });
assert.strictEqual(sensitiveResult.ok, false);
assert.ok(sensitiveResult.errors.some((error) => /敏感数据/.test(error.message)));

const badReserved = structuredClone(example);
badReserved.fields[0].name = "companyId";
badReserved.fields[0].column = "COMPANY_ID";
const reservedResult = validateContract(badReserved, { projectRoot: ROOT });
assert.strictEqual(reservedResult.ok, false);
assert.ok(reservedResult.errors.some((error) => /治理字段/.test(error.message)));

const badPath = structuredClone(example);
badPath.output = { modelJava: "../outside" };
assert.strictEqual(validateContract(badPath, { projectRoot: ROOT }).ok, false);

const missingExternalPath = structuredClone(example);
delete missingExternalPath.api.externalBasePath;
assert.strictEqual(validateContract(missingExternalPath, { projectRoot: ROOT }).ok, false);

const mismatchedExternalPath = structuredClone(example);
mismatchedExternalPath.api.externalBasePath = "/mdm/otherResource";
assert.strictEqual(validateContract(mismatchedExternalPath, { projectRoot: ROOT }).ok, false);

const badSql = structuredClone(example);
badSql.migration.verificationSql = ["DELETE FROM MDM_FEATURE_CATEGORY"];
assert.strictEqual(validateContract(badSql, { projectRoot: ROOT }).ok, false);

const badDbType = structuredClone(example);
badDbType.fields[0].dbType = "VARCHAR2(64 CHAR) DEFAULT 'x'";
assert.strictEqual(validateContract(badDbType, { projectRoot: ROOT }).ok, false);

const incompatibleType = structuredClone(example);
incompatibleType.fields[0].javaType = "Boolean";
assert.strictEqual(validateContract(incompatibleType, { projectRoot: ROOT }).ok, false);

const unsafeDescription = structuredClone(example);
unsafeDescription.entity.description = "坏注释 */ public class Injected";
assert.strictEqual(validateContract(unsafeDescription, { projectRoot: ROOT }).ok, false);

const driftRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-profile-drift-"));
try {
  const contractDir = path.join(driftRoot, ".wl-skills-bd", "contracts");
  fs.mkdirSync(contractDir, { recursive: true });
  const driftedProfile = structuredClone(valid.deliveryProfile);
  driftedProfile.transport.operations.update.method = "POST";
  fs.writeFileSync(path.join(contractDir, "wl-delivery-profile.v1.json"), JSON.stringify(driftedProfile), "utf8");
  const drifted = validateContract(example, { projectRoot: driftRoot });
  assert.strictEqual(drifted.ok, false);
  assert.ok(drifted.errors.some((error) => /统一交付 profile 漂移/.test(error.message)));
} finally {
  fs.rmSync(driftRoot, { recursive: true, force: true });
}

console.log("✅ contract：schema、profile、治理字段、路径和 SQL 白名单通过");
