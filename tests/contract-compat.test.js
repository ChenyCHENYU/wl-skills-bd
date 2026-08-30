"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const compat = require("../lib/contract-compat");

const ROOT = path.resolve(__dirname, "..");
const strictRaw = JSON.parse(fs.readFileSync(path.join(ROOT, "files", ".github", "templates", "examples", "feature-category.contract.json"), "utf8"));
strictRaw.contractKind = "crud";
const strict = compat.inspectContract(strictRaw, { projectRoot: ROOT });
assert.strictEqual(strict.ok, true, JSON.stringify(strict.errors));
assert.strictEqual(strict.contractKind, "crud");
assert.strictEqual(strict.codegenSafe, true);

const mirror = {
  schemaVersion: 1,
  contractId: "pl-heat",
  module: "pl",
  profile: "jh4j3-openapi3",
  rootPackage: "com.example.produce.pl",
  dbCluster: "cx",
  database: "mysql",
  ownership: "pl-owned",
  generation: { source: "schema.tsv", phase: "verified" },
  entity: { name: "PlHeat", table: "pl_heat", description: "炉次" },
  api: { implemented: false, exposure: "database-contract-only", permissions: {} },
  migration: { version: "20260830_120000", sourceVersions: ["20260829_120000"] },
  fields: [
    { name: "heatNo", column: "heat_no", javaType: "String", dbType: "VARCHAR(50)", comment: "炉号", writable: true, maxLength: 50 },
    { name: "retryCount", column: "retry_count", javaType: "Integer", dbType: "INT(11)", comment: "重试次数", writable: true },
  ],
  indexes: [{ name: "IDX_PL_HEAT_TENANT", columns: ["company_id", "heat_no"] }],
};
const inspectedMirror = compat.inspectContract(mirror, { projectRoot: ROOT });
assert.strictEqual(inspectedMirror.ok, true, JSON.stringify(inspectedMirror.errors));
assert.strictEqual(inspectedMirror.contractKind, "schema-mirror");
assert.strictEqual(inspectedMirror.codegenSafe, false);
assert.strictEqual(inspectedMirror.descriptor.fields[1].dbType, "INT");
assert.strictEqual(inspectedMirror.descriptor.apiMode, "none");
assert.ok(inspectedMirror.warnings.some((item) => item.code === "K221"));

const projection = {
  schemaVersion: 2,
  contractId: "pl-l2-heat-plan-out",
  owner: "炼钢MES",
  consumer: "L2",
  transport: "DBA OMS 单向同步",
  entity: { name: "PlL2HeatPlanOut", table: "pl_l2_heat_plan_out", description: "L2 炉次计划" },
  migrations: ["V20260830_120000__create_l2.sql"],
  omsFields: [
    ["message_id", "VARCHAR(20)", false, "消息编号"],
    ["plan_revision", "INT", false, "计划版本"],
  ],
  mesInternalFields: ["company_id", "payload_version"],
  indexes: [{ name: "uk_l2_event", unique: true, columns: ["company_id", "message_id"] }],
  omsRule: "只同步 omsFields",
};
const inspectedProjection = compat.inspectContract(projection, { projectRoot: ROOT });
assert.strictEqual(inspectedProjection.ok, true, JSON.stringify(inspectedProjection.errors));
assert.strictEqual(inspectedProjection.contractKind, "integration-projection");
assert.strictEqual(inspectedProjection.descriptor.module, "pl");
assert.strictEqual(inspectedProjection.descriptor.fields[0].name, "messageId");
assert.strictEqual(inspectedProjection.descriptor.apiMode, "source-observed");
assert.deepStrictEqual(inspectedProjection.descriptor.migrations, ["V20260830_120000__create_l2.sql"]);

const collision = structuredClone(projection);
collision.mesInternalFields.push("message_id");
assert.ok(compat.inspectContract(collision, { projectRoot: ROOT }).errors.some((item) => item.code === "K137"));

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-contract-compat-"));
try {
  const rel = "contracts/pl-heat.json";
  fs.mkdirSync(path.join(tempRoot, "contracts"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, rel), `${JSON.stringify(mirror, null, 2)}\n`, "utf8");
  const inspectedCli = spawnSync(process.execPath, [path.join(ROOT, "bin", "wl-skills-bd.js"), "contract", "inspect", rel, "--target", tempRoot, "--json"], { encoding: "utf8" });
  assert.strictEqual(inspectedCli.status, 0, inspectedCli.stderr);
  assert.strictEqual(JSON.parse(inspectedCli.stdout).contractKind, "schema-mirror");
  const plan = compat.buildMigrationPlan(tempRoot, rel);
  assert.strictEqual(plan.ok, true, JSON.stringify(plan.errors));
  assert.deepStrictEqual(plan.actions.map((item) => item.path), ["$.contractKind", "$.fields[1].dbType"]);
  assert.deepStrictEqual(plan.unresolved, []);
  assert.strictEqual(compat.applyMigrationPlan(plan, { confirm: false }).reason, "confirm-required");
  const applied = compat.applyMigrationPlan(plan, { confirm: true, planHash: plan.planHash });
  assert.strictEqual(applied.ok, true, JSON.stringify(applied));
  const migrated = JSON.parse(fs.readFileSync(path.join(tempRoot, rel), "utf8"));
  assert.strictEqual(migrated.contractKind, "schema-mirror");
  assert.strictEqual(migrated.fields[1].dbType, "INT");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("✅ contract compat：严格 CRUD、数据库镜像、集成投影与 planHash 迁移闭环通过");
