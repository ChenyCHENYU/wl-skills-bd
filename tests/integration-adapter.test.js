"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const {
  applyAdapterImplementationPlan,
  buildAdapterImplementationPlan,
  inspectIntegrationAdapters,
  loadAdapterConfig,
  publicAdapterImplementationPlan,
} = require("../lib/integration-adapter");

function root() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wls-mq-adapter-"));
}

function write(project, rel, content) {
  const file = path.join(project, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function config(bindingOverrides = {}, recipe = false) {
  return {
    schemaVersion: 1,
    adapters: [{
      id: "team-wrapper",
      provider: "team-platform",
      displayName: "团队封装",
      contractTransports: ["team-mq"],
      detector: {
        dependencies: [{ groupId: "com.acme", artifactId: "team-mq-starter" }],
        producerAnyOf: ["TeamMessageSender", ".publish("],
        consumerAnyOf: ["@TeamMessageListener"],
        configurationAnyOf: ["team.mq.order-topic"],
        testAnyOf: ["duplicateMessage"],
        capabilityAnyOf: { idempotency: ["InboxStore"] },
      },
      qualityGate: {
        inbound: { requiredStages: ["declared", "dependency", "configured", "wired", "tested"], requiredCapabilities: ["idempotency"], severity: "error" },
        outbound: { requiredStages: ["declared", "dependency", "configured", "wired", "tested"], requiredCapabilities: [], severity: "error" },
      },
      implementationRecipes: recipe ? [{ id: "consumer", direction: "inbound", templateRef: "templates/Consumer.java.tmpl", output: "src/main/java/com/acme/{{variables.className}}.java", requiredVariables: ["className"] }] : [],
    }],
    bindings: [{
      id: "order-created-in",
      module: "order",
      adapterId: "team-wrapper",
      direction: "inbound",
      contractRef: "contracts/order.json",
      integrationId: "ORDER_CREATED",
      sourceRefs: ["src/main/java/com/acme/OrderConsumer.java"],
      configRefs: ["src/main/resources/application.yml"],
      testRefs: ["src/test/java/com/acme/OrderConsumerTest.java"],
      runtimeEvidenceRefs: [],
      requiredCapabilities: [],
      ...bindingOverrides,
    }],
  };
}

function completeFixture(project, options = {}) {
  write(project, ".wl-skills-bd/integration-adapters.json", JSON.stringify(config(options.bindingOverrides, options.recipe), null, 2));
  write(project, "pom.xml", `<project><dependencies><dependency><groupId>com.acme</groupId><artifactId>team-mq-starter</artifactId></dependency></dependencies></project>`);
  write(project, "contracts/order.json", JSON.stringify({ integrations: [{ id: "ORDER_CREATED", direction: "inbound", transport: "team-mq" }] }));
  write(project, "src/main/java/com/acme/OrderConsumer.java", `@TeamMessageListener class OrderConsumer { private InboxStore inbox; }`);
  write(project, "src/main/resources/application.yml", `team.mq.order-topic: orders`);
  write(project, "src/test/java/com/acme/OrderConsumerTest.java", `void duplicateMessage() {}`);
}

test("没有适配描述符时不猜平台接线状态", () => {
  const project = root();
  write(project, "application.yml", "rocketmq.name-server: broker:9876");
  const result = inspectIntegrationAdapters(project);
  assert.equal(result.ok, true);
  assert.equal(result.readiness, "not-configured");
  assert.equal(result.findings.length, 0);
});

test("项目适配描述符贯通依赖、契约、配置、源码、测试和能力证据", () => {
  const project = root();
  completeFixture(project);
  const loaded = loadAdapterConfig(project);
  assert.equal(loaded.ok, true);
  const result = inspectIntegrationAdapters(project, { module: "order" });
  assert.equal(result.ok, true);
  assert.equal(result.readiness, "ready");
  assert.equal(result.bindings[0].maturity, "tested");
  assert.equal(result.bindings[0].capabilities.idempotency.ok, true);
});

test("适配器要求来自项目配置，缺证据时质量门精确阻断", () => {
  const project = root();
  completeFixture(project);
  write(project, "src/main/java/com/acme/OrderConsumer.java", `@TeamMessageListener class OrderConsumer {}`);
  const result = inspectIntegrationAdapters(project);
  assert.equal(result.ok, false);
  assert(result.findings.some((item) => item.rule === "MQ_ADAPTER_CAPABILITY" && item.capability === "idempotency"));
});

test("适配实现只使用项目模板生成新文件并保持 planHash 门", () => {
  const project = root();
  completeFixture(project, { recipe: true });
  write(project, "templates/Consumer.java.tmpl", `package com.acme;\nclass {{variables.className}} { {{adapter.displayName}} }\n`);
  const plan = buildAdapterImplementationPlan(project, { bindingId: "order-created-in", recipeId: "consumer", variables: { className: "GeneratedConsumer" } });
  assert.equal(plan.ok, true);
  const preview = publicAdapterImplementationPlan(plan);
  assert.equal(preview.safety.newFilesOnly, true);
  assert.equal(applyAdapterImplementationPlan(plan, { confirm: true, planHash: "bad" }).reason, "plan-hash-mismatch");
  const applied = applyAdapterImplementationPlan(plan, { confirm: true, planHash: plan.planHash });
  assert.equal(applied.ok, true);
  assert(fs.existsSync(path.join(project, "src/main/java/com/acme/GeneratedConsumer.java")));
  assert.equal(buildAdapterImplementationPlan(project, { bindingId: "order-created-in", recipeId: "consumer", variables: { className: "GeneratedConsumer" } }).reason, "output-exists");
});

test("适配模板或配置漂移时保持零写入", () => {
  const project = root();
  completeFixture(project, { recipe: true });
  write(project, "templates/Consumer.java.tmpl", "package com.acme;\nclass {{variables.className}} {}\n");
  const plan = buildAdapterImplementationPlan(project, { bindingId: "order-created-in", recipeId: "consumer", variables: { className: "GeneratedConsumer" } });
  write(project, "templates/Consumer.java.tmpl", "package com.acme;\nfinal class {{variables.className}} {}\n");
  const applied = applyAdapterImplementationPlan(plan, { confirm: true, planHash: plan.planHash });
  assert.equal(applied.ok, false);
  assert.equal(applied.reason, "plan-changed");
  assert.equal(fs.existsSync(path.join(project, "src/main/java/com/acme/GeneratedConsumer.java")), false);
});

test("适配 recipe 拒绝空内容、冲突标记和非标量变量", () => {
  const project = root();
  completeFixture(project, { recipe: true });
  const conflict = `${"<".repeat(7)} current\n${"=".repeat(7)}\n${">".repeat(7)} incoming\n`;
  write(project, "templates/Consumer.java.tmpl", conflict);
  assert.equal(buildAdapterImplementationPlan(project, { bindingId: "order-created-in", recipeId: "consumer", variables: { className: "GeneratedConsumer" } }).reason, "rendered-artifact-invalid");
  write(project, "templates/Consumer.java.tmpl", "class {{variables.className}} {}\n");
  assert.equal(buildAdapterImplementationPlan(project, { bindingId: "order-created-in", recipeId: "consumer", variables: { className: { unsafe: true } } }).reason, "recipe-variables-invalid");
});

test("双向绑定不能用单向契约冒充，运行证据需非空并匹配项目标记", () => {
  const project = root();
  const raw = config({
    direction: "bidirectional",
    runtimeEvidenceRefs: ["evidence/mq-runtime.json"],
  });
  raw.adapters[0].detector.runtimeEvidenceAnyOf = ["observedAt"];
  raw.adapters[0].qualityGate.inbound.requiredStages.push("runtime-evidenced");
  raw.adapters[0].qualityGate.outbound.requiredStages.push("runtime-evidenced");
  write(project, ".wl-skills-bd/integration-adapters.json", JSON.stringify(raw, null, 2));
  write(project, "pom.xml", "<project><dependencies><dependency><groupId>com.acme</groupId><artifactId>team-mq-starter</artifactId></dependency></dependencies></project>");
  write(project, "contracts/order.json", JSON.stringify({ integrations: [{ id: "ORDER_CREATED", direction: "inbound", transport: "team-mq" }] }));
  write(project, "src/main/java/com/acme/OrderConsumer.java", "@TeamMessageListener class OrderConsumer { TeamMessageSender sender; private InboxStore inbox; }");
  write(project, "src/main/resources/application.yml", "team.mq.order-topic: orders");
  write(project, "src/test/java/com/acme/OrderConsumerTest.java", "void duplicateMessage() {}");
  write(project, "evidence/mq-runtime.json", "{}");
  let result = inspectIntegrationAdapters(project);
  assert.equal(result.bindings[0].stages.declared, false);
  assert.equal(result.bindings[0].stages["runtime-evidenced"], false);
  write(project, "contracts/order.json", JSON.stringify({ integrations: [{ id: "ORDER_CREATED", direction: "bidirectional", transport: "team-mq" }] }));
  write(project, "evidence/mq-runtime.json", JSON.stringify({ observedAt: "2026-08-31T00:00:00Z" }));
  result = inspectIntegrationAdapters(project);
  assert.equal(result.ok, true);
  assert.equal(result.bindings[0].stages.declared, true);
  assert.equal(result.bindings[0].stages["runtime-evidenced"], true);
});

test("非法适配配置 fail-closed", () => {
  const project = root();
  write(project, ".wl-skills-bd/integration-adapters.json", JSON.stringify({ schemaVersion: 1, adapters: [], bindings: [{ id: "x", adapterId: "missing" }] }));
  const loaded = loadAdapterConfig(project);
  assert.equal(loaded.ok, false);
  assert(loaded.diagnostics.some((item) => item.rule === "MQ_ADAPTER_CONFIG"));
});

test("畸形适配路径返回诊断而不是抛出异常", () => {
  const project = root();
  const raw = config({}, true);
  raw.adapters[0].implementationRecipes[0].templateRef = 42;
  raw.bindings[0].contractRef = "../outside.json";
  write(project, ".wl-skills-bd/integration-adapters.json", JSON.stringify(raw));
  const loaded = loadAdapterConfig(project);
  assert.equal(loaded.ok, false);
  assert(loaded.diagnostics.some((item) => item.message.includes("templateRef")));
  assert(loaded.diagnostics.some((item) => item.message.includes("contractRef")));
});
