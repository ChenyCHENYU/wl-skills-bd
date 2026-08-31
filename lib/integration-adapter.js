"use strict";

const fs = require("fs");
const path = require("path");
const { hashJson } = require("./deterministic");
const { applyFilePlan, buildFilePlan, publicFilePlan } = require("./file-transaction");
const { hashFile, normalizeRel, resolveWithin } = require("./manifest");
const { render } = require("./template-engine");

const CONFIG_REL = ".wl-skills-bd/integration-adapters.json";
const DIRECTIONS = new Set(["inbound", "outbound", "bidirectional"]);
const STAGES = new Set(["declared", "dependency", "configured", "wired", "tested", "runtime-evidenced"]);
const SEVERITIES = new Set(["error", "warn", "info"]);
const IGNORED_DIRS = new Set([".git", "target", "node_modules", ".idea", ".vscode", ".wl-skills-bd"]);

function adapterFinding(code, message, overrides = {}) {
  const value = {
    rule: code,
    code,
    severity: "error",
    file: CONFIG_REL,
    line: 1,
    col: 1,
    message,
    standard: "integration-adapter",
    source: "integration-adapter",
    ...overrides,
  };
  value.fingerprint = value.fingerprint || hashJson({
    rule: value.rule,
    file: value.file,
    binding: value.binding || null,
    stage: value.stage || null,
    message: value.message,
  });
  return value;
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizedProjectRel(value, pointer, diagnostics) {
  if (typeof value !== "string" || !value.trim()) return null;
  const rel = normalizeRel(value.trim());
  if (!rel || rel.startsWith("../") || path.isAbsolute(rel)) {
    diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `${pointer} 必须是项目内相对路径`));
    return null;
  }
  return rel;
}

function validateStringArray(value, pointer, diagnostics, options = {}) {
  if (value === undefined && options.optional) return [];
  if (!Array.isArray(value) || (!options.allowEmpty && value.length === 0)
    || value.some((item) => typeof item !== "string" || !item.trim())) {
    diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `${pointer} 必须是${options.allowEmpty ? "" : "非空"}字符串数组`));
    return [];
  }
  return [...new Set(value.map((item) => item.trim()))];
}

function validateDetector(raw, pointer, diagnostics) {
  const value = isObject(raw) ? raw : {};
  if (!isObject(raw)) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `${pointer} 必须是对象`));
  const allowed = new Set(["dependencies", "producerAnyOf", "consumerAnyOf", "configurationAnyOf", "testAnyOf", "runtimeEvidenceAnyOf", "capabilityAnyOf"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `${pointer} 不支持 ${key}`));
  const dependencies = [];
  if (value.dependencies !== undefined) {
    if (!Array.isArray(value.dependencies)) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `${pointer}.dependencies 必须是数组`));
    else value.dependencies.forEach((item, index) => {
      if (!isObject(item) || typeof item.groupId !== "string" || !item.groupId.trim()
        || typeof item.artifactId !== "string" || !item.artifactId.trim()) {
        diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `${pointer}.dependencies[${index}] 必须提供 groupId/artifactId`));
      } else dependencies.push({ groupId: item.groupId.trim(), artifactId: item.artifactId.trim() });
    });
  }
  const capabilityAnyOf = {};
  if (value.capabilityAnyOf !== undefined) {
    if (!isObject(value.capabilityAnyOf)) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `${pointer}.capabilityAnyOf 必须是对象`));
    else for (const [name, markers] of Object.entries(value.capabilityAnyOf)) {
      if (!/^[a-z][a-z0-9-]{1,63}$/.test(name)) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `${pointer}.capabilityAnyOf 的能力 ID 非法：${name}`));
      else capabilityAnyOf[name] = validateStringArray(markers, `${pointer}.capabilityAnyOf.${name}`, diagnostics);
    }
  }
  return {
    dependencies,
    producerAnyOf: validateStringArray(value.producerAnyOf, `${pointer}.producerAnyOf`, diagnostics, { optional: true, allowEmpty: true }),
    consumerAnyOf: validateStringArray(value.consumerAnyOf, `${pointer}.consumerAnyOf`, diagnostics, { optional: true, allowEmpty: true }),
    configurationAnyOf: validateStringArray(value.configurationAnyOf, `${pointer}.configurationAnyOf`, diagnostics, { optional: true, allowEmpty: true }),
    testAnyOf: validateStringArray(value.testAnyOf, `${pointer}.testAnyOf`, diagnostics, { optional: true, allowEmpty: true }),
    runtimeEvidenceAnyOf: validateStringArray(value.runtimeEvidenceAnyOf, `${pointer}.runtimeEvidenceAnyOf`, diagnostics, { optional: true, allowEmpty: true }),
    capabilityAnyOf,
  };
}

