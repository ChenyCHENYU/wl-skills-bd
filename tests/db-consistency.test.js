"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const dbSpec = require("../lib/db-spec");
const dbDrift = require("../lib/db-drift");
const ruleRegistry = require("../lib/rule-registry");
const { runBeRules } = require("../lib/be-rules");
const { renderMysqlMigration } = require("../lib/codegen");

const ROOT = path.resolve(__dirname, "..");

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-b31-"));
  writeJson(path.join(root, "docs", "db-spec", "produce.json"), {
    tables: [{
      name: "pl_charge",
      comment: "进程跟踪",
      fields: [
        { name: "id", dbType: "varchar(64)", nullable: false, comment: "主键ID" },
        { name: "heat_id", dbType: "varchar(64)", nullable: false, comment: "炉次ID" },
        { name: "start_time", dbType: "datetime(3)", nullable: true, comment: "开始时间" },
        { name: "company_id", dbType: "varchar(64)", nullable: false, comment: "公司/租户ID" },
        { name: "is_delete", dbType: "tinyint(1)", nullable: false, defaultValue: 1, comment: "有效标记：1=有效，0=已删除" },
        { name: "revision", dbType: "int", nullable: false, defaultValue: 0, comment: "乐观锁版本号" },
        { name: "create_user_no", dbType: "varchar(64)", nullable: true, comment: "创建人工号" },
        { name: "update_user_no", dbType: "varchar(64)", nullable: true, comment: "更新人工号" },
        { name: "create_date_time", dbType: "varchar(19)", nullable: true, comment: "创建时间" },
        { name: "update_date_time", dbType: "varchar(19)", nullable: true, comment: "更新时间" },
      ],
    }],
  });
  return root;
}

function contract(fields = [
  { column: "heat_id", dbType: "varchar(64)", nullable: false, comment: "炉次ID" },
  { column: "start_time", dbType: "datetime(3)", nullable: true, comment: "开始时间" },
]) {
  return {
    database: "mysql",
    entity: { table: "pl_charge", description: "进程跟踪" },
    fields,
  };
}

// 精确匹配：表名、顺序、类型、nullable、注释全部通过。
{
  const root = makeProject();
  const result = dbSpec.checkContractAgainstDbSpec(root, contract(), { strictMissing: true });
  assert.strictEqual(result.ok, true, JSON.stringify(result.issues));
  assert.ok(result.fingerprint, "事实源必须形成 fingerprint 并进入计划身份");
}

// 字段换序、类型和注释漂移必须阻断，不能只检查“字段存在”。
{
  const root = makeProject();
  const result = dbSpec.checkContractAgainstDbSpec(root, contract([
    { column: "start_time", dbType: "varchar(19)", nullable: true, comment: "时间" },
    { column: "heat_id", dbType: "varchar(64)", nullable: false, comment: "炉次ID" },
  ]), { strictMissing: true });
  assert.strictEqual(result.ok, false);
  assert.ok(result.issues.some((issue) => /第 1 个业务字段/.test(issue.message)), "换序必须给出精确证据");
}

// 扩展字段只能末尾追加，且必须登记用途、来源和审批。
{
  const root = makeProject();
  const extended = contract([
    ...contract().fields,
    { column: "route_code", dbType: "varchar(32)", nullable: true, comment: "路由编码" },
  ]);
  assert.strictEqual(dbSpec.checkContractAgainstDbSpec(root, extended, { strictMissing: true }).ok, false);
  writeJson(path.join(root, ".wl-skills-bd", "db-governance.json"), {
    schemaVersion: 1,
    enforcement: "strict",
    extensionTables: [],
    extensionFields: [{
      table: "pl_charge", column: "route_code", purpose: "记录上游路由", reason: "基线无路由字段",
      sourceRef: "REQ-100", approvedBy: "owner", approvalRef: "DB-100",
    }],
    waivers: [],
  });
  assert.strictEqual(dbSpec.checkContractAgainstDbSpec(root, extended, { strictMissing: true }).ok, true);
  const sourceTable = dbSpec.loadDbSpec(root).tables.get("pl_charge");
  const ddl = renderMysqlMigration({ ...extended, contractId: "PL-CHARGE" }, undefined, sourceTable);
  const orderedColumns = [
    "id", "heat_id", "start_time", "company_id", "is_delete", "revision",
    "create_user_no", "update_user_no", "create_date_time", "update_date_time", "route_code",
  ];
  for (let index = 1; index < orderedColumns.length; index += 1) {
    assert.ok(
      ddl.indexOf(`    ${orderedColumns[index - 1]} `) < ddl.indexOf(`    ${orderedColumns[index]} `),
      `${orderedColumns[index]} 必须按文档基线顺序生成，扩展字段只能位于末尾`,
    );
  }
  const inserted = contract([
    { column: "route_code", dbType: "varchar(32)", nullable: true, comment: "路由编码" },
    ...contract().fields,
  ]);
  assert.strictEqual(dbSpec.checkContractAgainstDbSpec(root, inserted, { strictMissing: true }).ok, false, "扩展字段插入基线中间必须阻断");
}

