"use strict";

const fs = require("fs");
const path = require("path");
const { hashJson } = require("./deterministic");
const { normalizeRel } = require("./manifest");

const CONFIG_REL = ".wl-skills-bd/supply-chain.json";
const IGNORED_DIRS = new Set([".git", "target", "node_modules", ".idea", ".vscode", ".wl-skills-bd"]);

function finding(code, message, overrides = {}) {
  const value = {
    rule: code,
    code,
    severity: "error",
    file: CONFIG_REL,
    line: 1,
    col: 1,
    message,
    standard: "supply-chain",
    source: "supply-chain",
    ...overrides,
  };
  value.fingerprint = value.fingerprint || hashJson({ rule: value.rule, file: value.file, coordinate: value.coordinate || null, message: value.message });
  return value;
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function coordinate(value) {
  return isObject(value) && typeof value.groupId === "string" && value.groupId.trim()
    && typeof value.artifactId === "string" && value.artifactId.trim()
    ? `${value.groupId.trim()}:${value.artifactId.trim()}`
    : null;
}

function validatePolicy(raw) {
  const diagnostics = [];
  const policy = {
    schemaVersion: 1,
    severity: "error",
    enforceConvergence: false,
    forbidDynamicVersions: false,
    forbidSnapshots: false,
    requiredBoms: [],
    forbiddenCoordinates: [],
    allowedRepositories: [],
  };
  if (!isObject(raw)) return { ok: false, policy, diagnostics: [finding("SC_CONFIG", "供应链策略根节点必须是对象")] };
  const allowed = new Set(["schemaVersion", "severity", "enforceConvergence", "forbidDynamicVersions", "forbidSnapshots", "requiredBoms", "forbiddenCoordinates", "allowedRepositories"]);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) diagnostics.push(finding("SC_CONFIG", `不支持配置项 ${key}`));
  if (raw.schemaVersion !== 1) diagnostics.push(finding("SC_CONFIG", "只支持 schemaVersion=1"));
  if (raw.severity !== undefined) {
    if (!["error", "warn", "info"].includes(raw.severity)) diagnostics.push(finding("SC_CONFIG", "severity 只允许 error/warn/info"));
    else policy.severity = raw.severity;
  }
  for (const key of ["enforceConvergence", "forbidDynamicVersions", "forbidSnapshots"]) {
    if (raw[key] !== undefined && typeof raw[key] !== "boolean") diagnostics.push(finding("SC_CONFIG", `${key} 必须是 boolean`));
    else if (raw[key] !== undefined) policy[key] = raw[key];
  }
  for (const key of ["requiredBoms", "forbiddenCoordinates"]) {
    if (raw[key] === undefined) continue;
    if (!Array.isArray(raw[key])) {
      diagnostics.push(finding("SC_CONFIG", `${key} 必须是坐标数组`));
      continue;
    }
    for (const [index, item] of raw[key].entries()) {
      const ga = coordinate(item);
      if (!ga) diagnostics.push(finding("SC_CONFIG", `${key}[${index}] 必须提供 groupId/artifactId`));
      else policy[key].push({ groupId: item.groupId.trim(), artifactId: item.artifactId.trim(), coordinate: ga });
    }
  }
  if (raw.allowedRepositories !== undefined) {
    if (!Array.isArray(raw.allowedRepositories) || raw.allowedRepositories.some((item) => typeof item !== "string" || !item.trim())) diagnostics.push(finding("SC_CONFIG", "allowedRepositories 必须是 URL 前缀字符串数组"));
    else policy.allowedRepositories = [...new Set(raw.allowedRepositories.map((item) => item.trim()))];
  }
  return { ok: diagnostics.length === 0, policy, diagnostics };
}