function validateDirectionPolicy(raw, pointer, diagnostics) {
  if (!isObject(raw)) {
    diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `${pointer} 必须是对象`));
    return { requiredStages: [], requiredCapabilities: [], severity: "error" };
  }
  const allowed = new Set(["requiredStages", "requiredCapabilities", "severity"]);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `${pointer} 不支持 ${key}`));
  const requiredStages = validateStringArray(raw.requiredStages, `${pointer}.requiredStages`, diagnostics, { allowEmpty: true });
  for (const stage of requiredStages) if (!STAGES.has(stage)) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `${pointer}.requiredStages 不支持 ${stage}`));
  const requiredCapabilities = validateStringArray(raw.requiredCapabilities, `${pointer}.requiredCapabilities`, diagnostics, { optional: true, allowEmpty: true });
  const severity = raw.severity === undefined ? "error" : raw.severity;
  if (!SEVERITIES.has(severity)) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `${pointer}.severity 只允许 error/warn/info`));
  return { requiredStages, requiredCapabilities, severity: SEVERITIES.has(severity) ? severity : "error" };
}

function validateRecipe(raw, pointer, diagnostics) {
  if (!isObject(raw)) {
    diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `${pointer} 必须是对象`));
    return null;
  }
  const allowed = new Set(["id", "direction", "templateRef", "output", "requiredVariables"]);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `${pointer} 不支持 ${key}`));
  if (typeof raw.id !== "string" || !/^[a-z][a-z0-9-]{1,63}$/.test(raw.id)) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `${pointer}.id 非法`));
  if (!DIRECTIONS.has(raw.direction)) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `${pointer}.direction 非法`));
  for (const key of ["templateRef", "output"]) if (typeof raw[key] !== "string" || !raw[key].trim()) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `${pointer}.${key} 必填`));
  const requiredVariables = validateStringArray(raw.requiredVariables, `${pointer}.requiredVariables`, diagnostics, { optional: true, allowEmpty: true });
  return {
    id: raw.id,
    direction: raw.direction,
    templateRef: normalizedProjectRel(raw.templateRef, `${pointer}.templateRef`, diagnostics),
    output: raw.output,
    requiredVariables,
  };
}

