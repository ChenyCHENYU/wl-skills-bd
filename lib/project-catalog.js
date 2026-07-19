"use strict";

const fs = require("fs");
const path = require("path");
const collaboration = require("./collaboration");
const { loadContract } = require("./contract");
const { hashJson, stableJson } = require("./deterministic");
const { hashBuffer, hashFile, normalizeRel, resolveWithin, writeTextAtomic } = require("./manifest");
const { guardResult } = require("./write-guard");

const DEFAULT_CONFIG_REL = ".wl-skills-bd/catalog.config.json";
const CATALOG_ROOT = ".wl-skills-bd/catalog";
const SOURCE_EXTENSIONS = new Set([".java", ".xml", ".sql", ".yml", ".yaml", ".properties", ".json"]);
const SKIP_DIRECTORIES = new Set([".git", ".state", "node_modules", "target", "dist", "build"]);
const MODULE_RE = /^[a-z][a-zA-Z0-9]*$/;
const PROJECT_RE = /^[a-z][a-z0-9-]{2,63}$/;
const DEFAULT_COMMIT_TYPES = ["feat", "fix", "perf", "refactor", "docs", "test", "style", "build", "ci", "chore", "revert"];

function error(pathValue, message) {
  return { path: pathValue, message };
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function loadCatalogConfig(projectRootInput, configRel = DEFAULT_CONFIG_REL) {
  const projectRoot = path.resolve(projectRootInput || process.cwd());
  let file;
  try {
    file = resolveWithin(projectRoot, configRel);
  } catch (cause) {
    return { ok: false, projectRoot, configRel, errors: [error("$.config", cause.message)] };
  }
  if (!fs.existsSync(file)) {
    return {
      ok: false,
      projectRoot,
      configRel: normalizeRel(configRel),
      file,
      errors: [error("$.config", `缺少 ${normalizeRel(configRel)}；从 .wl-skills-bd/catalog.config.example.json 复制并按模块填写`) ],
    };
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (cause) {
    return { ok: false, projectRoot, configRel, file, errors: [error("$.config", `JSON 解析失败：${cause.message}`)] };
  }
  const errors = [];
  if (!raw || raw.schemaVersion !== 1) errors.push(error("$.schemaVersion", "必须为 1"));
  if (!raw.project || !PROJECT_RE.test(raw.project.id || "")) errors.push(error("$.project.id", "必须是小写稳定项目 ID"));
  if (!raw.project || typeof raw.project.name !== "string" || !raw.project.name.trim()) errors.push(error("$.project.name", "不能为空"));
  if (typeof raw.docsRoot !== "string" || !raw.docsRoot.trim()) errors.push(error("$.docsRoot", "不能为空"));
  try { resolveWithin(projectRoot, raw.docsRoot || ""); } catch (cause) { errors.push(error("$.docsRoot", cause.message)); }
  if (!raw.modules || typeof raw.modules !== "object" || Array.isArray(raw.modules) || Object.keys(raw.modules).length === 0) {
    errors.push(error("$.modules", "至少声明一个模块"));
  }
  const modules = {};
  for (const [moduleId, value] of Object.entries(raw.modules || {})) {
    const location = `$.modules.${moduleId}`;
    if (!MODULE_RE.test(moduleId)) errors.push(error(location, "模块 ID 必须为 lowerCamelCase"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(error(location, "必须为对象"));
      continue;
    }
    const contractRoots = Array.isArray(value.contractRoots) ? uniqueSorted(value.contractRoots) : [];
    const sourceRoots = Array.isArray(value.sourceRoots) ? uniqueSorted(value.sourceRoots) : [];
    const upstream = Array.isArray(value.upstream) ? uniqueSorted(value.upstream) : [];
    const downstream = Array.isArray(value.downstream) ? uniqueSorted(value.downstream) : [];
    const owners = Array.isArray(value.owners) ? uniqueSorted(value.owners) : [];
    if (typeof value.displayName !== "string" || !value.displayName.trim()) errors.push(error(`${location}.displayName`, "不能为空"));
    if (contractRoots.length === 0) errors.push(error(`${location}.contractRoots`, "至少声明一个契约根"));
    if (owners.length === 0) errors.push(error(`${location}.owners`, "至少声明一个负责人/团队"));
    for (const [key, roots] of [["contractRoots", contractRoots], ["sourceRoots", sourceRoots]]) {
      for (const rel of roots) {
        if (typeof rel !== "string") errors.push(error(`${location}.${key}`, "路径必须为字符串"));
        else try { resolveWithin(projectRoot, rel); } catch (cause) { errors.push(error(`${location}.${key}`, cause.message)); }
      }
    }
    for (const linked of [...upstream, ...downstream]) {
      if (linked === moduleId) errors.push(error(location, "模块不能依赖自身"));
      else if (!Object.prototype.hasOwnProperty.call(raw.modules || {}, linked)) errors.push(error(location, `关联模块不存在：${linked}`));
    }
    modules[moduleId] = {
      displayName: String(value.displayName || moduleId).trim(),
      contractRoots,
      sourceRoots,
      upstream,
      downstream,
      owners,
    };
  }
  const commit = raw.commit && typeof raw.commit === "object" ? raw.commit : {};
  const types = Array.isArray(commit.types) && commit.types.length > 0 ? uniqueSorted(commit.types) : DEFAULT_COMMIT_TYPES;
  if (types.some((type) => !/^[a-z][a-z0-9-]{1,15}$/.test(type))) errors.push(error("$.commit.types", "存在非法 type"));
  const normalized = {
    schemaVersion: 1,
    project: { id: raw.project && raw.project.id, name: raw.project && String(raw.project.name || "").trim() },
    docsRoot: normalizeRel(raw.docsRoot || "docs/backend"),
    commit: {
      types,
      requireDetailSeparator: commit.requireDetailSeparator !== false,
      maxHeaderLength: Number.isInteger(commit.maxHeaderLength) ? commit.maxHeaderLength : 100,
    },
    modules: Object.fromEntries(Object.keys(modules).sort().map((id) => [id, modules[id]])),
  };
  if (normalized.commit.maxHeaderLength < 40 || normalized.commit.maxHeaderLength > 200) errors.push(error("$.commit.maxHeaderLength", "必须在 40~200"));
  return {
    ok: errors.length === 0,
    projectRoot,
    configRel: normalizeRel(configRel),
    file,
    config: normalized,
    configHash: hashJson(normalized),
    errors,
  };
}

function listFiles(projectRoot, roots, predicate) {
  const collected = new Set();
  const visit = (absolute) => {
    if (!fs.existsSync(absolute)) return;
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) return;
    if (stat.isFile()) {
      if (!predicate || predicate(absolute)) collected.add(normalizeRel(path.relative(projectRoot, absolute)));
      return;
    }
    if (!stat.isDirectory()) return;
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
      visit(path.join(absolute, entry.name));
    }
  };
  for (const rel of roots) visit(resolveWithin(projectRoot, rel));
  return [...collected].sort();
}

function moduleSourceEvidence(projectRoot, moduleConfig) {
  const contractFiles = listFiles(projectRoot, moduleConfig.contractRoots, (file) => file.toLowerCase().endsWith(".json"));
  const sourceFiles = listFiles(projectRoot, moduleConfig.sourceRoots, (file) => SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase()));
  const files = uniqueSorted([...contractFiles, ...sourceFiles]);
  const evidence = files.map((rel) => {
    const file = resolveWithin(projectRoot, rel);
    return { rel, hash: hashFile(file), bytes: fs.statSync(file).size, kind: contractFiles.includes(rel) ? "contract" : "source" };
  });
  return { contractFiles, sourceFiles, evidence, sourceHash: hashJson(evidence) };
}