function loadPolicy(projectRootInput) {
  const projectRoot = path.resolve(projectRootInput);
  const file = path.join(projectRoot, CONFIG_REL);
  if (!fs.existsSync(file)) return { ok: true, configured: false, policy: validatePolicy({ schemaVersion: 1 }).policy, diagnostics: [] };
  try {
    return { configured: true, ...validatePolicy(JSON.parse(fs.readFileSync(file, "utf8"))) };
  } catch (error) {
    return { ok: false, configured: true, policy: validatePolicy({ schemaVersion: 1 }).policy, diagnostics: [finding("SC_CONFIG", `JSON 无法解析：${error.message}`)] };
  }
}

function listPoms(root, output = []) {
  if (!fs.existsSync(root)) return output;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const current = path.join(root, entry.name);
    if (entry.isDirectory()) listPoms(current, output);
    else if (entry.isFile() && entry.name === "pom.xml") output.push(current);
  }
  return output;
}

function tag(block, name) {
  const match = block.match(new RegExp(`<${name}>\\s*([^<]+?)\\s*</${name}>`));
  return match ? match[1].trim() : null;
}

function propertiesOf(content) {
  const properties = {};
  const match = content.match(/<properties>([\s\S]*?)<\/properties>/);
  if (!match) return properties;
  for (const item of match[1].matchAll(/<([A-Za-z0-9_.-]+)>\s*([^<]+?)\s*<\/\1>/g)) properties[item[1]] = item[2].trim();
  return properties;
}

function resolveVersion(value, properties) {
  if (!value) return null;
  const match = value.match(/^\$\{([^}]+)}$/);
  return match && properties[match[1]] ? properties[match[1]] : value;
}

function parsePom(projectRoot, file) {
  const content = fs.readFileSync(file, "utf8");
  const rel = normalizeRel(path.relative(projectRoot, file));
  const properties = propertiesOf(content);
  const managedRanges = [...content.matchAll(/<dependencyManagement>([\s\S]*?)<\/dependencyManagement>/g)].map((item) => [item.index, item.index + item[0].length]);
  const dependencies = [];
  for (const match of content.matchAll(/<dependency>\s*([\s\S]*?)<\/dependency>/g)) {
    const groupId = tag(match[1], "groupId");
    const artifactId = tag(match[1], "artifactId");
    if (!groupId || !artifactId) continue;
    const rawVersion = tag(match[1], "version");
    const type = tag(match[1], "type") || "jar";
    const scope = tag(match[1], "scope") || "compile";
    const managed = managedRanges.some(([start, end]) => match.index >= start && match.index < end);
    dependencies.push({
      coordinate: `${groupId}:${artifactId}`,
      groupId,
      artifactId,
      version: resolveVersion(rawVersion, properties),
      rawVersion,
      type,
      scope,
      managed,
      bom: managed && type === "pom" && scope === "import",
      file: rel,
    });
  }
  const repositories = [...content.matchAll(/<repository>\s*([\s\S]*?)<\/repository>/g)]
    .map((item) => ({ id: tag(item[1], "id"), url: tag(item[1], "url"), file: rel }))
    .filter((item) => item.url);
  return { file: rel, dependencies, repositories };
}