function validateAdapter(raw, index, diagnostics) {
  const pointer = `adapters[${index}]`;
  if (!isObject(raw)) {
    diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `${pointer} 必须是对象`));
    return null;
  }
  const allowed = new Set(["id", "provider", "displayName", "contractTransports", "detector", "qualityGate", "implementationRecipes"]);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `${pointer} 不支持 ${key}`));
  if (typeof raw.id !== "string" || !/^[a-z][a-z0-9-]{1,63}$/.test(raw.id)) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `${pointer}.id 非法`));
  for (const key of ["provider", "displayName"]) if (typeof raw[key] !== "string" || !raw[key].trim()) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `${pointer}.${key} 必填`));
  const contractTransports = validateStringArray(raw.contractTransports, `${pointer}.contractTransports`, diagnostics);
  const detector = validateDetector(raw.detector, `${pointer}.detector`, diagnostics);
  const quality = isObject(raw.qualityGate) ? raw.qualityGate : {};
  if (!isObject(raw.qualityGate)) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `${pointer}.qualityGate 必须是对象`));
  const qualityAllowed = new Set(["inbound", "outbound"]);
  for (const key of Object.keys(quality)) if (!qualityAllowed.has(key)) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `${pointer}.qualityGate 不支持 ${key}`));
  const implementationRecipes = [];
  if (raw.implementationRecipes !== undefined) {
    if (!Array.isArray(raw.implementationRecipes)) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `${pointer}.implementationRecipes 必须是数组`));
    else raw.implementationRecipes.forEach((item, recipeIndex) => {
      const recipe = validateRecipe(item, `${pointer}.implementationRecipes[${recipeIndex}]`, diagnostics);
      if (recipe) implementationRecipes.push(recipe);
    });
  }
  return {
    id: raw.id,
    provider: raw.provider,
    displayName: raw.displayName,
    contractTransports,
    detector,
    qualityGate: {
      inbound: validateDirectionPolicy(quality.inbound, `${pointer}.qualityGate.inbound`, diagnostics),
      outbound: validateDirectionPolicy(quality.outbound, `${pointer}.qualityGate.outbound`, diagnostics),
    },
    implementationRecipes,
  };
}

function validateBinding(raw, index, diagnostics) {
  const pointer = `bindings[${index}]`;
  if (!isObject(raw)) {
    diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `${pointer} 必须是对象`));
    return null;
  }
  const allowed = new Set([
    "id", "module", "adapterId", "direction", "contractRef", "integrationId",
    "sourceRefs", "configRefs", "testRefs", "runtimeEvidenceRefs", "requiredCapabilities",
  ]);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `${pointer} 不支持 ${key}`));
  for (const key of ["id", "module", "adapterId", "contractRef", "integrationId"]) {
    if (typeof raw[key] !== "string" || !raw[key].trim()) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `${pointer}.${key} 必填`));
  }
  if (!DIRECTIONS.has(raw.direction)) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `${pointer}.direction 非法`));
  const contractRef = normalizedProjectRel(raw.contractRef, `${pointer}.contractRef`, diagnostics);
  const normalizedRefs = (values, name) => values.map((item, itemIndex) => normalizedProjectRel(item, `${pointer}.${name}[${itemIndex}]`, diagnostics)).filter(Boolean);
  const sourceRefs = validateStringArray(raw.sourceRefs, `${pointer}.sourceRefs`, diagnostics, { optional: true, allowEmpty: true });
  const configRefs = validateStringArray(raw.configRefs, `${pointer}.configRefs`, diagnostics, { optional: true, allowEmpty: true });
  const testRefs = validateStringArray(raw.testRefs, `${pointer}.testRefs`, diagnostics, { optional: true, allowEmpty: true });
  const runtimeEvidenceRefs = validateStringArray(raw.runtimeEvidenceRefs, `${pointer}.runtimeEvidenceRefs`, diagnostics, { optional: true, allowEmpty: true });
  return {
    id: raw.id,
    module: raw.module,
    adapterId: raw.adapterId,
    direction: raw.direction,
    contractRef,
    integrationId: raw.integrationId,
    sourceRefs: normalizedRefs(sourceRefs, "sourceRefs"),
    configRefs: normalizedRefs(configRefs, "configRefs"),
    testRefs: normalizedRefs(testRefs, "testRefs"),
    runtimeEvidenceRefs: normalizedRefs(runtimeEvidenceRefs, "runtimeEvidenceRefs"),
    requiredCapabilities: validateStringArray(raw.requiredCapabilities, `${pointer}.requiredCapabilities`, diagnostics, { optional: true, allowEmpty: true }),
  };
}