function serviceNames(contract) {
  const base = `${contract.rootPackage}.${contract.module}`;
  return {
    service: `${base}.service.${contract.entity.name}Service`,
    controller: `${base}.controller.${contract.entity.name}Controller`,
    mapper: `${base}.mapper.${contract.entity.name}Mapper`,
  };
}

function buildModuleCatalog(projectRoot, config, moduleId) {
  const moduleConfig = config.modules[moduleId];
  if (!moduleConfig) return { ok: false, errors: [error("$.module", `未知模块：${moduleId}`)] };
  const sources = moduleSourceEvidence(projectRoot, moduleConfig);
  const resources = [];
  const contractErrors = [];
  for (const contractFile of sources.contractFiles) {
    const loaded = loadContract(resolveWithin(projectRoot, contractFile), { projectRoot });
    if (!loaded.ok) {
      contractErrors.push(...loaded.errors.map((item) => ({ ...item, file: contractFile })));
      continue;
    }
    const contract = loaded.contract;
    if (contract.module !== moduleId) {
      contractErrors.push({ file: contractFile, path: "$.module", message: `契约模块 ${contract.module} 与 Catalog 模块 ${moduleId} 不一致` });
      continue;
    }
    const manifest = collaboration.buildManifest(contract, loaded.profile, loaded.deliveryProfile);
    const names = serviceNames(contract);
    const operations = Object.entries(manifest.operations).map(([name, operation]) => ({
      name,
      method: operation.method,
      internalPath: operation.internalPath,
      externalPath: operation.externalPath,
      permission: operation.permission,
      requestModel: operation.requestModel,
      responseModel: operation.responseModel,
    })).sort((left, right) => left.name.localeCompare(right.name));
    resources.push({
      contractId: contract.contractId,
      contractFile,
      entity: contract.entity.name,
      description: contract.entity.description,
      rootPackage: contract.rootPackage,
      names,
      operations,
      database: {
        engine: contract.database,
        cluster: contract.dbCluster || "unassigned",
        table: contract.entity.table,
        identity: `${contract.dbCluster || "unassigned"}|${contract.database}|${contract.entity.table}`,
        migrationLocation: normalizeRel(contract.output.migration),
        migrationVersion: contract.alter ? contract.alter.version : contract.migration.version,
        phase: contract.alter ? contract.alter.phase : "create",
      },
      relations: (contract.relations || []).map((relation) => ({
        name: relation.name,
        type: relation.type,
        targetContractId: relation.detailContractId,
        targetEntity: relation.detailEntity,
        joinColumn: relation.joinColumn,
      })),
      completion: manifest.completion.contractStatus,
    });
  }
  resources.sort((left, right) => left.contractId.localeCompare(right.contractId));
  const services = resources.map((resource) => ({ contractId: resource.contractId, ...resource.names }));
  const apis = resources.flatMap((resource) => resource.operations.map((operation) => ({ contractId: resource.contractId, ...operation })))
    .sort((left, right) => `${left.method} ${left.externalPath}`.localeCompare(`${right.method} ${right.externalPath}`));
  const databases = resources.map((resource) => ({ contractId: resource.contractId, ...resource.database }));
  const relations = resources.flatMap((resource) => resource.relations.map((relation) => ({ fromContractId: resource.contractId, ...relation })));
  const base = {
    schemaVersion: 1,
    kind: "wl-backend-module-catalog",
    project: config.project,
    module: { id: moduleId, displayName: moduleConfig.displayName, owners: moduleConfig.owners },
    scope: {
      mode: "module",
      scannedModule: moduleId,
      scannedRoots: uniqueSorted([...moduleConfig.contractRoots, ...moduleConfig.sourceRoots]),
      linkedOneHop: uniqueSorted([...moduleConfig.upstream, ...moduleConfig.downstream]),
    },
    resources,
    services,
    apis,
    databases,
    relations,
    dependencies: { upstream: moduleConfig.upstream, downstream: moduleConfig.downstream },
    diagnostics: { errors: contractErrors, warnings: [] },
    sourceEvidence: sources.evidence,
    sourceHash: sources.sourceHash,
  };
  return { ok: contractErrors.length === 0, catalog: { ...base, catalogHash: hashJson(base) }, errors: contractErrors };
}

