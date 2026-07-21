"use strict";

// 行为契约测试生成器。
// 生成的场景必须能够真实编译和执行，不用 TODO、空断言或“部分成功”冒充证据。
// 批量命令遵守团队事务口径：任意记录不满足前置条件时整体抛错并回滚。

const { buildContext, customOperationContext } = require("./contract");

const ENTITY_ID = "1000000000000000001";
const ENTITY_ID_2 = "1000000000000000002";

function cap(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}

function scenarioMethodName(operationName, ...parts) {
  return operationName + parts.map((part) => cap(String(part).replace(/[^a-zA-Z0-9]/g, ""))).join("");
}

function formatJavaLiteral(value, javaType) {
  if (value === null || value === undefined) return "null";
  if (javaType === "String") return JSON.stringify(String(value));
  if (javaType === "Integer" || javaType === "Long") return `${Number(value)}${javaType === "Long" ? "L" : ""}`;
  if (javaType === "Boolean") return value ? "Boolean.TRUE" : "Boolean.FALSE";
  if (javaType === "BigDecimal") return `new java.math.BigDecimal("${value}")`;
  if (javaType === "LocalDate") return `java.time.LocalDate.parse("${value}")`;
  if (javaType === "LocalDateTime") return `java.time.LocalDateTime.parse("${value}")`;
  return JSON.stringify(value);
}

function sampleValue(javaType, seed = "sample") {
  const values = {
    String: JSON.stringify(seed),
    Integer: "1",
    Long: "1L",
    Boolean: "Boolean.TRUE",
    BigDecimal: 'new java.math.BigDecimal("1.00")',
    LocalDate: 'java.time.LocalDate.of(2026, 1, 1)',
    LocalDateTime: 'java.time.LocalDateTime.of(2026, 1, 1, 0, 0)',
  };
  return values[javaType] || "null";
}

function fieldType(contract, fieldName) {
  const field = contract.fields.find((item) => item.name === fieldName);
  return field ? field.javaType : "String";
}

function differentValue(javaType, original) {
  if (javaType === "String") return JSON.stringify(`OTHER_${original === null ? "VALUE" : original}`);
  if (javaType === "Integer") return `${Number(original || 0) + 1}`;
  if (javaType === "Long") return `${Number(original || 0) + 1}L`;
  if (javaType === "Boolean") return original ? "Boolean.FALSE" : "Boolean.TRUE";
  if (javaType === "BigDecimal") return 'new java.math.BigDecimal("999.00")';
  if (javaType === "LocalDate") return 'java.time.LocalDate.of(2099, 1, 1)';
  if (javaType === "LocalDateTime") return 'java.time.LocalDateTime.of(2099, 1, 1, 0, 0)';
  return "null";
}

function satisfyingPreconditionValue(pc, javaType) {
  if (pc.operator === "equals") return formatJavaLiteral(pc.value, javaType);
  if (pc.operator === "notEquals") return differentValue(javaType, pc.value);
  if (pc.operator === "in") return formatJavaLiteral(pc.value[0], javaType);
  if (pc.operator === "notIn") return differentValue(javaType, pc.value[0]);
  if (pc.operator === "isNull") return "null";
  return sampleValue(javaType, "NOT_NULL");
}

function violatingPreconditionValue(pc, javaType) {
  if (pc.operator === "equals") return differentValue(javaType, pc.value);
  if (pc.operator === "notEquals") return formatJavaLiteral(pc.value, javaType);
  if (pc.operator === "in") return differentValue(javaType, pc.value[0]);
  if (pc.operator === "notIn") return formatJavaLiteral(pc.value[0], javaType);
  if (pc.operator === "isNull") return sampleValue(javaType, "NOT_NULL");
  return "null";
}

