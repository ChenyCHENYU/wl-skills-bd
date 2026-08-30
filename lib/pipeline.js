"use strict";

const { hashJson } = require("./deterministic");

const NODE_STATES = Object.freeze(["pending", "running", "completed", "blocked", "failed", "skipped"]);
const SIDE_EFFECTS = new Set(["none", "local-write", "external-write"]);

function normalizeNode(node) {
  return {
    id: node.id,
    kind: node.kind || node.id,
    dependsOn: [...new Set(node.dependsOn || [])].sort(),
    sideEffect: node.sideEffect || "none",
    requiresConfirmation: node.requiresConfirmation === true,
    timeoutMs: Number.isInteger(node.timeoutMs) ? node.timeoutMs : 0,
    maxRetries: Number.isInteger(node.maxRetries) ? node.maxRetries : 0,
    inputContract: node.inputContract || "pipeline-context@1",
    outputContract: node.outputContract || `${node.kind || node.id}-result@1`,
  };
}

function validatePipeline(definition) {
  const errors = [];
  if (!definition || typeof definition !== "object") return { ok: false, errors: ["pipeline 必须是对象"] };
  if (!/^[a-z][a-z0-9-]{2,63}$/.test(String(definition.id || ""))) errors.push("pipeline.id 格式非法");
  if (!Array.isArray(definition.nodes) || definition.nodes.length === 0) errors.push("pipeline.nodes 不能为空");
  const nodes = (definition.nodes || []).map(normalizeNode);
  const byId = new Map();
  for (const node of nodes) {
    if (!/^[a-z][a-z0-9-]{1,47}$/.test(String(node.id || ""))) errors.push(`节点 ID 非法：${node.id}`);
    if (byId.has(node.id)) errors.push(`节点 ID 重复：${node.id}`);
    byId.set(node.id, node);
    if (!SIDE_EFFECTS.has(node.sideEffect)) errors.push(`${node.id}.sideEffect 非法：${node.sideEffect}`);
    if (node.maxRetries < 0 || node.maxRetries > 2) errors.push(`${node.id}.maxRetries 只允许 0~2`);
    if (node.timeoutMs < 0 || node.timeoutMs > 120000) errors.push(`${node.id}.timeoutMs 只允许 0~120000`);
    if (node.sideEffect !== "none" && node.maxRetries > 0) errors.push(`${node.id} 有副作用，禁止自动重试`);
    if (node.sideEffect !== "none" && node.timeoutMs > 0) errors.push(`${node.id} 有副作用，禁止用无法取消的超时包装执行`);
    if (node.sideEffect !== "none" && !node.requiresConfirmation) errors.push(`${node.id} 有副作用，必须 requiresConfirmation=true`);
  }
  for (const node of nodes) {
    for (const dependency of node.dependsOn) if (!byId.has(dependency)) errors.push(`${node.id} 依赖不存在节点 ${dependency}`);
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) { errors.push(`pipeline 存在循环依赖：${id}`); return; }
    if (visited.has(id) || !byId.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const node of nodes) visit(node.id);
  return { ok: errors.length === 0, errors: [...new Set(errors)], nodes };
}

function topologicalNodes(nodes) {
  const pending = new Map(nodes.map((node) => [node.id, node]));
  const complete = new Set();
  const output = [];
  while (pending.size > 0) {
    const ready = [...pending.values()]
      .filter((node) => node.dependsOn.every((dependency) => complete.has(dependency)))
      .sort((left, right) => left.id.localeCompare(right.id));
    if (ready.length === 0) break;
    for (const node of ready) {
      pending.delete(node.id);
      complete.add(node.id);
      output.push(node);
    }
  }
  return output;
}

function planPipeline(definition) {
  const validation = validatePipeline(definition);
  if (!validation.ok) return validation;
  const nodes = topologicalNodes(validation.nodes);
  const publicDefinition = { schemaVersion: 1, id: definition.id, nodes };
  return { ok: true, ...publicDefinition, pipelineHash: hashJson(publicDefinition) };
}

function timeoutPromise(promise, timeoutMs, nodeId) {
  if (!timeoutMs) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error(`节点 ${nodeId} 超时`), { code: "NODE_TIMEOUT" })), timeoutMs);
    if (typeof timer.unref === "function") timer.unref();
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