function inspectSupplyChain(projectRootInput, options = {}) {
  const projectRoot = path.resolve(projectRootInput);
  const loaded = loadPolicy(projectRoot);
  const affected = !Array.isArray(options.changedFiles)
    || options.changedFiles.some((item) => normalizeRel(item).endsWith("pom.xml") || normalizeRel(item) === CONFIG_REL);
  if (!affected) return { schemaVersion: 1, ok: true, configured: loaded.configured, state: "not-affected", findings: [], inventory: { poms: 0, dependencies: 0, repositories: 0 }, summary: { errors: 0, warnings: 0 } };
  if (!loaded.ok) return { schemaVersion: 1, ok: false, configured: true, state: "invalid-config", findings: loaded.diagnostics, inventory: { poms: 0, dependencies: 0, repositories: 0 }, summary: { errors: loaded.diagnostics.length, warnings: 0 } };
  const poms = listPoms(projectRoot).map((file) => parsePom(projectRoot, file));
  const dependencies = poms.flatMap((item) => item.dependencies);
  const repositories = poms.flatMap((item) => item.repositories);
  const findings = [];
  const severity = loaded.policy.severity;
  if (loaded.configured && loaded.policy.enforceConvergence) {
    const versions = new Map();
    for (const item of dependencies.filter((value) => value.version && !value.managed)) {
      if (!versions.has(item.coordinate)) versions.set(item.coordinate, new Map());
      const group = versions.get(item.coordinate);
      if (!group.has(item.version)) group.set(item.version, []);
      group.get(item.version).push(item.file);
    }
    for (const [ga, group] of versions) if (group.size > 1) findings.push(finding("SC_CONVERGENCE", `${ga} 出现多个显式版本：${[...group.keys()].join(", ")}`, { severity, coordinate: ga, file: [...group.values()][0][0] }));
  }
  if (loaded.configured && loaded.policy.forbidDynamicVersions) {
    for (const item of dependencies.filter((value) => value.version && /^(?:LATEST|RELEASE)$/i.test(value.version) || /[\[\](,+]/.test(value.version || ""))) {
      findings.push(finding("SC_DYNAMIC_VERSION", `${item.coordinate} 使用动态/范围版本 ${item.version}`, { severity, coordinate: item.coordinate, file: item.file }));
    }
  }
  if (loaded.configured && loaded.policy.forbidSnapshots) {
    for (const item of dependencies.filter((value) => /-SNAPSHOT$/i.test(value.version || ""))) findings.push(finding("SC_SNAPSHOT", `${item.coordinate} 使用 SNAPSHOT ${item.version}`, { severity, coordinate: item.coordinate, file: item.file }));
  }
  if (loaded.configured) {
    const allCoordinates = new Set(dependencies.map((item) => item.coordinate));
    const boms = new Set(dependencies.filter((item) => item.bom).map((item) => item.coordinate));
    for (const item of loaded.policy.requiredBoms) if (!boms.has(item.coordinate)) findings.push(finding("SC_REQUIRED_BOM", `缺少平台要求的 BOM ${item.coordinate}`, { severity, coordinate: item.coordinate }));
    for (const item of loaded.policy.forbiddenCoordinates) if (allCoordinates.has(item.coordinate)) {
      const evidence = dependencies.find((value) => value.coordinate === item.coordinate);
      findings.push(finding("SC_FORBIDDEN_DEPENDENCY", `命中禁用依赖 ${item.coordinate}`, { severity, coordinate: item.coordinate, file: evidence.file }));
    }
    if (loaded.policy.allowedRepositories.length > 0) for (const repository of repositories) {
      if (!loaded.policy.allowedRepositories.some((prefix) => repository.url.startsWith(prefix))) findings.push(finding("SC_REPOSITORY", `仓库地址不在允许前缀内：${repository.url}`, { severity, file: repository.file }));
    }
  }
  const errors = findings.filter((item) => item.severity === "error").length;
  const warnings = findings.filter((item) => item.severity === "warn").length;
  return {
    schemaVersion: 1,
    ok: errors === 0,
    configured: loaded.configured,
    state: loaded.configured ? (findings.length > 0 ? "issues" : "passed") : "inventory-only",
    findings,
    inventory: {
      poms: poms.length,
      dependencies: dependencies.length,
      uniqueCoordinates: new Set(dependencies.map((item) => item.coordinate)).size,
      boms: dependencies.filter((item) => item.bom).map((item) => ({ coordinate: item.coordinate, version: item.version, file: item.file })),
      repositories: repositories.length,
    },
    summary: { errors, warnings },
  };
}

module.exports = {
  CONFIG_REL,
  inspectSupplyChain,
  loadPolicy,
  parsePom,
  validatePolicy,
};