function entitySetup(variable, id, opRaw, contract, rejectedPrecondition) {
  const lines = [
    `        ${contract.entity.name} ${variable} = new ${contract.entity.name}();`,
    `        ${variable}.setId("${id}");`,
    `        ${variable}.setRevision(0);`,
  ];
  for (const pc of opRaw.preconditions || []) {
    const type = fieldType(contract, pc.field);
    const value = pc === rejectedPrecondition
      ? violatingPreconditionValue(pc, type)
      : satisfyingPreconditionValue(pc, type);
    lines.push(`        ${variable}.set${cap(pc.field)}(${value});`);
  }
  return lines;
}

function requestSetup(op, contract, options = {}) {
  if (!op.requestDtoPresent) return [];
  const dtoName = op.requestDtoName;
  const lines = [`        ${dtoName} request = new ${dtoName}();`];
  if (op.hasBodyId) lines.push(`        request.setId("${ENTITY_ID}");`);
  if (op.hasBodyIds) {
    lines.push(`        request.setIds(java.util.Arrays.asList("${ENTITY_ID}", "${ENTITY_ID_2}"));`);
  }
  for (const field of op.requestFields || []) {
    lines.push(`        request.set${field.Field}(${sampleValue(field.fieldType, `${field.field}_value`)});`);
  }
  if (options.singleBatchId && op.hasBodyIds) {
    lines[lines.length - 1] = `        request.setIds(java.util.Collections.singletonList("${ENTITY_ID}"));`;
  }
  return lines;
}

function buildMethodArgs(op, contract) {
  const args = [];
  if (op.hasId) args.push(`"${ENTITY_ID}"`);
  if (op.requestDtoPresent) args.push("request");
  return args.join(", ");
}

function patchAssertionLines(opRaw, contract, entityVariable = "entity") {
  return (opRaw.patch || []).map((patch) => {
    const type = fieldType(contract, patch.field);
    const expected = patch.fromRequest
      ? sampleValue(type, `${patch.fromRequest}_value`)
      : formatJavaLiteral(patch.value, type);
    return `        assertEquals(${expected}, ${entityVariable}.get${cap(patch.field)}());`;
  });
}

function successScenario(opRaw, op, contract) {
  return {
    id: scenarioMethodName(op.name, "success"),
    displayName: `${op.summary}_正常路径`,
    kind: "success",
    operation: op,
    lines: [
      ...entitySetup("entity", ENTITY_ID, opRaw, contract),
      ...requestSetup(op, contract),
      "        when(mapper.selectActiveById(any(), any())).thenReturn(entity);",
      `        when(mapper.updateAtomic(any(${contract.entity.name}.class), any(), any())).thenReturn(1);`,
      `        service.${op.methodName}(${buildMethodArgs(op, contract)});`,
      ...patchAssertionLines(opRaw, contract),
    ],
  };
}

function rejectScenario(opRaw, op, pc, contract) {
  return {
    id: scenarioMethodName(op.name, "reject", pc.field, pc.operator),
    displayName: `${op.summary}_前置拒绝_${pc.field}`,
    kind: "precondition-reject",
    operation: op,
    precondition: pc,
    lines: [
      ...entitySetup("entity", ENTITY_ID, opRaw, contract, pc),
      ...requestSetup(op, contract),
      "        when(mapper.selectActiveById(any(), any())).thenReturn(entity);",
      `        assertThrows(ServiceException.class, () -> service.${op.methodName}(${buildMethodArgs(op, contract)}));`,
    ],
  };
}

function batchSuccessScenario(opRaw, op, contract) {
  return {
    id: scenarioMethodName(op.name, "batch", "success"),
    displayName: `${op.summary}_批量全部成功`,
    kind: "batch-success",
    operation: op,
    lines: [
      ...entitySetup("first", ENTITY_ID, opRaw, contract),
      ...entitySetup("second", ENTITY_ID_2, opRaw, contract),
      ...requestSetup(op, contract),
      "        when(mapper.selectActiveByIds(any(), any()))",
      "                .thenReturn(java.util.Arrays.asList(first, second));",
      `        when(mapper.updateAtomic(any(${contract.entity.name}.class), any(), any())).thenReturn(1);`,
      `        java.util.Map<String, Object> result = service.${op.methodName}(${buildMethodArgs(op, contract)});`,
      "        assertEquals(2, result.get(\"successCount\"));",
      "        assertEquals(0, result.get(\"failureCount\"));",
      ...patchAssertionLines(opRaw, contract, "first"),
      ...patchAssertionLines(opRaw, contract, "second"),
    ],
  };
}

