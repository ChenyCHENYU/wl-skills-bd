"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildContext, validateContract } = require("../lib/contract");
const { buildManifest } = require("../lib/collaboration");

const ROOT = path.resolve(__dirname, "..");
const example = JSON.parse(fs.readFileSync(path.join(
  ROOT, "files", ".github", "templates", "examples", "feature-category.contract.json",
), "utf8"));

const contract = structuredClone(example);
contract.fields[0].constraints = { minLength: 2, maxLength: 32, pattern: "^[A-Z0-9_-]+$" };
contract.fields[0].constraintSource = "business-rule:category-code";
contract.fields[0].queryConstraints = { maxLength: 20 };
contract.fields[0].queryConstraintSource = "ui-filter:category-code";
contract.fields.push(
  {
    name: "weight", column: "WEIGHT", javaType: "BigDecimal", dbType: "NUMBER(12,3)", comment: "重量",
    writable: true, queryMode: "eq", constraints: { minimum: 0 },
    constraintSource: "business-rule:non-negative",
  },
  {
    name: "startTime", column: "START_TIME", javaType: "LocalDateTime", dbType: "TIMESTAMP(3)",
    comment: "开始时间", writable: true, requiredOnCreate: true, queryMode: "eq",
  },
  {
    name: "endTime", column: "END_TIME", javaType: "LocalDateTime", dbType: "TIMESTAMP(3)",
    comment: "结束时间", writable: true, requiredOnCreate: true, queryMode: "eq",
  },
);
contract.validationRules = [{
  kind: "chronology", startField: "startTime", endField: "endTime", allowEqual: true,
  operations: ["create", "update", "page"], message: "结束时间不能早于开始时间",
  source: "requirement:time-range",
}];

const valid = validateContract(contract, { projectRoot: ROOT });
assert.strictEqual(valid.ok, true, JSON.stringify(valid.errors));
const context = buildContext(valid.contract, valid.profile, valid.deliveryProfile);
const categoryCreate = context.createFields.find((field) => field.field === "categoryCode");
const categoryQuery = context.queryFields.find((field) => field.field === "categoryCode");
assert.ok(categoryCreate.validationAnnotations.some((item) => item.startsWith("@Pattern")));
assert.ok(categoryCreate.validationAnnotations.some((item) => item.includes("min = 2") && item.includes("max = 32")));
assert.ok(!categoryCreate.validationAnnotations.some((item) => /Digits|DecimalMin|DecimalMax/.test(item)));
assert.deepStrictEqual(categoryQuery.effectiveConstraints, { maxLength: 20 });
assert.ok(categoryQuery.validationAnnotations.some((item) => item.includes("max = 20")));
assert.ok(!categoryQuery.validationAnnotations.some((item) => item.includes("max = 64")));

const weightCreate = context.createFields.find((field) => field.field === "weight");
const weightQuery = context.queryFields.find((field) => field.field === "weight");
assert.ok(weightCreate.validationAnnotations.some((item) => item.startsWith("@Digits(integer = 9, fraction = 3")));
assert.ok(weightCreate.validationAnnotations.some((item) => item.startsWith("@DecimalMin")));
assert.deepStrictEqual(weightQuery.validationAnnotations, []);
assert.strictEqual(context.createCrossFieldRules.length, 1);
assert.strictEqual(context.updateCrossFieldRules.length, 1);
assert.strictEqual(context.pageCrossFieldRules.length, 1);
const manifest = buildManifest(valid.contract, valid.profile, valid.deliveryProfile);
assert.deepStrictEqual(
  manifest.models.pageRequest.find((field) => field.name === "categoryCode").constraints,
  { maxLength: 20 },
);
assert.deepStrictEqual(
  manifest.models.createRequest.find((field) => field.name === "categoryCode").constraints,
  { maxLength: 32, minLength: 2, pattern: "^[A-Z0-9_-]+$" },
);
assert.deepStrictEqual(manifest.validationRules, contract.validationRules);

const serverContextInRequest = structuredClone(example);
serverContextInRequest.fields[0].contextSource = "server";
assert.strictEqual(validateContract(serverContextInRequest, { projectRoot: ROOT }).ok, false);

console.log("✅ contract boundary：写入/查询约束分离、数值精度、时间顺序和服务端上下文通过");
