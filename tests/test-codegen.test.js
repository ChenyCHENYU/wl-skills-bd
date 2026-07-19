"use strict";

const assert = require("assert");
const path = require("path");
const testCodegen = require("../lib/test-codegen");
const { loadContract } = require("../lib/contract");

const ROOT = path.resolve(__dirname, "..");
const examplesDir = path.join(ROOT, "files", ".github", "templates", "examples");

function loadExample(file) {
  const loaded = loadContract(path.join(examplesDir, file), { projectRoot: ROOT });
  assert.strictEqual(loaded.ok, true, JSON.stringify(loaded.errors));
  return loaded;
}

// ─── 1. 无 customOperations：只有 smoke ───
{
  const loaded = loadExample("feature-category.contract.json");
  const count = testCodegen.countScenarios(loaded.contract);
  assert.strictEqual(count, 1, "无 customOperations 只有 save smoke");
  const section = testCodegen.buildCustomTestsSection(loaded.contract, loaded.profile);
  assert.match(section, /无 customOperations/);
}

console.log("✅ test-codegen：无 customOperations 时只给 smoke + 引导");

// ─── 2. 有 customOperations：正常路径 + 前置拒绝 + batch ───
{
  const loaded = loadExample("sale-order-master.contract.json");
  const ops = loaded.contract.customOperations;
  assert.strictEqual(ops.length, 3, "3 个操作");

  // submit（stateTransition，1 个 precondition）：正常 + 拒绝 = 2 场景
  const submitScenarios = testCodegen.buildTestScenarios(ops[0], loaded.contract);
  assert.strictEqual(submitScenarios.length, 2, "submit 2 场景");
  assert.ok(submitScenarios.some((s) => s.kind === "success"), "含正常路径");
  assert.ok(submitScenarios.some((s) => s.kind === "precondition-reject"), "含前置拒绝");

  // approve（stateTransition，1 precondition + 1 requestField）：正常 + 拒绝 = 2
  const approveScenarios = testCodegen.buildTestScenarios(ops[1], loaded.contract);
  assert.strictEqual(approveScenarios.length, 2, "approve 2 场景");

  // batchCancel（batch）：批量成功 + 部分失败 = 2
  const batchScenarios = testCodegen.buildTestScenarios(ops[2], loaded.contract);
  assert.strictEqual(batchScenarios.length, 2, "batch 2 场景");
  assert.ok(batchScenarios.every((s) => s.kind.startsWith("batch")), "全是 batch 场景");
}

console.log("✅ test-codegen：customOperations 正常路径/前置拒绝/batch 场景矩阵正确");

// ─── 3. 生成完整 ServiceTest：方法论名 + 断言 + 前置拒绝 ───
{
  const result = testCodegen.generateServiceTest(path.join(examplesDir, "sale-order-master.contract.json"), { projectRoot: ROOT });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.scenarioCount, 7, "7 场景（1 smoke + 6 行为契约）");
  assert.match(result.content, /void submit_success\(\)/, "含 submit 正常路径");
  assert.match(result.content, /void submit_reject_status_equals\(\)/, "含 submit 前置拒绝");
  assert.match(result.content, /void approve_success\(\)/, "含 approve 正常路径");
  assert.match(result.content, /void batchCancel_batch_success\(\)/, "含 batchCancel 批量成功");
  assert.match(result.content, /service\.submit\(/, "方法名正确（非 undefined）");
  assert.match(result.content, /service\.batchCancel\(/, "batch 方法名正确");
  assert.match(result.content, /assertThrows\(ServiceException\.class/, "前置拒绝用 assertThrows");
  assert.match(result.content, /assertEquals\("SUBMITTED".*captor/, "正常路径含状态转移断言引导（ArgumentCaptor）");
  assert.doesNotMatch(result.content, /service\.undefined/, "无 undefined 方法名");
}

console.log("✅ test-codegen：生成完整 ServiceTest 方法名/断言/前置拒绝正确");

// ─── 4. 测行为不测镜像：不测 setter 调用，正常路径用 ArgumentCaptor 引导验证状态 ───
{
  const result = testCodegen.generateServiceTest(path.join(examplesDir, "sale-order-master.contract.json"), { projectRoot: ROOT });
  assert.doesNotMatch(result.content, /verify\(.*\.setStatus\)/, "不直接测 setter 调用（冗余）");
  assert.match(result.content, /ArgumentCaptor/, "正常路径含 ArgumentCaptor 引导（行为断言）");
  assert.match(result.content, /verify\(baseMapper\)\.updateById\(captor\.capture/, "引导用 ArgumentCaptor 捕获持久化状态（行为验证）");
  assert.match(result.content, /assertEquals\("SUBMITTED".*captor/, "引导验证持久化状态值（行为断言）");
}

console.log("✅ test-codegen：测行为契约不测代码镜像（无 verify 冗余）");

// ─── 5. 确定性：同样输入生成同样输出 ───
{
  const r1 = testCodegen.generateServiceTest(path.join(examplesDir, "sale-order-master.contract.json"), { projectRoot: ROOT });
  const r2 = testCodegen.generateServiceTest(path.join(examplesDir, "sale-order-master.contract.json"), { projectRoot: ROOT });
  assert.strictEqual(r1.content, r2.content, "两次生成完全一致");
}

console.log("✅ test-codegen：确定性生成");

console.log("\n🎉 test-codegen 全套测试通过（5 组：场景矩阵/方法名/行为不镜像/确定性）");
