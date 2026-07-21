"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { renderMigration, renderMysqlMigration, renderOracleMigration } = require("../lib/codegen");
const { runBeRules } = require("../lib/be-rules");

const baseContract = {
  contractId: "pl/test/v1",
  database: "mysql",
  entity: { table: "pl_test", name: "PlTest", description: "测试实体" },
  fields: [
    { column: "NAME", dbType: "VARCHAR(64)", javaType: "String", comment: "名称" },
  ],
  indexes: [],
};

function softDeleteValueOf(sql, activeValue, deletedValue) {
  // 从 DDL 提取 IS_DELETE 列定义，确认 DEFAULT 值和注释
  return {
    defaultIs: sql.includes(`IS_DELETE TINYINT(1) NOT NULL DEFAULT ${activeValue}`),
    commentHas: sql.includes(`有效标记：${activeValue}=有效，${deletedValue}=已删除`),
    indexUsesIsDelete: sql.includes("(COMPANY_ID, IS_DELETE)"),
  };
}

let pass = 0;
function ok(label) { pass++; console.log("  ✅ " + label); }
function fail(label, msg) { throw new Error("❌ " + label + ": " + msg); }

// ===== 1. 默认值兜底（无 profile）—— 向后兼容 =====
console.log("=== 1. 默认值兜底（无 profile，等价历史行为）===");
{
  const mysql = renderMysqlMigration(baseContract);
  assert.ok(mysql.includes("IS_DELETE TINYINT(1) NOT NULL DEFAULT 1"), "默认应为 1有效");
  assert.ok(mysql.includes("有效标记：1=有效，0=已删除"), "默认注释应为 1/0");
  assert.ok(mysql.includes("CREATE_DATE_TIME VARCHAR(19)"), "默认时间应为 VARCHAR(19)");
  ok("MySQL 默认 1有效/0删除 + VARCHAR(19) 兜底");

  const oracle = renderOracleMigration(baseContract);
  assert.ok(oracle.includes("IS_DELETE NUMBER(1) DEFAULT 1"), "Oracle 默认应为 1有效");
  assert.ok(oracle.includes("CREATE_DATE_TIME VARCHAR2(19 CHAR)"), "Oracle 默认 VARCHAR2(19 CHAR)");
  ok("Oracle 默认兜底");

  const viaDispatch = renderMigration(baseContract);
  assert.strictEqual(viaDispatch, mysql, "renderMigration 透传无 profile 等价 mysql");
  ok("renderMigration 无 profile 等价渲染");
}

// ===== 2. 华新策略 0有效/4删除（codegen 侧）=====
console.log("\n=== 2. 华新策略 0有效/4删除（codegen）===");
{
  const walsinProfile = { softDelete: { activeValue: 0, deletedValue: 4 } };
  const mysql = renderMysqlMigration(baseContract, walsinProfile);
  assert.ok(mysql.includes("IS_DELETE TINYINT(1) NOT NULL DEFAULT 0"), "华新默认应为 0有效");
  assert.ok(mysql.includes("有效标记：0=有效，4=已删除"), "华新注释应为 0/4");
  assert.ok(mysql.includes("(COMPANY_ID, IS_DELETE)"), "索引仍用 IS_DELETE");
  ok("MySQL 0有效/4删除 + 正确注释 + 索引");

  const oracle = renderOracleMigration(baseContract, walsinProfile);
  assert.ok(oracle.includes("IS_DELETE NUMBER(1) DEFAULT 0"), "Oracle 华新默认 0");
  ok("Oracle 华新 0/4 策略");
}

