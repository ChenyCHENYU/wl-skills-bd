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

// ─── 2. 有 customOperations：正常路径 + 前置拒绝 + 原子 batch ───
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

  // batchCancel（batch）：批量成功 + 任一失败整体拒绝 = 2
  const batchScenarios = testCodegen.buildTestScenarios(ops[2], loaded.contract);
  assert.strictEqual(batchScenarios.length, 2, "batch 2 场景");
  assert.ok(batchScenarios.some((s) => s.kind === "batch-success"), "含批量成功场景");
  assert.ok(batchScenarios.some((s) => s.kind === "batch-atomic-reject"), "含批量整体拒绝场景");
}

console.log("✅ test-codegen：customOperations 正常路径/前置拒绝/原子 batch 场景矩阵正确");

// ─── 3. 生成完整 ServiceTest：方法论名 + 断言 + 前置拒绝 ───
{
  const result = testCodegen.generateServiceTest(path.join(examplesDir, "sale-order-master.contract.json"), { projectRoot: ROOT });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.scenarioCount, 7, "7 场景（1 smoke + 6 行为契约）");
  assert.match(result.content, /void submitSuccess\(\)/, "含 submit 正常路径");
  assert.match(result.content, /void submitRejectStatusEquals\(\)/, "含 submit 前置拒绝");
  assert.match(result.content, /void approveSuccess\(\)/, "含 approve 正常路径");
  assert.match(result.content, /void batchCancelBatchSuccess\(\)/, "含 batchCancel 批量成功");
  assert.match(result.content, /service\.submit\(/, "方法名正确（非 undefined）");
  assert.match(result.content, /service\.batchCancel\(/, "batch 方法名正确");
  assert.match(result.content, /assertThrows\(ServiceException\.class/, "前置拒绝用 assertThrows");
  assert.match(result.content, /assertEquals\("SUBMITTED", entity\.getStatus\(\)\)/, "正常路径真实断言状态转移结果");
  assert.match(result.content, /service\.approve\("1000000000000000001", request\)/, "path + body 参数必须同时生成");
  assert.match(result.content, /java\.util\.Map<String, Object> result = service\.batchCancel\(request\)/, "批量调用必须使用强类型请求并接收结果");
  assert.doesNotMatch(result.content, /batch_partial|部分失败|TODO/, "生成测试不得含部分成功语义或 TODO");
  assert.doesNotMatch(result.content, /service\.undefined/, "无 undefined 方法名");
}

console.log("✅ test-codegen：生成完整 ServiceTest 方法名/断言/前置拒绝正确");

// ─── 4. 测行为不测镜像：真实 mock Service 边界并断言业务结果 ───
{
  const result = testCodegen.generateServiceTest(path.join(examplesDir, "sale-order-master.contract.json"), { projectRoot: ROOT });
  assert.doesNotMatch(result.content, /verify\(.*\.setStatus\)/, "不直接测 setter 调用（冗余）");
  assert.match(result.content, /when\(mapper\.selectActiveById\(any\(\), any\(\)\)\)\.thenReturn\(entity\)/, "正常路径 mock 显式租户查询边界");
  assert.match(result.content, /when\(mapper\.updateAtomic/, "正常路径 mock 乐观锁原子更新");
  assert.match(result.content, /assertEquals\("SUBMITTED", entity\.getStatus\(\)\)/, "验证状态转移业务结果");
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