function moduleCatalogRel(moduleId) {
  return `${CATALOG_ROOT}/modules/${moduleId}.json`;
}

function readModuleCatalog(projectRoot, moduleId) {
  const rel = moduleCatalogRel(moduleId);
  const file = resolveWithin(projectRoot, rel);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && parsed.kind === "wl-backend-module-catalog" ? parsed : null;
  } catch { return null; }
}

function duplicateDiagnostics(catalogs) {
  const indexes = new Map();
  const errors = [];
  const add = (kind, key, moduleId, contractId, detail) => {
    if (!key) return;
    const identity = `${kind}:${key}`;
    if (!indexes.has(identity)) indexes.set(identity, []);
    indexes.get(identity).push({ module: moduleId, contractId, detail });
  };
  for (const [moduleId, catalog] of Object.entries(catalogs)) {
    for (const resource of catalog.resources || []) {
      add("contract", resource.contractId, moduleId, resource.contractId, resource.contractFile);
      add("service", resource.names && resource.names.service, moduleId, resource.contractId, resource.names && resource.names.service);
      add("controller", resource.names && resource.names.controller, moduleId, resource.contractId, resource.names && resource.names.controller);
      add("mapper", resource.names && resource.names.mapper, moduleId, resource.contractId, resource.names && resource.names.mapper);
      add("table-writer", resource.database && resource.database.identity, moduleId, resource.contractId, resource.database && resource.database.table);
      if (resource.database) add("migration", `${resource.database.migrationLocation}|${resource.database.migrationVersion}`, moduleId, resource.contractId, resource.database.phase);
      for (const operation of resource.operations || []) {
        add("api", `${operation.method} ${operation.externalPath}`, moduleId, resource.contractId, operation.name);
        add("permission", operation.permission, moduleId, resource.contractId, operation.name);
      }
    }
  }
  for (const [identity, owners] of indexes.entries()) {
    if (owners.length < 2) continue;
    errors.push({ code: "CAT_DUPLICATE", key: identity, message: `全局唯一键重复：${identity}`, owners });
  }
  return { errors: errors.sort((left, right) => left.key.localeCompare(right.key)), warnings: [] };
}