// ===== 3. 时间类型自定义（DATETIME(3)）=====
console.log("\n=== 3. 治理时间类型自定义（DATETIME(3)）===");
{
  const profile = { auditTime: { mysqlType: "DATETIME(3)", oracleType: "TIMESTAMP(3)" } };
  const mysql = renderMysqlMigration(baseContract, profile);
  assert.ok(mysql.includes("CREATE_DATE_TIME DATETIME(3)"), "应生成 DATETIME(3)");
  assert.ok(!mysql.includes("VARCHAR(19)"), "不应再出现 VARCHAR(19)");
  ok("MySQL DATETIME(3) 覆盖");

  const oracle = renderOracleMigration(baseContract, profile);
  assert.ok(oracle.includes("CREATE_DATE_TIME TIMESTAMP(3)"), "Oracle TIMESTAMP(3)");
  ok("Oracle TIMESTAMP(3) 覆盖");
}

// ===== 4. B17 提示语随 softDelete 变化（be-rules 侧）=====
console.log("\n=== 4. B17 提示语随 softDelete 动态变化（be-rules）===");
function runWithSoftDelete(softDelete) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-skills-bd-softdel-"));
  const rulesFile = path.join(root, ".wl-skills-bd", "rules.local.json");
  fs.mkdirSync(path.dirname(rulesFile), { recursive: true });
  const cfg = { schemaVersion: 1 };
  if (softDelete) cfg.softDelete = softDelete;
  fs.writeFileSync(rulesFile, JSON.stringify(cfg));
  const java = path.join(root, "Svc.java");
  fs.writeFileSync(java, "public class Svc { void d(){ mapper.deleteById(\"1\"); } }");
  const issues = runBeRules(root, {});
  fs.rmSync(root, { recursive: true, force: true });
  return (issues.issues || issues).filter((i) => i.rule === "B17").map((i) => i.message);
}
{
  const defMsgs = runWithSoftDelete(null);
  assert.ok(defMsgs.some((m) => m.includes("IS_DELETE=0")), "无配置时提示应含 IS_DELETE=0（默认删除值0）");
  ok("无配置 B17 提示 IS_DELETE=0（默认兜底）");

  const walsinMsgs = runWithSoftDelete({ activeValue: 0, deletedValue: 4 });
  assert.ok(walsinMsgs.some((m) => m.includes("IS_DELETE=4")), "华新策略提示应含 IS_DELETE=4（删除值4）");
  assert.ok(!walsinMsgs.some((m) => m.includes("IS_DELETE=0")), "华新策略不应再误报 IS_DELETE=0 为删除");
  ok("华新 0/4 策略 B17 提示正确变为 IS_DELETE=4（不再误报 0 为删除）");
}

// ===== 5. rules.local.json softDelete 校验 =====
console.log("\n=== 5. rules.local.json softDelete 配置校验===");
function runWithBadConfig(cfg) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-skills-bd-badcfg-"));
  const rulesFile = path.join(root, ".wl-skills-bd", "rules.local.json");
  fs.mkdirSync(path.dirname(rulesFile), { recursive: true });
  fs.writeFileSync(rulesFile, JSON.stringify(cfg));
  const issues = runBeRules(root, {});
  fs.rmSync(root, { recursive: true, force: true });
  return (issues.issues || issues).filter((i) => i.rule === "WLS_CONFIG").map((i) => i.message);
}
{
  const same = runWithBadConfig({ schemaVersion: 1, softDelete: { activeValue: 1, deletedValue: 1 } });
  assert.ok(same.some((m) => /不能等于/.test(m)), "active=deleted 应报错");
  ok("activeValue=deletedValue 拒绝");

  const missing = runWithBadConfig({ schemaVersion: 1, softDelete: { activeValue: 1 } });
  assert.ok(missing.some((m) => /必须同时提供/.test(m)), "缺 deletedValue 应报错");
  ok("缺失字段拒绝");

  const nonInt = runWithBadConfig({ schemaVersion: 1, softDelete: { activeValue: "1", deletedValue: 0 } });
  assert.ok(nonInt.some((m) => /必须是整数/.test(m)), "非整数应报错");
  ok("非整数值拒绝");
}

console.log("\n✅ governance-policy 全部通过（默认兜底 + 自定义覆盖 + 向后兼容 + B17 动态提示 + 配置校验）");
