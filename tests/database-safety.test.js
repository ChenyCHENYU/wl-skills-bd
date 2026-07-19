"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { applyPlan, buildPlan, renderMigration } = require("../lib/codegen");
const { validateContract } = require("../lib/contract");

const ROOT = path.resolve(__dirname, "..");
const exampleFile = path.join(ROOT, "files", ".github", "templates", "examples", "feature-category.contract.json");
const example = JSON.parse(fs.readFileSync(exampleFile, "utf8"));

function validate(raw) {
  return validateContract(raw, { projectRoot: ROOT });
}

const unknownIndex = structuredClone(example);
unknownIndex.indexes = [{ name: "IDX_UNKNOWN", columns: ["COMPANY_ID", "MISSING_COLUMN"] }];
assert.strictEqual(validate(unknownIndex).ok, false, "索引不得引用不存在列");

const unsafeSoftDeleteUnique = structuredClone(example);
unsafeSoftDeleteUnique.indexes = [{ name: "UK_CATEGORY", columns: ["COMPANY_ID", "IS_DELETE", "CATEGORY_CODE"], unique: true }];
assert.strictEqual(validate(unsafeSoftDeleteUnique).ok, false, "唯一索引不得使用会在重复删除时冲突的 IS_DELETE");

const unsafeVerification = structuredClone(example);
unsafeVerification.migration.verificationSql = ["SELECT * FROM MDM_FEATURE_CATEGORY FOR UPDATE"];
assert.strictEqual(validate(unsafeVerification).ok, false, "验证 SQL 禁止加锁");

const wrongCluster = structuredClone(example);
wrongCluster.dbCluster = "cx";
assert.strictEqual(validate(wrongCluster).ok, false, "根包和团队数据库集群映射必须一致");

const alterFile = path.join(ROOT, "files", ".github", "templates", "examples", "sale-order-master-alter.contract.json");
const alter = JSON.parse(fs.readFileSync(alterFile, "utf8"));
const notNullAdd = structuredClone(alter);
notNullAdd.alter.operations[0].field.requiredOnCreate = true;
assert.strictEqual(validate(notNullAdd).ok, false, "expand 新增列必须先允许 NULL");

const mixedDrop = structuredClone(alter);
mixedDrop.alter.operations.push({ type: "drop", column: "LEGACY_FIELD" });
assert.strictEqual(validate(mixedDrop).ok, false, "expand 禁止混入 drop");

const contractWithoutApproval = structuredClone(alter);
contractWithoutApproval.alter.phase = "contract";
contractWithoutApproval.alter.operations = [{ type: "drop", column: "LEGACY_FIELD" }];
delete contractWithoutApproval.alter.approvalRef;
assert.strictEqual(validate(contractWithoutApproval).ok, false, "contract 删除列必须提供审批单");

const mysql = structuredClone(example);
mysql.database = "mysql";
mysql.entity.table = "MDM_FEATURE_CATEGORY_MY";
mysql.fields[0].dbType = "VARCHAR(64)";
mysql.fields[1].dbType = "VARCHAR(200)";
mysql.fields[2].dbType = "INT";
mysql.indexes = [{ name: "UK_CATEGORY_CODE", columns: ["COMPANY_ID", "CATEGORY_CODE"], unique: true }];
const mysqlLoaded = validate(mysql);
assert.strictEqual(mysqlLoaded.ok, true, JSON.stringify(mysqlLoaded.errors));
assert.match(renderMigration(mysqlLoaded.contract), /UNIQUE KEY UK_CATEGORY_CODE \(COMPANY_ID, CATEGORY_CODE\) USING BTREE/);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-db-safety-"));
try {
  const contractFile = path.join(tempRoot, "contract.json");
  fs.writeFileSync(contractFile, `${JSON.stringify(example, null, 2)}\n`, "utf8");
  const first = buildPlan(contractFile, { projectRoot: tempRoot });
  assert.strictEqual(first.ok, true, JSON.stringify(first.errors));
  assert.strictEqual(applyPlan(first, { confirm: true, planHash: first.planHash }).ok, true);
  assert.ok(first.actions.some((item) => item.rel.endsWith("-ddl-preview.md")), "必须生成 DDL 评审报告");

  const migration = first.actions.find((item) => item.rel.endsWith(".sql"));
  fs.appendFileSync(migration.destination, "-- forbidden rewrite\n", "utf8");
  const immutable = buildPlan(contractFile, { projectRoot: tempRoot });
  const migrationConflict = immutable.actions.find((item) => item.rel === migration.rel);
  assert.strictEqual(migrationConflict.action, "conflict");
  assert.match(migrationConflict.reason, /migration.*不可改写/i);

  fs.writeFileSync(migration.destination, migration.content, "utf8");
  const duplicate = path.join(tempRoot, example.output?.migration || "src/main/resources/db/migration", "V20260718_120000__other.sql");
  fs.writeFileSync(duplicate, "-- duplicate version\n", "utf8");
  const duplicatePlan = buildPlan(contractFile, { projectRoot: tempRoot });
  assert.strictEqual(duplicatePlan.ok, false);
  assert.match(duplicatePlan.errors[0].message, /Flyway 版本/);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("✅ database safety：索引、只读验证、Expand/Contract、MySQL UNIQUE、Flyway 不可变门通过");