function validateAdapterConfig(raw) {
  const diagnostics = [];
  if (!isObject(raw)) return { ok: false, adapters: [], bindings: [], diagnostics: [adapterFinding("MQ_ADAPTER_CONFIG", "适配配置根节点必须是对象")] };
  const allowed = new Set(["schemaVersion", "adapters", "bindings"]);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `不支持配置项 ${key}`));
  if (raw.schemaVersion !== 1) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", "只支持 schemaVersion=1"));
  if (!Array.isArray(raw.adapters)) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", "adapters 必须是数组"));
  if (!Array.isArray(raw.bindings)) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", "bindings 必须是数组"));
  const adapters = Array.isArray(raw.adapters) ? raw.adapters.map((item, index) => validateAdapter(item, index, diagnostics)).filter(Boolean) : [];
  const bindings = Array.isArray(raw.bindings) ? raw.bindings.map((item, index) => validateBinding(item, index, diagnostics)).filter(Boolean) : [];
  for (const [label, values] of [["adapter", adapters], ["binding", bindings]]) {
    const seen = new Set();
    for (const item of values) {
      if (!item.id || seen.has(item.id)) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `${label} id 重复或为空：${item.id || "<empty>"}`));
      seen.add(item.id);
    }
  }
  const adapterIds = new Set(adapters.map((item) => item.id));
  for (const binding of bindings) if (!adapterIds.has(binding.adapterId)) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `binding ${binding.id} 引用不存在的 adapter ${binding.adapterId}`));
  for (const adapter of adapters) {
    const capabilityIds = new Set(Object.keys(adapter.detector.capabilityAnyOf));
    const recipeIds = new Set();
    for (const recipe of adapter.implementationRecipes) {
      if (!recipe.id || recipeIds.has(recipe.id)) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `adapter ${adapter.id} recipe id 重复或为空：${recipe.id || "<empty>"}`));
      recipeIds.add(recipe.id);
    }
    for (const direction of ["inbound", "outbound"]) {
      const policy = adapter.qualityGate[direction];
      for (const capability of policy.requiredCapabilities) {
        if (!capabilityIds.has(capability)) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `adapter ${adapter.id} ${direction} 要求能力 ${capability}，但 detector 未声明标记`));
      }
      if (policy.requiredStages.includes("configured") && adapter.detector.configurationAnyOf.length === 0) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `adapter ${adapter.id} ${direction} 要求 configured，但 detector.configurationAnyOf 为空`));
      if (policy.requiredStages.includes("wired") && adapter.detector[direction === "inbound" ? "consumerAnyOf" : "producerAnyOf"].length === 0) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `adapter ${adapter.id} ${direction} 要求 wired，但对应源码标记为空`));
      if (policy.requiredStages.includes("tested") && adapter.detector.testAnyOf.length === 0) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `adapter ${adapter.id} ${direction} 要求 tested，但 detector.testAnyOf 为空`));
    }
  }
  for (const binding of bindings) {
    const adapter = adapters.find((item) => item.id === binding.adapterId);
    if (!adapter) continue;
    const capabilityIds = new Set(Object.keys(adapter.detector.capabilityAnyOf));
    for (const capability of binding.requiredCapabilities) {
      if (!capabilityIds.has(capability)) diagnostics.push(adapterFinding("MQ_ADAPTER_CONFIG", `binding ${binding.id} 要求能力 ${capability}，但 adapter ${adapter.id} 未声明标记`));
    }
  }
  return { ok: diagnostics.length === 0, adapters, bindings, diagnostics };
}

function loadAdapterConfig(projectRootInput) {
  const projectRoot = path.resolve(projectRootInput);
  const file = path.join(projectRoot, CONFIG_REL);
  if (!fs.existsSync(file)) return { ok: true, configured: false, file: CONFIG_REL, adapters: [], bindings: [], diagnostics: [] };
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return { ok: false, configured: true, file: CONFIG_REL, adapters: [], bindings: [], diagnostics: [adapterFinding("MQ_ADAPTER_CONFIG", `JSON 无法解析：${error.message}`)] };
  }
  return { configured: true, file: CONFIG_REL, raw, ...validateAdapterConfig(raw) };
}