function relationshipList(config) {
  const result = [];
  const seen = new Set();
  const add = (from, to, type) => {
    const key = `${from}|${to}|${type}`;
    if (!seen.has(key)) { seen.add(key); result.push({ from, to, type }); }
  };
  for (const [moduleId, moduleConfig] of Object.entries(config.modules)) {
    for (const upstream of moduleConfig.upstream) add(moduleId, upstream, "depends-on");
    for (const downstream of moduleConfig.downstream) add(downstream, moduleId, "depends-on");
  }
  return result.sort((left, right) => `${left.from}|${left.to}`.localeCompare(`${right.from}|${right.to}`));
}

function projectCatalog(config, catalogs, diagnostics) {
  const modules = Object.keys(config.modules).sort().map((moduleId) => {
    const catalog = catalogs[moduleId];
    return {
      id: moduleId,
      displayName: config.modules[moduleId].displayName,
      owners: config.modules[moduleId].owners,
      status: catalog ? "indexed" : "missing",
      catalogHash: catalog ? catalog.catalogHash : null,
      stats: catalog ? {
        resources: catalog.resources.length,
        services: catalog.services.length,
        apis: catalog.apis.length,
        databases: catalog.databases.length,
      } : { resources: 0, services: 0, apis: 0, databases: 0 },
    };
  });
  const base = {
    schemaVersion: 1,
    kind: "wl-backend-project-catalog",
    project: config.project,
    modules,
    relationships: relationshipList(config),
    stats: {
      modules: modules.length,
      indexedModules: modules.filter((item) => item.status === "indexed").length,
      resources: modules.reduce((sum, item) => sum + item.stats.resources, 0),
      services: modules.reduce((sum, item) => sum + item.stats.services, 0),
      apis: modules.reduce((sum, item) => sum + item.stats.apis, 0),
      databases: modules.reduce((sum, item) => sum + item.stats.databases, 0),
    },
    diagnostics,
  };
  return { ...base, catalogHash: hashJson(base) };
}

function header(kind, purpose, scope, source, catalogHash) {
  return [
    "<!--",
    "wl-skills-bd-generated:",
    `  kind: ${kind}`,
    `  purpose: ${purpose}`,
    "  audience: human-and-ai",
    `  scope: ${scope}`,
    `  source: ${source}`,
    `  catalogHash: ${catalogHash}`,
    "  editable: false",
    "  refresh: wl-skills-bd catalog plan/apply",
    "-->",
  ].join("\n");
}

