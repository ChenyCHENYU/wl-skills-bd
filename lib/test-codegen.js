"use strict";

// 行为契约测试生成器（方案 A）
// 从契约 customOperations 生成关键场景测试骨架：
//   1. 正常路径（前置满足 → patch 生效）
//   2. 前置拒绝（状态不满足 → ServiceException）
//   3. batch（成功/失败计数）
// 不生成 DTO getter、纯转发、Mock 镜像这类冗余测试。
// 测"行为契约"，不测"代码实现"。

const { buildContext, customOperationContext } = require("./contract");

// 为单个 customOperation 生成测试场景列表
function buildTestScenarios(opRaw, contract) {
  const op = customOperationContext(opRaw, contract); // 取 methodName/isBatch/requestFields/patchLines
  const rawPreconditions = opRaw.preconditions || []; // 用原始 precondition 的 field/operator 做场景 ID
  const scenarios = [];
  const entityName = contract.entity.name;

  if (op.kind === "batch") {
    // batch：正常路径 + 部分失败
    scenarios.push({
      id: `${op.name}_batch_success`,
      displayName: `${op.summary}_批量全部成功`,
      kind: "batch-success",
      operation: op,
      arrange: arrangeBatchSuccess(op, contract),
      assert: `// TODO: 断言 successCount=${"ids.size()"}、failureCount=0`,
      assertExpr: `assertEquals(2, result.get("successCount"));`,
    });
    scenarios.push({
      id: `${op.name}_batch_partial_failure`,
      displayName: `${op.summary}_批量部分失败`,
      kind: "batch-partial",
      operation: op,
      arrange: arrangeBatchPartialFailure(op, contract),
      assert: `// TODO: 断言 successCount/failureCount/failedIds`,
      assertExpr: `assertEquals(1, result.get("successCount")); assertEquals(1, result.get("failureCount"));`,
    });
    return scenarios;
  }

  // stateTransition / command：正常路径
  scenarios.push({
    id: `${op.name}_success`,
    displayName: `${op.summary}_正常路径`,
    kind: "success",
    operation: op,
    rawOp: opRaw,
    rawPreconditions,
    arrange: arrangeSuccess(op, contract, rawPreconditions),
    assertLines: buildPatchAssertions(op, contract),
    assertExpr: buildPatchAssertExpr(opRaw, contract),
  });

  // stateTransition：前置拒绝（每个 precondition 一个拒绝场景）
  if (rawPreconditions.length > 0 && opRaw.kind === "stateTransition") {
    for (const pc of rawPreconditions) {
      scenarios.push({
        id: `${op.name}_reject_${pc.field}_${pc.operator}`,
        displayName: `${op.summary}_前置拒绝_${pc.field}`,
        kind: "precondition-reject",
        operation: op,
        precondition: pc,
        arrange: arrangePreconditionReject(op, pc, contract),
        assertExpr: `assertThrows(ServiceException.class, () -> service.${op.methodName}(${buildMethodArgs(op, contract)}));`,
      });
    }
  }

  return scenarios;
}

function arrangeSuccess(op, contract, rawPreconditions) {
  const lines = [];
  const entityName = contract.entity.name;
  lines.push(`        ${entityName} entity = new ${entityName}();`);
  lines.push(`        entity.setId("1000000000000000001");`);
  lines.push(`        entity.setRevision(0);`);
  // 设置前置字段为满足值
  for (const pc of rawPreconditions || []) {
    const target = contract.fields.find((f) => f.name === pc.field);
    const val = formatJavaLiteral(pc.value, target ? target.javaType : "String");
    lines.push(`        entity.set${cap(pc.field)}(${val});`);
  }
  lines.push(`        // TODO: mock lambdaQuery().eq().eq().one() 返回上面的 entity（Service 用 lambdaQuery 查实体）`);
  lines.push(`        // 参考：when(baseMapper.selectById(...)).thenReturn(entity) 或 spy service.lambdaQuery()`);
  return lines;
}