// 文档外新表无登记时阻断；有完整业务依据才能通过。
{
  const root = makeProject();
  const extra = { database: "mysql", entity: { table: "pl_route_event", description: "路由事件" }, fields: [{ column: "event_code", dbType: "varchar(32)", comment: "事件编码" }] };
  assert.strictEqual(dbSpec.checkContractAgainstDbSpec(root, extra, { strictMissing: true }).ok, false);
  writeJson(path.join(root, ".wl-skills-bd", "db-governance.json"), {
    schemaVersion: 1,
    extensionTables: [{
      table: "pl_route_event", purpose: "独立事件流", reason: "与进程表生命周期和基数不同",
      sourceRef: "REQ-200", approvedBy: "owner", approvalRef: "DB-200",
    }],
    extensionFields: [], waivers: [],
  });
  assert.strictEqual(dbSpec.checkContractAgainstDbSpec(root, extra, { strictMissing: true }).ok, true);
}

// 安装后的受管项目缺文档镜像必须 fail-closed；裸目录审计只给迁移提示。
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-empty-"));
  writeJson(path.join(root, ".wl-skills-bd", "config.json"), { databaseGovernance: { enforceDocumentMirror: true } });
  assert.strictEqual(dbSpec.checkContractAgainstDbSpec(root, contract()).ok, false);
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-bare-"));
  const result = runBeRules(bare, {});
  const b31 = (result.rawIssues || result.issues || []).filter((issue) => issue.rule === "B31");
  assert.ok(b31.every((issue) => issue.severity === "warn"));
}

// 环境只影响流程强度，不影响结构门禁。
{
  assert.strictEqual(dbSpec.executionPolicy("sit").approvalMode, "single-approval-continuous");
  assert.deepStrictEqual(dbSpec.executionPolicy("sit").steps, ["precheck", "migrate", "validate", "postcheck", "business-smoke"]);
  assert.strictEqual(dbSpec.executionPolicy("prod").lane, "protected");
}

// 代码不得继续引用已退役或未登记的同域表；Flyway 历史文件不追杀。
{
  const root = makeProject();
  const mapper = path.join(root, "src", "main", "resources", "mapper", "LegacyMapper.xml");
  fs.mkdirSync(path.dirname(mapper), { recursive: true });
  fs.writeFileSync(mapper, "<mapper><select id=\"x\">SELECT id FROM pl_heat_process</select></mapper>", "utf8");
  const result = dbSpec.checkCodeTableReferences(root);
  assert.strictEqual(result.ok, false);
  assert.ok(result.issues[0].message.includes("pl_heat_process"));
}

// 快照可检测顺序/类型/注释；现场账本只有带期限的短期宽限，不是永久事实源。
{
  const root = makeProject();
  writeJson(path.join(root, "snapshot.json"), [{
    table: "pl_charge",
    comment: "进程跟踪",
    columns: [
      { name: "id", ordinal: 1, dbType: "varchar(64)", nullable: false, comment: "主键ID" },
      { name: "start_time", ordinal: 2, dbType: "varchar(19)", nullable: true, comment: "错误注释" },
      { name: "heat_id", ordinal: 3, dbType: "varchar(64)", nullable: false, comment: "炉次ID" },
      { name: "ghost_col", ordinal: 4, dbType: "varchar(10)" },
    ],
  }]);
  const result = dbDrift.detectDrift(root, path.join(root, "snapshot.json"));
  assert.strictEqual(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.kind === "column-order"));
  assert.ok(result.issues.some((issue) => issue.kind === "column-type"));
  assert.ok(result.issues.some((issue) => issue.kind === "unclaimed-column" && issue.column === "ghost_col"));
  dbDrift.appendLedger(root, {
    table: "pl_charge", column: "ghost_col", approvalRef: "CHG-1", sourceRef: "INC-1", executedBy: "dba",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  const after = dbDrift.detectDrift(root, path.join(root, "snapshot.json"));
  assert.ok(after.issues.some((issue) => issue.kind === "approved-drift" && issue.severity === "warn"));
}

{
  const result = ruleRegistry.checkRuleRegistry(ROOT);
  assert.strictEqual(result.ok, true, result.issues.map((issue) => issue.message).join("; "));
  assert.ok(result.summary.rules >= 39);
}

console.log("✅ 数据库事实源：基线复用、全属性顺序、扩展审批、环境分级与快照漂移门禁通过");
