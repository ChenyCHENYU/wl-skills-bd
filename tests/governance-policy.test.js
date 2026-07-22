"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { renderMigration, renderMysqlMigration, renderOracleMigration } = require("../lib/codegen");
const { runBeRules } = require("../lib/be-rules");
const { buildContext, resolveProfile, validateContract } = require("../lib/contract");
const { checkGovernance } = require("../lib/doctor");
const { validateGovernance } = require("../lib/governance");
const { render } = require("../lib/template-engine");

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

// ===== 6. Entity / Service / Mapper 全链路随 profile 渲染 =====
console.log("\n=== 6. Java/XML 模板治理值全链路 ===");
{
  const root = path.resolve(__dirname, "..");
  const contract = JSON.parse(fs.readFileSync(
    path.join(root, "files", ".github", "templates", "examples", "feature-category.contract.json"),
    "utf8",
  ));
  const validated = validateContract(contract, { projectRoot: root });
  assert.strictEqual(validated.ok, true, JSON.stringify(validated.errors));
  const profile = {
    ...validated.profile,
    softDelete: {
      ...validated.profile.softDelete,
      activeValue: 0,
      deletedValue: 4,
      mysqlType: "TINYINT(1)",
      oracleType: "NUMBER(1)",
    },
    auditTime: { mysqlType: "DATETIME(3)", oracleType: "TIMESTAMP(3)" },
  };
  const context = buildContext(validated.contract, profile);
  const templateDir = path.join(root, "files", ".github", "templates");
  const renderedEntity = render(fs.readFileSync(path.join(templateDir, "Entity.java.tmpl"), "utf8"), context);
  const renderedService = render(fs.readFileSync(path.join(templateDir, "Service.java.tmpl"), "utf8"), context);
  const renderedMapper = render(fs.readFileSync(path.join(templateDir, "Mapper.xml.tmpl"), "utf8"), context);
  assert.match(renderedEntity, /@TableLogic\(value = "0", delval = "4"\)/);
  assert.match(renderedService, /setIsDelete\(0\)/);
  assert.match(renderedMapper, /AND t\.IS_DELETE = 0/);
  assert.match(renderedMapper, /SET IS_DELETE = 4/);
  assert.doesNotMatch(renderedMapper.replace(/<!--[\s\S]*?-->/g, ""), /IS_DELETE\s*=\s*1/);
  ok("华新 0/4 从 profile 贯穿 Entity、Service、Mapper XML");
}

// ===== 7. profile 治理值 fail-closed 校验 =====
console.log("\n=== 7. profile 治理值 fail-closed 校验 ===");
{
  assert.strictEqual(validateGovernance({ softDelete: { activeValue: 1, deletedValue: 1 } }).ok, false);
  assert.strictEqual(validateGovernance({ softDelete: { column: "IS_DELETE;DROP" } }).ok, false);
  assert.strictEqual(validateGovernance({ auditTime: { mysqlType: "DATETIME(3) DEFAULT NOW()" } }).ok, false);
  assert.strictEqual(validateGovernance({ softDelete: { javaField: "deleted" } }).ok, false);
  assert.strictEqual(validateGovernance({ softDelete: "0/4" }).ok, false);
  assert.strictEqual(validateGovernance({ softDelete: { activeValue: 0 } }).ok, false);
  assert.strictEqual(validateGovernance({ softDelete: { activeValue: 0, deletedValue: 4, extra: true } }).ok, false);
  ok("相同治理值、危险列名/类型和不兼容 Java 字段均被拒绝");
}

// ===== 8. doctor 对 profile / rules / 运行时三点校验 =====
console.log("\n=== 8. doctor 治理口径三点校验 ===");
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-skills-bd-governance-doctor-"));
  fs.mkdirSync(path.join(root, ".wl-skills-bd"), { recursive: true });
  fs.mkdirSync(path.join(root, "src", "main", "resources"), { recursive: true });
  fs.writeFileSync(path.join(root, ".wl-skills-bd", "rules.local.json"), JSON.stringify({
    schemaVersion: 1,
    softDelete: { activeValue: 0, deletedValue: 4 },
  }));
  fs.writeFileSync(path.join(root, "src", "main", "resources", "application.yml"), [
    "mybatis-plus:",
    "  global-config:",
    "    db-config:",
    "      logic-not-delete-value: 0",
    "      logic-delete-value: 4",
  ].join("\n"));
  const checks = [];
  checkGovernance(root, {
    softDelete: { activeValue: 0, deletedValue: 4 },
    auditTime: { mysqlType: "DATETIME(3)", oracleType: "TIMESTAMP(3)" },
  }, (id, passed, detail) => checks.push({ id, passed, detail }));
  assert.ok(checks.every((check) => check.passed), JSON.stringify(checks));
  fs.writeFileSync(path.join(root, ".wl-skills-bd", "rules.local.json"), JSON.stringify({
    schemaVersion: 1,
    softDelete: { activeValue: 1, deletedValue: 0 },
  }));
  const mismatch = [];
  checkGovernance(root, { softDelete: { activeValue: 0, deletedValue: 4 } },
    (id, passed, detail) => mismatch.push({ id, passed, detail }));
  assert.ok(mismatch.some((check) => check.id === "governance-rules" && !check.passed));
  fs.rmSync(root, { recursive: true, force: true });
  ok("doctor 可验证 profile、rules.local 与 MyBatis-Plus 运行值一致性");
}

// ===== 9. 未受管 profile.local 覆盖层 =====
console.log("\n=== 9. profile.local 项目覆盖层 ===");
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-skills-bd-profile-local-"));
  fs.mkdirSync(path.join(root, ".wl-skills-bd"), { recursive: true });
  const localFile = path.join(root, ".wl-skills-bd", "profile.local.json");
  fs.writeFileSync(localFile, JSON.stringify({
    schemaVersion: 1,
    profileId: "jh4j3-openapi3",
    softDelete: { activeValue: 0, deletedValue: 4 },
    auditTime: { mysqlType: "DATETIME(3)", oracleType: "TIMESTAMP(3)" },
  }));
  const profile = resolveProfile("jh4j3-openapi3", root).profile;
  assert.strictEqual(profile.softDelete.activeValue, 0);
  assert.strictEqual(profile.softDelete.deletedValue, 4);
  assert.strictEqual(profile.auditTime.mysqlType, "DATETIME(3)");
  fs.writeFileSync(localFile, JSON.stringify({
    schemaVersion: 1,
    profileId: "wrong-profile",
    softDelete: { activeValue: 0, deletedValue: 4 },
  }));
  assert.throws(() => resolveProfile("jh4j3-openapi3", root), /profile\.local\.json/);
  fs.rmSync(root, { recursive: true, force: true });
  ok("本地覆盖可合并治理值，profileId 漂移被拒绝");
}

console.log("\n✅ governance-policy 全部通过（DDL + 模板 + profile/rules/runtime + 本地覆盖）");