function arrangeBatchSuccess(op, contract) {
  return [
    `        // TODO: mock 返回 2 个满足前置的实体（Service 用 lambdaQuery 或 baseMapper.selectList 查询）`,
  ];
}

function arrangeBatchPartialFailure(op, contract) {
  return [
    `        // TODO: mock 返回 1 个满足 + 1 个不满足的实体`,
  ];
}

function arrangePreconditionReject(op, pc, contract) {
  const lines = [];
  const entityName = contract.entity.name;
  const target = contract.fields.find((f) => f.name === pc.field);
  lines.push(`        ${entityName} entity = new ${entityName}();`);
  lines.push(`        entity.setId("1000000000000000001");`);
  // 设置前置字段为"不满足"的值（取一个与 pc.value 不同的值）
  const rejectValue = pc.operator === "equals" ? `"REJECTED_${pc.value}"` : formatJavaLiteral(pc.value, target ? target.javaType : "String");
  lines.push(`        entity.set${cap(pc.field)}(${rejectValue}); // 故意设为不满足前置的值`);
  lines.push(`        // TODO: mock lambdaQuery().eq().eq().one() 返回上面的 entity`);
  return lines;
}

function buildPatchAssertions(op, contract) {
  // 生成断言：patch 后字段应变为目标值
  return (op.patch || []).map((pa) => {
    const target = contract.fields.find((f) => f.name === pa.field);
    const val = formatJavaLiteral(pa.value, target ? target.javaType : "String");
    return `        assertEquals(${val}, entity.get${cap(pa.field)}()); // 断言 ${pa.field} 已变更`;
  });
}

function buildPatchAssertExpr(opRaw, contract) {
  const patchLines = [];
  patchLines.push(`        // TODO: 验证 patch 后字段已变更。`);
  patchLines.push(`        // Service 用 lambdaQuery 查实体后 setXxx 再 updateById；`);
  patchLines.push(`        // 可用 ArgumentCaptor 捕获 updateById 参数验证状态值（行为断言）：`);
  patchLines.push(`        //   ArgumentCaptor<${contract.entity.name}> captor = ArgumentCaptor.forClass(${contract.entity.name}.class);`);
  patchLines.push(`        //   verify(baseMapper).updateById(captor.capture());`);
  for (const pa of opRaw.patch || []) {
    const target = contract.fields.find((f) => f.name === pa.field);
    const val = formatJavaLiteral(pa.value, target ? target.javaType : "String");
    patchLines.push(`        //   assertEquals(${val}, captor.getValue().get${cap(pa.field)}()); // 断言 ${pa.field} 已变更`);
  }
  if ((opRaw.patch || []).length === 0) {
    patchLines.push(`        // 契约无 patch 字段；如有隐式状态变更，补充行为断言`);
  }
  return patchLines.join("\n");
}

function buildMethodArgs(op, contract) {
  if (op.kind === "batch") return "ids";
  // 0.15.1 body 模式：参数是 OperationRequestDTO
  const hasBodyIds = op.isBatch;
  const hasBodyId = op.idFrom === "body";
  const requestDtoPresent = hasBodyIds || hasBodyId || (op.requestFields && op.requestFields.length > 0);
  if (requestDtoPresent && contract) {
    const dtoName = `${contract.entity.name}${op.methodNameCapital}RequestDTO`;
    const rootPackage = contract.rootPackage;
    const module = contract.module;
    return `new ${rootPackage}.api.dto.${module}.${dtoName}()`; // 全限定名避免 import 缺失
  }
  // path 模式：String id
  if (op.hasId) return "\"1000000000000000001\"";
  // none 模式：无参
  return "";
}

function formatJavaLiteral(value, javaType) {
  if (value === null || value === undefined) return "null";
  if (javaType === "String") return JSON.stringify(String(value));
  if (javaType === "Integer" || javaType === "Long") return `${Number(value)}${javaType === "Long" ? "L" : ""}`;
  if (javaType === "Boolean") return value ? "Boolean.TRUE" : "Boolean.FALSE";
  if (javaType === "BigDecimal") return `new java.math.BigDecimal("${value}")`;
  return JSON.stringify(value);
}