function cell(value) {
  return String(value === null || value === undefined || value === "" ? "-" : value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function moduleMarkdown(catalog) {
  const links = uniqueSorted([...catalog.dependencies.upstream, ...catalog.dependencies.downstream]);
  const lines = [
    header("module-catalog", "说明本模块拥有的服务、接口、数据库对象及一跳上下游；生成前 AI 以此为模块事实入口", `module:${catalog.module.id}; one-hop:${links.join(",") || "none"}`, moduleCatalogRel(catalog.module.id), catalog.catalogHash),
    "",
    `# ${catalog.module.displayName}（${catalog.module.id}）后端目录`,
    "",
    "> 默认只扫描本模块源码和契约；上下游信息读取已生成快照，不重复扫描其他模块。本文自动生成，请修改契约或 catalog.config.json 后重新生成。",
    "",
    "## 概览",
    "",
    `- 负责人：${catalog.module.owners.join("、")}`,
    `- 资源：${catalog.resources.length}`,
    `- 服务：${catalog.services.length}`,
    `- 接口：${catalog.apis.length}`,
    `- 数据对象：${catalog.databases.length}`,
    `- 上游：${catalog.dependencies.upstream.join("、") || "无"}`,
    `- 下游：${catalog.dependencies.downstream.join("、") || "无"}`,
    "",
    "## 资源与服务",
    "",
    "| contractId | 说明 | Entity | Service | 状态 |",
    "|---|---|---|---|---|",
    ...catalog.resources.map((resource) => `| ${cell(resource.contractId)} | ${cell(resource.description)} | ${cell(resource.entity)} | ${cell(resource.names.service)} | ${cell(resource.completion)} |`),
    "",
    "## 接口",
    "",
    "| contractId | 操作 | Method | 外部路径 | 权限码 |",
    "|---|---|---|---|---|",
    ...catalog.apis.map((api) => `| ${cell(api.contractId)} | ${cell(api.name)} | ${cell(api.method)} | ${cell(api.externalPath)} | ${cell(api.permission)} |`),
    "",
    "## 数据库",
    "",
    "| contractId | 集群 | 引擎 | 表 | Flyway | 阶段 |",
    "|---|---|---|---|---|---|",
    ...catalog.databases.map((db) => `| ${cell(db.contractId)} | ${cell(db.cluster)} | ${cell(db.engine)} | ${cell(db.table)} | ${cell(db.migrationVersion)} | ${cell(db.phase)} |`),
    "",
    "## 关系",
    "",
    "| 来源契约 | 关系 | 目标契约 | 关联列 |",
    "|---|---|---|---|",
    ...catalog.relations.map((relation) => `| ${cell(relation.fromContractId)} | ${cell(relation.type)} | ${cell(relation.targetContractId)} | ${cell(relation.joinColumn)} |`),
    "",
    "## 诊断",
    "",
    ...(catalog.diagnostics.errors.length === 0 && catalog.diagnostics.warnings.length === 0
      ? ["- 无模块级错误或警告。"]
      : [
        ...catalog.diagnostics.errors.map((item) => `- ❌ ${cell(item.code || item.path)}：${cell(item.message)}`),
        ...catalog.diagnostics.warnings.map((item) => `- ⚠️ ${cell(item.code || item.path)}：${cell(item.message)}`),
      ]),
    "",
  ];
  return lines.join("\n");
}

function projectMarkdown(catalog, docsRoot) {
  return [
    header("project-catalog-index", "汇总项目模块统计与依赖关系；进入具体开发前必须跳转到目标模块文档", "project-summary; no-source-rescan", `${CATALOG_ROOT}/project-catalog.json`, catalog.catalogHash),
    "",
    `# ${catalog.project.name}后端工程目录`,
    "",
    "> 本页只汇总各模块快照，不扫描模块源码。开发某个模块时，以对应模块文档为主，只加载一跳上下游。",
    "",
    "## 统计",
    "",
    `- 模块：${catalog.stats.modules}（已索引 ${catalog.stats.indexedModules}）`,
    `- 资源：${catalog.stats.resources}`,
    `- 服务：${catalog.stats.services}`,
    `- 接口：${catalog.stats.apis}`,
    `- 数据对象：${catalog.stats.databases}`,
    "",
    "## 模块",
    "",
    "| 模块 | 负责人 | 状态 | 资源 | 服务 | 接口 | 数据对象 |",
    "|---|---|---|---:|---:|---:|---:|",
    ...catalog.modules.map((module) => {
      const label = module.status === "indexed" ? `[${cell(module.displayName)}](modules/${module.id}.md)` : cell(module.displayName);
      return `| ${label} | ${cell(module.owners.join("、"))} | ${cell(module.status)} | ${module.stats.resources} | ${module.stats.services} | ${module.stats.apis} | ${module.stats.databases} |`;
    }),
    "",
    "## 一跳依赖",
    "",
    "| 调用方 | 依赖模块 | 类型 |",
    "|---|---|---|",
    ...catalog.relationships.map((edge) => `| ${cell(edge.from)} | ${cell(edge.to)} | ${cell(edge.type)} |`),
    "",
    "## 全局冲突",
    "",
    ...(catalog.diagnostics.errors.length === 0 ? ["- 无硬冲突。"] : catalog.diagnostics.errors.map((item) => `- ❌ ${cell(item.message)}：${cell(item.key)}`)),
    "",
    `> 模块文档根：\`${docsRoot}/modules\`。`,
    "",
  ].join("\n");
}

function commitMarkdown(config, catalogHash) {
  const scopes = Object.keys(config.modules).sort();
  return [
    header("commit-convention", "统一团队提交信息格式；本地 Hook 提前反馈，CI commit check 才是权威门禁", `project:${config.project.id}`, DEFAULT_CONFIG_REL, catalogHash),
    "",
    "# 后端提交信息规范",
    "",
    "## 唯一格式",
    "",
    "```text",
    "type(scope): 功能点-具体内容",
    "```",
    "",
    `- type：${config.commit.types.map((type) => `\`${type}\``).join(" / ")}`,
    `- scope：必须是模块 ID：${scopes.map((scope) => `\`${scope}\``).join(" / ")}`,
    `- 标题长度：不超过 ${config.commit.maxHeaderLength} 个字符。`,
    `- 功能点与具体内容：${config.commit.requireDetailSeparator ? "必须使用 `-` 分隔" : "建议使用 `-` 分隔"}。`,
    "",
    "```text",
    `feat(${scopes[0]}): 核心功能-新增可用能力`,
    `fix(${scopes[0]}): 核心功能-修复边界校验`,
    "```",
    "",
    "## 卡控层次",
    "",
    "1. `.githooks/commit-msg` 调用 bd 校验器，提供本地即时反馈；可被 `--no-verify` 绕过。",
    "2. CI 执行 `wl-skills-bd commit check --range <base>..<head>`，作为不可跳过的权威门。",
    "3. `wl-skills-bd commit doctor` 检查 Hook 路径和 Catalog scope 来源。",
    "",
  ].join("\n");
}

