"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { applyPlan, buildPlan } = require("../lib/codegen");
const { validateContract } = require("../lib/contract");

const ROOT = path.resolve(__dirname, "..");
const exampleFile = path.join(
  ROOT,
  "files",
  ".github",
  "templates",
  "examples",
  "sale-order-master.contract.json",
);

const contract = JSON.parse(fs.readFileSync(exampleFile, "utf8"));
contract.generation = {
  source: "scripts/generate-contract.mjs",
  schemaSnapshot: "docs/db-spec/sale_order_master.json",
  phase: "business-closure",
};
contract.businessKeys = [{
  name: "orderNo",
  fields: ["orderNo"],
  operations: ["create", "update"],
  normalization: "trim",
  message: "订单号已存在，请勿重复添加",
  source: "requirement:订单号唯一",
  databaseConstraintRef: "migration:UK_ORDER_NO",
}];
const batch = contract.customOperations.find((item) => item.name === "batchCancel");
batch.batchPolicy = {
  selectionScope: "selected-only",
  minItems: 2,
  sameFields: ["customerName"],
  distinct: [{ field: "status", count: 2 }],
  messages: {
    minItems: "批量作废至少选择两条订单",
    sameFields: "仅允许处理客户相同的订单",
    distinct: "所选订单必须恰好来自两个状态",
  },
  source: "requirement:批量作废选择范围",
};

const validated = validateContract(contract, { projectRoot: ROOT });
assert.strictEqual(validated.ok, true, JSON.stringify(validated.errors));
assert.strictEqual(validated.contract.generation.phase, "business-closure");
assert.strictEqual(validated.contract.businessKeys[0].fields[0], "orderNo");

const genericMessage = structuredClone(contract);
genericMessage.businessKeys[0].message = "业务唯一键已存在";
assert.ok(validateContract(genericMessage, { projectRoot: ROOT }).errors
  .some((item) => /技术术语/.test(item.message)));

const wrongScope = structuredClone(contract);
wrongScope.customOperations[2].batchPolicy.selectionScope = "whole-group";
assert.ok(validateContract(wrongScope, { projectRoot: ROOT }).errors
  .some((item) => /selected-only/.test(item.message)));

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-business-policy-"));
try {
  const contractFile = path.join(tempRoot, "sale-order-master.contract.json");
  fs.writeFileSync(contractFile, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
  const plan = buildPlan(contractFile, { projectRoot: tempRoot });
  assert.strictEqual(plan.ok, true, JSON.stringify(plan.errors));
  const applied = applyPlan(plan, {
    confirm: true,
    planHash: plan.planHash,
    questionsReviewed: true,
  });
  assert.strictEqual(applied.ok, true, JSON.stringify(applied));
  const serviceFile = path.join(
    tempRoot,
    "src/main/java/com/jhict/sale/order/service/SaleOrderMasterService.java",
  );
  const service = fs.readFileSync(serviceFile, "utf8");
  assert.match(service, /entity\.setOrderNo\(entity\.getOrderNo\(\) == null \? null : entity\.getOrderNo\(\)\.trim\(\)\)/);
  assert.match(service, /duplicateCountOrderNo/);
  assert.match(service, /订单号已存在，请勿重复添加/);
  assert.match(service, /\.ne\(SaleOrderMaster::getId, dto\.getId\(\)\)/);
  assert.match(service, /ids\.size\(\) >= 2, "批量作废至少选择两条订单"/);
  assert.match(service, /Objects\.equals\(firstSelected\.getCustomerName\(\), selected\.getCustomerName\(\)\)/);
  assert.match(service, /statusDistinctValues\.size\(\) == 2/);
  assert.match(service, /只对请求 ids 对应的已选记录做业务校验/);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("✅ business generation policy：generation 元数据、业务去重与 selected-only 批量门禁闭环通过");
