"use strict";

const assert = require("assert");
const { executePipeline, planPipeline, validatePipeline } = require("../lib/pipeline");
const taskRouter = require("../lib/task-router");

(async () => {
  const taskPlan = taskRouter.buildTaskPipeline("add-api");
  assert.strictEqual(taskPlan.ok, true);
  assert.deepStrictEqual(taskPlan.nodes.map((node) => node.id), ["discover", "context", "validate", "plan", "approval", "apply", "verify"]);
  assert.match(taskPlan.pipelineHash, /^[a-f0-9]{64}$/);
  assert.strictEqual(taskRouter.buildTaskPipeline("audit").nodes.some((node) => node.id === "apply"), false);

  const invalidRetry = validatePipeline({
    id: "bad-write-pipeline",
    nodes: [{ id: "apply", sideEffect: "local-write", requiresConfirmation: true, maxRetries: 1 }],
  });
  assert.strictEqual(invalidRetry.ok, false, "有副作用节点禁止自动重试");
  const cyclic = planPipeline({
    id: "cyclic-pipeline",
    nodes: [{ id: "one", dependsOn: ["two"] }, { id: "two", dependsOn: ["one"] }],
  });
  assert.strictEqual(cyclic.ok, false);

  const handlers = {
    discover: () => ({ files: 2 }),
    context: ({ dependencies }) => ({ files: dependencies.discover.files }),
    validate: () => ({ ok: true }),
    plan: () => ({ planHash: "a".repeat(64) }),
    apply: () => ({ applied: 1 }),
    verify: () => ({ ok: true }),
  };
  const blocked = await executePipeline(taskPlan, handlers, { pipelineHash: taskPlan.pipelineHash });
  assert.strictEqual(blocked.status, "blocked");
  assert.strictEqual(blocked.nodes.find((node) => node.id === "approval").reason, "confirmation-required");
  assert.strictEqual(blocked.nodes.find((node) => node.id === "apply").state, "skipped");

  const events = [];
  const completed = await executePipeline(taskPlan, handlers, {
    pipelineHash: taskPlan.pipelineHash,
    confirmations: ["approval", "apply"],
    onEvent: (event) => events.push(event),
  });
  assert.strictEqual(completed.status, "completed");
  assert.ok(completed.nodes.every((node) => node.state === "completed"));
  assert.ok(completed.nodes.filter((node) => node.id !== "approval").every((node) => /^[a-f0-9]{64}$/.test(node.outputHash)));
  assert.ok(events.some((event) => event.type === "node-completed"));

  const drifted = await executePipeline(taskPlan, handlers, { pipelineHash: "0".repeat(64) });
  assert.strictEqual(drifted.reason, "pipeline-drift");

  const flakyDefinition = {
    id: "retry-read-pipeline",
    nodes: [{ id: "discover", maxRetries: 1, timeoutMs: 1000 }],
  };
  let calls = 0;
  const retried = await executePipeline(flakyDefinition, { discover: () => {
    calls += 1;
    if (calls === 1) throw new Error("transient");
    return { ok: true };
  } });
  assert.strictEqual(retried.status, "completed");
  assert.strictEqual(retried.nodes[0].attempts, 2);

  console.log("✅ pipeline：DAG、节点契约、确认门、漂移阻断、只读重试与可观测状态通过");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