function outputAction(projectRoot, rel, content) {
  const destination = resolveWithin(projectRoot, rel);
  const contentHash = hashBuffer(Buffer.from(content, "utf8"));
  const currentHash = fs.existsSync(destination) ? hashFile(destination) : null;
  return { rel: normalizeRel(rel), destination, content, contentHash, currentHash, action: currentHash === null ? "add" : (currentHash === contentHash ? "unchanged" : "update") };
}

function buildCatalogPlan(projectRootInput, options = {}) {
  const projectRoot = path.resolve(projectRootInput || process.cwd());
  const loaded = loadCatalogConfig(projectRoot, options.configRel);
  if (!loaded.ok) return { ok: false, projectRoot, errors: loaded.errors, actions: [] };
  const { config } = loaded;
  const allModules = Object.keys(config.modules).sort();
  if (!options.full && !options.module) return { ok: false, projectRoot, errors: [error("$.module", "默认禁止隐式全量扫描；请指定 --module，CI 才使用 --full")], actions: [] };
  if (options.module && !config.modules[options.module]) return { ok: false, projectRoot, errors: [error("$.module", `未知模块：${options.module}`)], actions: [] };
  const scannedModules = options.full ? allModules : [options.module];
  const catalogs = {};
  const buildErrors = [];
  for (const moduleId of allModules) {
    if (scannedModules.includes(moduleId)) {
      const built = buildModuleCatalog(projectRoot, config, moduleId);
      if (built.catalog) catalogs[moduleId] = built.catalog;
      buildErrors.push(...(built.errors || []));
    } else {
      const existing = readModuleCatalog(projectRoot, moduleId);
      if (existing) catalogs[moduleId] = existing;
    }
  }
  const duplicates = duplicateDiagnostics(catalogs);
  for (const moduleId of scannedModules) {
    const catalog = catalogs[moduleId];
    if (!catalog) continue;
    const relevant = duplicates.errors.filter((item) => item.owners.some((owner) => owner.module === moduleId));
    const base = { ...catalog, diagnostics: { errors: [...catalog.diagnostics.errors, ...relevant], warnings: catalog.diagnostics.warnings } };
    delete base.catalogHash;
    catalogs[moduleId] = { ...base, catalogHash: hashJson(base) };
  }
  const missingModules = allModules.filter((moduleId) => !catalogs[moduleId]);
  const diagnostics = {
    errors: [...duplicates.errors, ...buildErrors],
    warnings: missingModules.map((moduleId) => ({ code: "CAT_SNAPSHOT_MISSING", module: moduleId, message: `模块 ${moduleId} 尚无快照；仅在构建该模块或 --full 时扫描` })),
  };
  const project = projectCatalog(config, catalogs, diagnostics);
  const actions = [];
  for (const moduleId of scannedModules) {
    const catalog = catalogs[moduleId];
    if (!catalog) continue;
    actions.push(outputAction(projectRoot, moduleCatalogRel(moduleId), stableJson(catalog)));
    actions.push(outputAction(projectRoot, `${config.docsRoot}/modules/${moduleId}.md`, moduleMarkdown(catalog)));
  }
  actions.push(outputAction(projectRoot, `${CATALOG_ROOT}/project-catalog.json`, stableJson(project)));
  actions.push(outputAction(projectRoot, `${config.docsRoot}/INDEX.md`, projectMarkdown(project, config.docsRoot)));
  actions.push(outputAction(projectRoot, `${config.docsRoot}/COMMIT_CONVENTION.md`, commitMarkdown(config, project.catalogHash)));
  actions.sort((left, right) => left.rel.localeCompare(right.rel));
  const planHash = hashJson({
    schemaVersion: 1,
    configHash: loaded.configHash,
    mode: options.full ? "full" : "module",
    scannedModules,
    sourceHashes: Object.fromEntries(scannedModules.map((moduleId) => [moduleId, catalogs[moduleId] && catalogs[moduleId].sourceHash])),
    actions: actions.map((item) => ({ rel: item.rel, action: item.action, currentHash: item.currentHash, contentHash: item.contentHash })),
  });
  const linkedModules = options.full ? [] : uniqueSorted([...config.modules[options.module].upstream, ...config.modules[options.module].downstream]);
  return {
    ok: true,
    projectRoot,
    configRel: loaded.configRel,
    config,
    configHash: loaded.configHash,
    mode: options.full ? "full" : "module",
    scannedModules,
    reusedModules: allModules.filter((moduleId) => !scannedModules.includes(moduleId) && catalogs[moduleId]),
    linkedModules,
    missingModules,
    catalogs,
    projectCatalog: project,
    diagnostics,
    blocking: diagnostics.errors.length > 0,
    actions,
    summary: actions.reduce((acc, item) => { acc[item.action] = (acc[item.action] || 0) + 1; return acc; }, {}),
    planHash,
  };
}

