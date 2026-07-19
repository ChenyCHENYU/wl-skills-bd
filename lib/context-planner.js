"use strict";

const fs = require("fs");
const path = require("path");
const { hashJson } = require("./deterministic");
const { hashFile, normalizeRel, resolveWithin } = require("./manifest");
const {
  checkModuleFreshness,
  loadCatalogConfig,
  moduleCatalogRel,
  readModuleCatalog,
} = require("./project-catalog");

const DEFAULT_MAX_FILES = 40;
const DEFAULT_MAX_BYTES = 512 * 1024;

function boundedInteger(value, fallback, minimum, maximum) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) return null;
  return parsed;
}

function tokenize(task, keywords) {
  const explicit = Array.isArray(keywords) ? keywords : String(keywords || "").split(",");
  const parts = [String(task || ""), ...explicit]
    .flatMap((value) => value.toLowerCase().split(/[\s,，。；;、:/\\|()[\]{}<>_-]+/u))
    .map((value) => value.trim())
    .filter((value) => value.length >= 2);
  return [...new Set(parts)].sort();
}

function fileCandidate(projectRoot, rel, extra) {
  const normalized = normalizeRel(rel);
  let file;
  try { file = resolveWithin(projectRoot, normalized); } catch { return null; }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return {
    rel: normalized,
    bytes: fs.statSync(file).size,
    hash: hashFile(file),
    ...extra,
  };
}

function scoreCandidate(candidate, tokens) {
  let score = candidate.baseScore || 0;
  const haystack = `${candidate.rel} ${candidate.contractId || ""} ${candidate.entity || ""} ${candidate.description || ""}`.toLowerCase();
  for (const token of tokens) {
    if (haystack.includes(token)) score += token.length >= 4 ? 12 : 7;
  }
  return score;
}

function pushUnique(map, candidate) {
  if (!candidate) return;
  const existing = map.get(candidate.rel);
  if (!existing || candidate.score > existing.score) map.set(candidate.rel, candidate);
}

function resourceLookup(catalog) {
  return new Map((catalog.resources || []).map((resource) => [resource.contractId, resource]));
}

function relevantLinkedContracts(targetCatalog, linkedCatalog, tokens) {
  const targetIds = new Set((targetCatalog.resources || []).map((resource) => resource.contractId));
  const linkedIds = new Set();
  for (const relation of targetCatalog.relations || []) {
    if (relation.targetContractId) linkedIds.add(relation.targetContractId);
  }
  for (const relation of linkedCatalog.relations || []) {
    if (targetIds.has(relation.targetContractId)) linkedIds.add(relation.fromContractId);
  }
  for (const resource of linkedCatalog.resources || []) {
    const haystack = [
      resource.contractId,
      resource.entity,
      resource.description,
      ...(resource.operations || []).flatMap((operation) => [operation.name, operation.externalPath, operation.permission]),
    ].join(" ").toLowerCase();
    if (tokens.some((token) => haystack.includes(token))) linkedIds.add(resource.contractId);
  }
  return linkedIds;
}

function snapshotSummary(catalog, role, relevantIds) {
  const resources = (catalog.resources || []).filter((resource) => relevantIds.has(resource.contractId));
  return {
    module: catalog.module.id,
    role,
    snapshot: moduleCatalogRel(catalog.module.id),
    catalogHash: catalog.catalogHash,
    selectionRule: "explicit-contract-relation-or-task-keyword",
    resources: resources.map((resource) => ({
      contractId: resource.contractId,
      entity: resource.entity,
      description: resource.description,
      operations: resource.operations,
      database: resource.database,
    })),
    relations: (catalog.relations || []).filter((relation) =>
      relevantIds.has(relation.fromContractId) || relevantIds.has(relation.targetContractId)),
  };
}