function listFiles(root, name, output = []) {
  if (!fs.existsSync(root)) return output;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) listFiles(file, name, output);
    else if (entry.isFile() && entry.name === name) output.push(file);
  }
  return output;
}

function pomDependencies(projectRoot) {
  const coordinates = new Set();
  const evidence = [];
  for (const file of listFiles(projectRoot, "pom.xml")) {
    const content = fs.readFileSync(file, "utf8");
    for (const match of content.matchAll(/<dependency>\s*([\s\S]*?)<\/dependency>/g)) {
      const group = (match[1].match(/<groupId>\s*([^<]+)\s*<\/groupId>/) || [])[1];
      const artifact = (match[1].match(/<artifactId>\s*([^<]+)\s*<\/artifactId>/) || [])[1];
      if (!group || !artifact) continue;
      const coordinate = `${group.trim()}:${artifact.trim()}`;
      coordinates.add(coordinate);
      evidence.push({ coordinate, file: normalizeRel(path.relative(projectRoot, file)) });
    }
  }
  return { coordinates, evidence };
}

function readEvidenceRefs(projectRoot, refs) {
  const files = [];
  const missing = [];
  for (const rel of refs) {
    try {
      const file = resolveWithin(projectRoot, rel);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) missing.push(rel);
      else files.push({ rel, content: fs.readFileSync(file, "utf8") });
    } catch {
      missing.push(rel);
    }
  }
  return { files, missing, content: files.map((item) => item.content).join("\n") };
}

function anyMarker(content, markers) {
  const matched = markers.filter((marker) => content.includes(marker));
  return { ok: markers.length > 0 && matched.length > 0, matched };
}

function contractEvidence(projectRoot, binding, adapter) {
  let file;
  try {
    file = resolveWithin(projectRoot, binding.contractRef);
  } catch (error) {
    return { ok: false, reason: error.message };
  }
  if (!fs.existsSync(file)) return { ok: false, reason: "contract-ref-missing" };
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return { ok: false, reason: `contract-json-invalid: ${error.message}` };
  }
  const integrations = Array.isArray(raw.integrations) ? raw.integrations : [];
  const integration = integrations.find((item) => item && item.id === binding.integrationId);
  if (!integration) return { ok: false, reason: "integration-id-missing" };
  const transports = new Set(adapter.contractTransports.map((item) => item.toLowerCase()));
  const transportOk = typeof integration.transport === "string" && transports.has(integration.transport.toLowerCase());
  const directionOk = integration.direction === binding.direction || integration.direction === "bidirectional";
  return { ok: transportOk && directionOk, transportOk, directionOk, integration, file: binding.contractRef };
}

function directionPolicies(adapter, direction) {
  if (direction === "bidirectional") return [adapter.qualityGate.inbound, adapter.qualityGate.outbound];
  return [adapter.qualityGate[direction]];
}