function publicCatalogPlan(plan) {
  if (!plan.ok) return plan;
  return {
    ok: true,
    state: "previewed",
    mode: plan.mode,
    scannedModules: plan.scannedModules,
    reusedModules: plan.reusedModules,
    linkedModules: plan.linkedModules,
    missingModules: plan.missingModules,
    diagnostics: plan.diagnostics,
    blocking: plan.blocking,
    summary: plan.summary,
    planHash: plan.planHash,
    project: plan.projectCatalog,
    actions: plan.actions.map((item) => ({ rel: item.rel, action: item.action, currentHash: item.currentHash, contentHash: item.contentHash })),
  };
}

function applyCatalogPlan(plan, options = {}) {
  if (!plan.ok) return { ok: false, errors: plan.errors || [], applied: [] };
  if (options.confirm !== true) return { ok: false, reason: "confirm-required", applied: [] };
  if (!options.planHash || options.planHash !== plan.planHash) return { ok: false, reason: "plan-hash-mismatch", expectedPlanHash: plan.planHash, applied: [] };
  if (plan.blocking) return { ok: false, reason: "catalog-conflicts", diagnostics: plan.diagnostics, applied: [] };
  const guarded = guardResult(plan.projectRoot, options);
  if (guarded) return guarded;
  const fresh = buildCatalogPlan(plan.projectRoot, { configRel: plan.configRel, module: plan.mode === "module" ? plan.scannedModules[0] : undefined, full: plan.mode === "full" });
  if (!fresh.ok || fresh.planHash !== plan.planHash) return { ok: false, reason: "plan-changed", expectedPlanHash: fresh.planHash, errors: fresh.errors, applied: [] };
  const changed = fresh.actions.filter((item) => item.action !== "unchanged");
  const originals = new Map();
  const backupId = `${fresh.planHash.slice(0, 16)}`;
  try {
    for (const item of changed) {
      if (fs.existsSync(item.destination)) {
        const original = fs.readFileSync(item.destination);
        originals.set(item.rel, original);
        const backup = resolveWithin(fresh.projectRoot, `.wl-skills-bd/.state/catalog-backups/${backupId}/${item.rel}`);
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.writeFileSync(backup, original);
      } else originals.set(item.rel, null);
      writeTextAtomic(item.destination, item.content);
      if (hashFile(item.destination) !== item.contentHash) throw new Error(`${item.rel} 写后哈希不一致`);
    }
  } catch (cause) {
    const rollbackErrors = [];
    for (const item of [...changed].reverse()) {
      try {
        const original = originals.get(item.rel);
        if (original) writeTextAtomic(item.destination, original);
        else if (fs.existsSync(item.destination)) fs.unlinkSync(item.destination);
      } catch (rollbackCause) { rollbackErrors.push(`${item.rel}: ${rollbackCause.message}`); }
    }
    return { ok: false, reason: rollbackErrors.length ? "write-failed-rollback-failed" : "write-failed-rolled-back", message: cause.message, rollbackErrors, applied: [] };
  }
  return {
    ok: true,
    state: "applied",
    planHash: fresh.planHash,
    backupId: changed.some((item) => item.currentHash) ? backupId : null,
    scannedModules: fresh.scannedModules,
    reusedModules: fresh.reusedModules,
    linkedModules: fresh.linkedModules,
    projectCatalog: fresh.projectCatalog,
    applied: fresh.actions.map((item) => ({ rel: item.rel, result: item.action })),
  };
}