async function executeNode(node, handler, input) {
  let lastError;
  for (let attempt = 1; attempt <= node.maxRetries + 1; attempt += 1) {
    try {
      const output = await timeoutPromise(Promise.resolve().then(() => handler(input, node)), node.timeoutMs, node.id);
      if (output && output.ok === false) {
        const error = new Error(output.reason || `节点 ${node.id} 返回失败`);
        error.code = output.reason || "NODE_REJECTED";
        error.output = output;
        throw error;
      }
      return { ok: true, attempt, output };
    } catch (error) {
      lastError = error;
      if (attempt > node.maxRetries) break;
    }
  }
  return { ok: false, attempt: node.maxRetries + 1, error: lastError };
}

async function executePipeline(definition, handlers, options = {}) {
  const plan = planPipeline(definition);
  if (!plan.ok) return { ...plan, status: "invalid" };
  if (options.pipelineHash && options.pipelineHash !== plan.pipelineHash) {
    return { ok: false, status: "blocked", reason: "pipeline-drift", expectedPipelineHash: plan.pipelineHash, nodes: [] };
  }
  const confirmations = new Set(options.confirmations || []);
  const nodeResults = [];
  const outputs = {};
  const states = new Map(plan.nodes.map((node) => [node.id, "pending"]));
  const emit = (event) => { if (typeof options.onEvent === "function") options.onEvent(event); };
  for (const node of plan.nodes) {
    const blockedDependency = node.dependsOn.find((dependency) => states.get(dependency) !== "completed");
    if (blockedDependency) {
      states.set(node.id, "skipped");
      nodeResults.push({ id: node.id, state: "skipped", reason: `dependency-not-completed:${blockedDependency}`, durationMs: 0 });
      continue;
    }
    if (node.kind === "approval" || node.requiresConfirmation) {
      if (!confirmations.has(node.id)) {
        states.set(node.id, "blocked");
        nodeResults.push({ id: node.id, state: "blocked", reason: "confirmation-required", durationMs: 0 });
        emit({ type: "node-blocked", nodeId: node.id, reason: "confirmation-required" });
        continue;
      }
      if (node.kind === "approval" && typeof handlers[node.id] !== "function") {
        states.set(node.id, "completed");
        nodeResults.push({ id: node.id, state: "completed", confirmed: true, durationMs: 0 });
        continue;
      }
    }
    const handler = handlers[node.id] || handlers[node.kind];
    if (typeof handler !== "function") {
      states.set(node.id, "blocked");
      nodeResults.push({ id: node.id, state: "blocked", reason: "handler-missing", durationMs: 0 });
      continue;
    }
    states.set(node.id, "running");
    emit({ type: "node-started", nodeId: node.id });
    const started = Date.now();
    const input = {
      context: options.context || {},
      dependencies: Object.fromEntries(node.dependsOn.map((dependency) => [dependency, outputs[dependency]])),
    };
    const result = await executeNode(node, handler, input);
    const durationMs = Date.now() - started;
    if (!result.ok) {
      states.set(node.id, "failed");
      nodeResults.push({
        id: node.id,
        state: "failed",
        reason: result.error && (result.error.code || result.error.message) || "node-failed",
        attempts: result.attempt,
        durationMs,
      });
      emit({ type: "node-failed", nodeId: node.id, durationMs });
      continue;
    }
    outputs[node.id] = result.output;
    states.set(node.id, "completed");
    nodeResults.push({ id: node.id, state: "completed", attempts: result.attempt, durationMs, outputHash: hashJson(result.output === undefined ? null : result.output) });
    emit({ type: "node-completed", nodeId: node.id, durationMs });
  }
  const failed = nodeResults.some((node) => node.state === "failed");
  const blocked = nodeResults.some((node) => node.state === "blocked" || node.state === "skipped");
  return {
    ok: !failed && !blocked,
    status: failed ? "failed" : blocked ? "blocked" : "completed",
    pipelineHash: plan.pipelineHash,
    nodes: nodeResults,
    durationMs: nodeResults.reduce((total, node) => total + node.durationMs, 0),
    ...(options.includeOutputs ? { outputs } : {}),
  };
}

module.exports = { NODE_STATES, executePipeline, planPipeline, validatePipeline };