function inspectBinding(projectRoot, adapter, binding, dependencies) {
  const contract = contractEvidence(projectRoot, binding, adapter);
  const source = readEvidenceRefs(projectRoot, binding.sourceRefs);
  const configuration = readEvidenceRefs(projectRoot, binding.configRefs);
  const tests = readEvidenceRefs(projectRoot, binding.testRefs);
  const runtime = readEvidenceRefs(projectRoot, binding.runtimeEvidenceRefs);
  const dependencyCoordinates = adapter.detector.dependencies.map((item) => `${item.groupId}:${item.artifactId}`);
  const dependencyMatched = dependencyCoordinates.filter((item) => dependencies.coordinates.has(item));
  const producerWired = anyMarker(source.content, adapter.detector.producerAnyOf);
  const consumerWired = anyMarker(source.content, adapter.detector.consumerAnyOf);
  const wired = binding.direction === "inbound"
    ? consumerWired
    : binding.direction === "outbound"
      ? producerWired
      : { ok: producerWired.ok && consumerWired.ok, matched: [...consumerWired.matched, ...producerWired.matched] };
  const configured = anyMarker(configuration.content, adapter.detector.configurationAnyOf);
  const tested = anyMarker(tests.content, adapter.detector.testAnyOf);
  const runtimeMarked = anyMarker(runtime.content, adapter.detector.runtimeEvidenceAnyOf);
  const runtimePresent = runtime.missing.length === 0
    && runtime.files.length > 0
    && runtime.files.every((item) => item.content.trim().length > 0)
    && (adapter.detector.runtimeEvidenceAnyOf.length === 0 || runtimeMarked.ok);
  const stages = {
    declared: contract.ok,
    dependency: dependencyCoordinates.length === 0 ? true : dependencyMatched.length > 0,
    configured: configuration.missing.length === 0 && configured.ok,
    wired: source.missing.length === 0 && wired.ok,
    tested: tests.missing.length === 0 && tested.ok,
    "runtime-evidenced": runtimePresent,
  };
  const policies = directionPolicies(adapter, binding.direction);
  const requiredStages = [...new Set(policies.flatMap((item) => item.requiredStages))];
  const requiredCapabilities = [...new Set([...binding.requiredCapabilities, ...policies.flatMap((item) => item.requiredCapabilities)])];
  const severity = policies.some((item) => item.severity === "error") ? "error" : policies.some((item) => item.severity === "warn") ? "warn" : "info";
  const content = [source.content, configuration.content, tests.content].join("\n");
  const capabilities = {};
  for (const capability of requiredCapabilities) capabilities[capability] = anyMarker(content, adapter.detector.capabilityAnyOf[capability] || []);
  const findings = [];
  for (const stage of requiredStages) {
    if (!stages[stage]) findings.push(adapterFinding("MQ_ADAPTER_STAGE", `绑定 ${binding.id} 缺少由适配器 ${adapter.id} 要求的 ${stage} 证据`, {
      severity,
      binding: binding.id,
      stage,
      file: stage === "declared" ? binding.contractRef : CONFIG_REL,
    }));
  }
  for (const [capability, result] of Object.entries(capabilities)) {
    if (!result.ok) findings.push(adapterFinding("MQ_ADAPTER_CAPABILITY", `绑定 ${binding.id} 未匹配平台适配器要求的能力 ${capability}`, {
      severity,
      binding: binding.id,
      capability,
    }));
  }
  const ordered = ["declared", "dependency", "configured", "wired", "tested", "runtime-evidenced"];
  let maturity = "not-declared";
  for (const stage of ordered) {
    if (!stages[stage]) break;
    maturity = stage;
  }
  return {
    id: binding.id,
    module: binding.module,
    adapterId: adapter.id,
    provider: adapter.provider,
    direction: binding.direction,
    contract: { ref: binding.contractRef, integrationId: binding.integrationId, ...contract },
    stages,
    maturity,
    requiredStages,
    capabilities,
    evidence: {
      dependencies: dependencyMatched,
      sourceRefs: source.files.map((item) => item.rel),
      configRefs: configuration.files.map((item) => item.rel),
      testRefs: tests.files.map((item) => item.rel),
      runtimeEvidenceRefs: runtime.files.map((item) => item.rel),
      matched: { wired: wired.matched, configured: configured.matched, tested: tested.matched, runtime: runtimeMarked.matched },
      missingRefs: [...source.missing, ...configuration.missing, ...tests.missing, ...runtime.missing],
    },
    findings,
  };
}