function buildContextPlan(projectRootInput, options = {}) {
  const projectRoot = path.resolve(projectRootInput || process.cwd());
  const loaded = loadCatalogConfig(projectRoot, options.configRel);
  if (!loaded.ok) return { ok: false, projectRoot, reason: "catalog-config-invalid", errors: loaded.errors };
  const moduleId = options.module;
  if (!moduleId || !loaded.config.modules[moduleId]) {
    return { ok: false, projectRoot, reason: "module-required", errors: [{ path: "$.module", message: "必须指定 catalog.config.json 中存在的当前模块" }] };
  }
  const maxHops = boundedInteger(options.maxHops, 1, 0, 1);
  const maxFiles = boundedInteger(options.maxFiles, DEFAULT_MAX_FILES, 3, 200);
  const maxBytes = boundedInteger(options.maxBytes, DEFAULT_MAX_BYTES, 16 * 1024, 10 * 1024 * 1024);
  if (maxHops === null || maxFiles === null || maxBytes === null) {
    return { ok: false, projectRoot, reason: "invalid-limit", errors: [{ path: "$.limits", message: "maxHops 仅允许 0~1；maxFiles 允许 3~200；maxBytes 允许 16KiB~10MiB" }] };
  }

  const freshness = checkModuleFreshness(projectRoot, moduleId, { configRel: options.configRel });
  if (!freshness.ok) {
    return {
      ok: false,
      projectRoot,
      module: moduleId,
      reason: freshness.reason || "module-catalog-stale",
      errors: freshness.errors || [{ path: "$.catalog", message: "当前模块目录缺失或已过期，请先仅刷新当前模块" }],
      refreshCommand: `wl-skills-bd catalog plan --module ${moduleId}`,
    };
  }

  const targetCatalog = readModuleCatalog(projectRoot, moduleId);
  const moduleConfig = loaded.config.modules[moduleId];
  const tokens = tokenize(options.task, options.keywords);
  const links = maxHops === 0 ? [] : [...new Set([...moduleConfig.upstream, ...moduleConfig.downstream])].sort();
  const linkedSnapshots = [];
  const missingSnapshots = [];
  for (const linkedId of links) {
    const catalog = readModuleCatalog(projectRoot, linkedId);
    if (!catalog) {
      missingSnapshots.push(linkedId);
      continue;
    }
    const role = moduleConfig.upstream.includes(linkedId) ? "upstream" : "downstream";
    linkedSnapshots.push({ catalog, role, relevantIds: relevantLinkedContracts(targetCatalog, catalog, tokens) });
  }

  const candidates = new Map();
  const targetResources = resourceLookup(targetCatalog);
  const targetDocRel = `${loaded.config.docsRoot}/modules/${moduleId}.md`;
  for (const base of [
    fileCandidate(projectRoot, moduleCatalogRel(moduleId), { module: moduleId, role: "target-catalog", reason: "当前模块结构化事实入口", baseScore: 1000 }),
    fileCandidate(projectRoot, targetDocRel, { module: moduleId, role: "target-doc", reason: "当前模块人读事实入口", baseScore: 990 }),
  ]) {
    if (base) pushUnique(candidates, { ...base, score: scoreCandidate(base, tokens) });
  }

  for (const evidence of targetCatalog.sourceEvidence || []) {
    const resource = [...targetResources.values()].find((item) => item.contractFile === evidence.rel);
    const candidate = fileCandidate(projectRoot, evidence.rel, {
      module: moduleId,
      role: evidence.kind === "contract" ? "target-contract" : "target-source",
      reason: evidence.kind === "contract" ? "当前模块契约事实" : "当前模块候选实现",
      contractId: resource && resource.contractId,
      entity: resource && resource.entity,
      description: resource && resource.description,
      baseScore: evidence.kind === "contract" ? 150 : 20,
    });
    if (candidate) pushUnique(candidates, { ...candidate, score: scoreCandidate(candidate, tokens) });
  }

  const linked = [];
  for (const snapshot of linkedSnapshots) {
    const linkedId = snapshot.catalog.module.id;
    linked.push(snapshotSummary(snapshot.catalog, snapshot.role, snapshot.relevantIds));
    for (const resource of snapshot.catalog.resources || []) {
      if (!snapshot.relevantIds.has(resource.contractId)) continue;
      const candidate = fileCandidate(projectRoot, resource.contractFile, {
        module: linkedId,
        role: `${snapshot.role}-contract`,
        reason: "一跳关系命中的契约；未扫描关联模块源码目录",
        contractId: resource.contractId,
        entity: resource.entity,
        description: resource.description,
        baseScore: snapshot.relevantIds.has(resource.contractId) ? 240 : 80,
      });
      if (candidate) pushUnique(candidates, { ...candidate, score: scoreCandidate(candidate, tokens) });
    }
  }

  const ordered = [...candidates.values()].sort((left, right) =>
    right.score - left.score || left.rel.localeCompare(right.rel));
  const selected = [];
  const omitted = [];
  let selectedBytes = 0;
  for (const candidate of ordered) {
    const publicCandidate = {
      rel: candidate.rel,
      module: candidate.module,
      role: candidate.role,
      reason: candidate.reason,
      bytes: candidate.bytes,
      hash: candidate.hash,
      score: candidate.score,
      ...(candidate.contractId ? { contractId: candidate.contractId } : {}),
    };
    if (selected.length >= maxFiles || selectedBytes + candidate.bytes > maxBytes) omitted.push(publicCandidate);
    else {
      selected.push(publicCandidate);
      selectedBytes += candidate.bytes;
    }
  }

  const base = {
    schemaVersion: 1,
    kind: "wl-backend-context-plan",
    project: loaded.config.project,
    module: moduleId,
    task: String(options.task || "").trim(),
    keywords: tokens,
    scanPolicy: {
      mode: "current-module-plus-one-hop-snapshots",
      scannedModules: [moduleId],
      loadedSnapshotModules: linkedSnapshots.map((item) => item.catalog.module.id).sort(),
      maxHops,
      sourceDirectoriesRead: targetCatalog.scope.scannedRoots,
      linkedSourceDirectoriesScanned: false,
    },
    authority: {
      moduleCatalog: moduleCatalogRel(moduleId),
      moduleDocument: targetDocRel,
      sourceHash: targetCatalog.sourceHash,
      catalogHash: targetCatalog.catalogHash,
    },
    limits: { maxFiles, maxBytes },
    selection: {
      files: selected,
      selectedFiles: selected.length,
      selectedBytes,
      omittedFiles: omitted.length,
    },
    linked,
    diagnostics: {
      errors: [],
      warnings: [
        ...missingSnapshots.map((id) => ({
          code: "CTX_LINKED_SNAPSHOT_MISSING",
          module: id,
          message: `一跳关联模块 ${id} 尚无快照；未回退为全量源码扫描`,
        })),
        ...linkedSnapshots.filter((item) => item.relevantIds.size === 0).map((item) => ({
          code: "CTX_LINKED_RELATION_UNRESOLVED",
          module: item.catalog.module.id,
          message: `一跳模块 ${item.catalog.module.id} 无契约关系或任务关键词命中；只记录快照哈希，不加载其文档、契约或源码`,
        })),
      ],
    },
  };
  return { ok: true, ...base, contextHash: hashJson(base) };
}

module.exports = {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_FILES,
  buildContextPlan,
  tokenize,
};