function cap(s) {
  return String(s).charAt(0).toUpperCase() + String(s).slice(1);
}

// 为整个契约生成 ServiceTest 的 custom 区内容
function buildCustomTestsSection(contract, profile) {
  const ops = contract.customOperations || [];
  if (ops.length === 0) {
    return `    // 当前契约无 customOperations；标准 CRUD 的 smoke 测试已在上方生成。
    // 如需补充业务行为测试（如复杂查询、跨表事务），在此手写并遵守"测行为契约不测代码镜像"原则。`;
  }
  const lines = [];
  const allScenarios = [];
  for (const op of ops) {
    allScenarios.push(...buildTestScenarios(op, contract));
  }
  for (const sc of allScenarios) {
    lines.push("");
    lines.push(`    @Test`);
    lines.push(`    void ${sc.id}() {`);
    lines.push(`        // 场景：${sc.displayName}`);
    lines.push(`        // 类型：${sc.kind}（行为契约测试，参考 standards/14 + unit-test-gen）`);
    if (sc.kind === "precondition-reject") {
      lines.push(`        // 前置：${sc.precondition.field} ${sc.precondition.operator} ${JSON.stringify(sc.precondition.value)} 才允许，本测试故意不满足`);
    }
    lines.push(...sc.arrange);
    if (sc.kind === "precondition-reject") {
      const args = buildMethodArgs(sc.operation, contract);
      lines.push(`        assertThrows(ServiceException.class, () -> service.${sc.operation.methodName}(${args}));`);
    } else if (sc.kind === "batch-success" || sc.kind === "batch-partial") {
      lines.push(`        // TODO: 构造 batch 请求参数（参考 Service.${sc.operation.methodName} 签名），调用并验证 successCount/failureCount/failedIds`);
      lines.push(`        ${sc.assertExpr}`);
    } else {
      const args = buildMethodArgs(sc.operation, contract);
      lines.push(`        service.${sc.operation.methodName}(${args});`);
      lines.push(sc.assertExpr);
    }
    lines.push(`    }`);
  }
  lines.push("");
  lines.push(`    // <wl-custom name="tests">`);
  lines.push(`    // 补充更多业务行为测试（如导出、关联查询、边界值）；生成器升级时原样保留。`);
  lines.push(`    // </wl-custom>`);
  return lines.join("\n");
}

// 从契约文件生成完整 ServiceTest 内容
function generateServiceTest(contractFile, options = {}) {
  const { loadContract } = require("./contract");
  const { render } = require("./template-engine");
  const fs = require("fs");
  const path = require("path");
  const loaded = loadContract(contractFile, { projectRoot: options.projectRoot || process.cwd() });
  if (!loaded.ok) return { ok: false, errors: loaded.errors };
  const context = buildContext(loaded.contract, loaded.profile);
  const customSection = buildCustomTestsSection(loaded.contract, loaded.profile);
  const fullContext = { ...context, customTestsSection: customSection };
  const templatePath = path.resolve(__dirname, "..", "files", ".github", "templates", "ServiceTest.java.tmpl");
  const templateContent = fs.readFileSync(templatePath, "utf8");
  // 用 customTestsSection 替换模板的 <wl-custom name="tests"> 段
  const replaced = templateContent.replace(
    /\/\/ <wl-custom name="tests">[\s\S]*?<\/wl-custom>/,
    customSection,
  );
  const content = render(replaced, fullContext);
  return {
    ok: true,
    contractId: loaded.contract.contractId,
    entity: loaded.contract.entity.name,
    content,
    scenarioCount: countScenarios(loaded.contract),
  };
}

function countScenarios(contract) {
  let count = 1; // save smoke
  for (const op of contract.customOperations || []) {
    count += buildTestScenarios(op, contract).length;
  }
  return count;
}

module.exports = {
  buildCustomTestsSection,
  buildTestScenarios,
  buildMethodArgs,
  countScenarios,
  formatJavaLiteral,
  generateServiceTest,
};
