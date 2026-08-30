"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildContractSeed, javaTypeFor } = require("../lib/contract-seed");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-contract-seed-"));
try {
  const specDir = path.join(root, "docs", "db-spec");
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, "mdm.json"), `${JSON.stringify({ tables: [{
    name: "MDM_FEATURE_CATEGORY",
    comment: "特征量分类",
    fields: [
      { name: "ID", dbType: "VARCHAR2(64 CHAR)", nullable: false, comment: "主键" },
      { name: "CATEGORY_CODE", dbType: "VARCHAR2(64 CHAR)", nullable: false, comment: "分类编码" },
      { name: "SORT_ORDER", dbType: "NUMBER(10)", nullable: true, comment: "排序号" },
      { name: "RAW_VALUE", dbType: "XMLTYPE", nullable: true, comment: "原始值" },
      { name: "CREATE_USER_NO", dbType: "VARCHAR2(64 CHAR)", nullable: false, comment: "创建人" },
    ],
  }] }, null, 2)}\n`, "utf8");
  const seed = buildContractSeed(root, { table: "mdm_feature_category", database: "oracle", module: "feature" });
  assert.strictEqual(seed.ok, true, JSON.stringify(seed.errors));
  assert.strictEqual(seed.suggestions.fields.length, 3, "平台治理字段不得重复进入业务字段");
  assert.strictEqual(seed.suggestions.fields[0].name, "categoryCode");
  assert.deepStrictEqual(seed.suggestions.fields[0].constraints, { maxLength: 64 });
  assert.strictEqual(seed.suggestions.fields[0].writable, false, "无法证明的写策略必须采用保守默认值");
  assert.ok(seed.unresolved.some((item) => item.path === "$.fields[2].javaType"));
  assert.strictEqual(buildContractSeed(root, { table: "missing", database: "oracle" }).reason, "table-not-found");
  assert.strictEqual(buildContractSeed(root, { table: "MDM_FEATURE_CATEGORY" }).reason, "database-required");
  assert.strictEqual(javaTypeFor("DECIMAL(18,2)"), "BigDecimal");
  assert.strictEqual(seed.seedHash, buildContractSeed(root, { table: "mdm_feature_category", database: "oracle", module: "feature" }).seedHash);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("✓ contract seed：DB Spec 确定性抽取与不确定项显式化通过");