function bindingAffected(binding, changedFiles) {
  if (changedFiles === null || changedFiles === undefined) return true;
  const changed = new Set(changedFiles.map(normalizeRel));
  if (changed.has(CONFIG_REL)) return true;
  const refs = [binding.contractRef, ...binding.sourceRefs, ...binding.configRefs, ...binding.testRefs, ...binding.runtimeEvidenceRefs];
  return refs.some((item) => changed.has(normalizeRel(item)));
}

function inspectIntegrationAdapters(projectRootInput, options = {}) {
  const projectRoot = path.resolve(projectRootInput);
  const loaded = loadAdapterConfig(projectRoot);
  if (!loaded.configured) {
    return {
      schemaVersion: 1,
      ok: true,
      configured: false,
      readiness: "not-configured",
      bindings: [],
      findings: [],
      summary: { adapters: 0, bindings: 0, evaluated: 0, errors: 0, warnings: 0 },
      note: "未配置平台适配描述符；不猜测 MQ SDK、平台封装或接线状态",
    };
  }
  if (!loaded.ok) {
    return {
      schemaVersion: 1,
      ok: false,
      configured: true,
      readiness: "invalid-config",
      bindings: [],
      findings: loaded.diagnostics,
      summary: { adapters: loaded.adapters.length, bindings: loaded.bindings.length, evaluated: 0, errors: loaded.diagnostics.filter((item) => item.severity === "error").length, warnings: 0 },
    };
  }
  const adapters = new Map(loaded.adapters.map((item) => [item.id, item]));
  const selected = loaded.bindings.filter((item) => (!options.module || item.module === options.module) && bindingAffected(item, options.changedFiles));
  const dependencies = pomDependencies(projectRoot);
  const bindings = selected.map((binding) => inspectBinding(projectRoot, adapters.get(binding.adapterId), binding, dependencies));
  const findings = bindings.flatMap((item) => item.findings);
  const errors = findings.filter((item) => item.severity === "error").length;
  const warnings = findings.filter((item) => item.severity === "warn").length;
  return {
    schemaVersion: 1,
    ok: errors === 0,
    configured: true,
    readiness: bindings.length === 0 ? "no-bindings" : errors > 0 ? "incomplete" : warnings > 0 ? "warning" : "ready",
    configHash: hashJson(loaded.raw),
    bindings,
    findings,
    summary: { adapters: loaded.adapters.length, bindings: loaded.bindings.length, evaluated: bindings.length, errors, warnings },
  };
}

function validateRenderedArtifact(output, content) {
  if (!output || !String(output).trim()) return "输出路径为空";
  if (!content || !String(content).trim()) return "生成内容为空";
  if (String(content).includes("\0")) return "生成内容包含 NUL 字节";
  if (/^(?:<{7}|={7}|>{7})/m.test(String(content))) return "生成内容包含冲突标记";
  if (/{{\s*[^{}]+\s*}}/.test(String(content))) return "生成内容仍含未解析模板变量";
  return null;
}