function checkModuleFreshness(projectRootInput, moduleId, options = {}) {
  const loaded = loadCatalogConfig(projectRootInput, options.configRel);
  if (!loaded.ok) return { ok: false, errors: loaded.errors };
  const moduleConfig = loaded.config.modules[moduleId];
  if (!moduleConfig) return { ok: false, errors: [error("$.module", `未知模块：${moduleId}`)] };
  const catalog = readModuleCatalog(loaded.projectRoot, moduleId);
  if (!catalog) return { ok: false, reason: "catalog-missing", module: moduleId };
  const sources = moduleSourceEvidence(loaded.projectRoot, moduleConfig);
  return {
    ok: sources.sourceHash === catalog.sourceHash,
    reason: sources.sourceHash === catalog.sourceHash ? null : "catalog-stale",
    module: moduleId,
    expectedSourceHash: catalog.sourceHash,
    currentSourceHash: sources.sourceHash,
    scannedModules: [moduleId],
    catalog,
    config: loaded.config,
  };
}

function preflightContract(projectRootInput, contract) {
  const configFile = path.join(path.resolve(projectRootInput), DEFAULT_CONFIG_REL);
  if (!fs.existsSync(configFile)) return { enabled: false, ok: true };
  const loaded = loadCatalogConfig(projectRootInput);
  if (!loaded.ok) return { enabled: true, ok: false, errors: loaded.errors };
  if (!loaded.config.modules[contract.module]) return { enabled: true, ok: false, errors: [error("$.module", `Catalog 未声明模块 ${contract.module}`)] };
  const freshness = checkModuleFreshness(projectRootInput, contract.module);
  if (!freshness.ok) return { enabled: true, ok: false, errors: [error("$.catalog", `模块 ${contract.module} Catalog 缺失或过期，请先执行 catalog plan/apply --module ${contract.module}`)], freshness };
  const linked = uniqueSorted([...loaded.config.modules[contract.module].upstream, ...loaded.config.modules[contract.module].downstream]);
  const linkedCatalogs = linked.map((moduleId) => readModuleCatalog(loaded.projectRoot, moduleId)).filter(Boolean);
  const explicitTargetIds = new Set((contract.relations || []).map((relation) => relation.detailContractId).filter(Boolean));
  const linkedSlices = linkedCatalogs.map((catalog) => {
    const resourceIds = new Set(explicitTargetIds);
    for (const relation of catalog.relations || []) {
      if (relation.targetContractId === contract.contractId) resourceIds.add(relation.fromContractId);
    }
    const slice = {
      module: catalog.module.id,
      resourceIds: [...resourceIds].filter((id) => (catalog.resources || []).some((resource) => resource.contractId === id)).sort(),
      resources: (catalog.resources || []).filter((resource) => resourceIds.has(resource.contractId)).map((resource) => ({
        contractId: resource.contractId,
        operations: resource.operations,
        database: resource.database,
      })),
      relations: (catalog.relations || []).filter((relation) => resourceIds.has(relation.fromContractId) || resourceIds.has(relation.targetContractId)),
    };
    return { module: catalog.module.id, catalogHash: catalog.catalogHash, contextSliceHash: hashJson(slice), resourceIds: slice.resourceIds };
  });
  return {
    enabled: true,
    ok: true,
    module: contract.module,
    scannedModules: [contract.module],
    linkedSnapshots: linkedSlices,
    contextHash: hashJson({ configHash: loaded.configHash, moduleCatalogHash: freshness.catalog.catalogHash, linkedSlices: linkedSlices.map((item) => ({ module: item.module, contextSliceHash: item.contextSliceHash })) }),
  };
}

module.exports = {
  CATALOG_ROOT,
  DEFAULT_CONFIG_REL,
  DEFAULT_COMMIT_TYPES,
  applyCatalogPlan,
  buildCatalogPlan,
  buildModuleCatalog,
  checkModuleFreshness,
  duplicateDiagnostics,
  loadCatalogConfig,
  moduleCatalogRel,
  moduleMarkdown,
  preflightContract,
  projectMarkdown,
  publicCatalogPlan,
  readModuleCatalog,
};