function batchAtomicRejectScenario(opRaw, op, contract) {
  const pc = (opRaw.preconditions || [])[0];
  const rejected = pc || null;
  const lines = [
    ...entitySetup("first", ENTITY_ID, opRaw, contract),
    ...entitySetup("second", ENTITY_ID_2, opRaw, contract, rejected),
    ...requestSetup(op, contract),
    "        when(mapper.selectActiveByIds(any(), any()))",
    "                .thenReturn(java.util.Arrays.asList(first, second));",
    `        assertThrows(ServiceException.class, () -> service.${op.methodName}(${buildMethodArgs(op, contract)}));`,
  ];
  return {
    id: scenarioMethodName(op.name, "batch", "atomic", "reject"),
    displayName: `${op.summary}_批量前置失败整体回滚`,
    kind: "batch-atomic-reject",
    operation: op,
    precondition: pc,
    lines,
  };
}

function buildTestScenarios(opRaw, contract) {
  const op = customOperationContext(opRaw, contract);
  if (op.kind === "batch") {
    return [batchSuccessScenario(opRaw, op, contract), batchAtomicRejectScenario(opRaw, op, contract)];
  }
  const scenarios = [successScenario(opRaw, op, contract)];
  if (opRaw.kind === "stateTransition") {
    for (const pc of opRaw.preconditions || []) scenarios.push(rejectScenario(opRaw, op, pc, contract));
  }
  return scenarios;
}

// 返回模板中“生成测试区”的内容；人工补充只允许写在模板的 wl-custom/tests 区。
function buildCustomTestsSection(contract) {
  const operations = contract.customOperations || [];
  if (operations.length === 0) {
    return `
    // 当前契约无 customOperations；标准 CRUD 的 save smoke 测试已在上方生成。`;
  }
  const lines = [];
  for (const raw of operations) {
    for (const scenario of buildTestScenarios(raw, contract)) {
      lines.push("");
      lines.push("    @Test");
      lines.push(`    void ${scenario.id}() {`);
      lines.push(`        // 场景：${scenario.displayName}`);
      lines.push(`        // 类型：${scenario.kind}（行为契约测试，参考 standards/14 + unit-test-gen）`);
      lines.push(...scenario.lines);
      lines.push("    }");
    }
  }
  return lines.join("\n");
}

function generateServiceTest(contractFile, options = {}) {
  const { loadContract } = require("./contract");
  const { render } = require("./template-engine");
  const fs = require("fs");
  const path = require("path");
  const loaded = loadContract(contractFile, { projectRoot: options.projectRoot || process.cwd() });
  if (!loaded.ok) return { ok: false, errors: loaded.errors };
  const context = buildContext(loaded.contract, loaded.profile);
  const customTestsSection = buildCustomTestsSection(loaded.contract);
  const templatePath = path.resolve(__dirname, "..", "files", ".github", "templates", "ServiceTest.java.tmpl");
  const content = render(fs.readFileSync(templatePath, "utf8"), { ...context, customTestsSection });
  return {
    ok: true,
    contractId: loaded.contract.contractId,
    entity: loaded.contract.entity.name,
    content,
    scenarioCount: countScenarios(loaded.contract),
  };
}

function countScenarios(contract) {
  return 1 + (contract.customOperations || [])
    .reduce((count, operation) => count + buildTestScenarios(operation, contract).length, 0);
}

module.exports = {
  buildCustomTestsSection,
  buildTestScenarios,
  buildMethodArgs,
  countScenarios,
  formatJavaLiteral,
  generateServiceTest,
};