function buildAdapterImplementationPlan(projectRootInput, options = {}) {
  const projectRoot = path.resolve(projectRootInput);
  const loaded = loadAdapterConfig(projectRoot);
  if (!loaded.configured) return { ok: false, reason: "adapter-config-missing" };
  if (!loaded.ok) return { ok: false, reason: "adapter-config-invalid", errors: loaded.diagnostics };
  const binding = loaded.bindings.find((item) => item.id === options.bindingId);
  if (!binding) return { ok: false, reason: "binding-not-found", bindingId: options.bindingId };
  const adapter = loaded.adapters.find((item) => item.id === binding.adapterId);
  const recipe = adapter.implementationRecipes.find((item) => item.id === options.recipeId);
  if (!recipe) return { ok: false, reason: "recipe-not-found", recipeId: options.recipeId };
  if (!(recipe.direction === binding.direction || recipe.direction === "bidirectional" || binding.direction === "bidirectional")) {
    return { ok: false, reason: "recipe-direction-mismatch", bindingDirection: binding.direction, recipeDirection: recipe.direction };
  }
  const variables = isObject(options.variables) ? options.variables : {};
  const invalidVariables = Object.entries(variables).filter(([key, value]) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(key)
    || !["string", "number", "boolean"].includes(typeof value));
  if (invalidVariables.length > 0) return { ok: false, reason: "recipe-variables-invalid", variables: invalidVariables.map(([key]) => key) };
  const missing = recipe.requiredVariables.filter((key) => !Object.prototype.hasOwnProperty.call(variables, key)
    || !["string", "number", "boolean"].includes(typeof variables[key]));
  if (missing.length > 0) return { ok: false, reason: "recipe-variables-missing", missing };
  let templateFile;
  try {
    templateFile = resolveWithin(projectRoot, recipe.templateRef);
  } catch (error) {
    return { ok: false, reason: "template-outside-project", message: error.message };
  }
  if (!fs.existsSync(templateFile)) return { ok: false, reason: "template-missing", templateRef: recipe.templateRef };
  let output;
  let content;
  try {
    const context = { binding, adapter: { id: adapter.id, provider: adapter.provider, displayName: adapter.displayName }, variables };
    output = normalizeRel(render(recipe.output, context));
    content = render(fs.readFileSync(templateFile, "utf8"), context);
  } catch (error) {
    return { ok: false, reason: "recipe-render-failed", message: error.message };
  }
  const renderedError = validateRenderedArtifact(output, content);
  if (renderedError) return { ok: false, reason: "rendered-artifact-invalid", message: renderedError };
  let destination;
  try {
    destination = resolveWithin(projectRoot, output);
  } catch (error) {
    return { ok: false, reason: "output-outside-project", message: error.message };
  }
  if (fs.existsSync(destination)) return { ok: false, reason: "output-exists", output, hint: "适配实现只允许新文件；存量实现由人工评审，避免覆盖平台封装" };
  const plan = buildFilePlan(projectRoot, output, content, {
    kind: "integration-adapter-implementation",
    metadata: {
      bindingId: binding.id,
      adapterId: adapter.id,
      recipeId: recipe.id,
      templateRef: recipe.templateRef,
      templateHash: hashFile(templateFile),
      configHash: hashJson(loaded.raw),
    },
  });
  return { ...plan, binding, adapter, recipe, request: { bindingId: binding.id, recipeId: recipe.id, variables: { ...variables } } };
}

function publicAdapterImplementationPlan(plan) {
  const value = publicFilePlan(plan);
  if (!value.ok) return value;
  return { ...value, safety: { newFilesOnly: true, platformTemplateOwned: true, overwrite: false } };
}

function applyAdapterImplementationPlan(plan, options = {}) {
  if (!plan.ok || !plan.request) return { ok: false, reason: plan.reason || "invalid-plan", applied: [] };
  const fresh = buildAdapterImplementationPlan(plan.projectRoot, plan.request);
  if (!fresh.ok || fresh.planHash !== plan.planHash) {
    return { ok: false, reason: "plan-changed", expectedPlanHash: fresh.planHash || null, details: fresh.reason || null, applied: [] };
  }
  const result = applyFilePlan(fresh, options);
  if (!result.ok) return result;
  const verification = inspectIntegrationAdapters(fresh.projectRoot, { module: fresh.binding.module });
  return {
    ...result,
    state: verification.ok ? "applied-verified" : "applied-pending-project-verification",
    verification: { ok: verification.ok, readiness: verification.readiness, summary: verification.summary },
  };
}

module.exports = {
  CONFIG_REL,
  STAGES,
  adapterFinding,
  applyAdapterImplementationPlan,
  buildAdapterImplementationPlan,
  inspectIntegrationAdapters,
  loadAdapterConfig,
  pomDependencies,
  publicAdapterImplementationPlan,
  validateRenderedArtifact,
  validateAdapterConfig,
};
