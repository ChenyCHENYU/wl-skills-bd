"use strict";

const fs = require("fs");
const path = require("path");
const { loadContractCompat } = require("./contract-compat");
const { hashJson } = require("./deterministic");
const { normalizeRel, resolveWithin } = require("./manifest");
const { loadCatalogConfig } = require("./project-catalog");

const SKIP_DIRECTORIES = new Set([".git", ".state", "node_modules", "target", "dist", "build"]);
const SCAN_EXTENSIONS = new Set([".java", ".xml", ".sql", ".md", ".yml", ".yaml", ".properties", ".json"]);

function issue(code, severity, location, message) {
  return { code, severity, path: location, message };
}

function unique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function listFiles(projectRoot, roots, predicate) {
  const result = new Set();
  const visit = (absolute) => {
    if (!fs.existsSync(absolute)) return;
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) return;
    if (stat.isFile()) {
      if (!predicate || predicate(absolute)) result.add(normalizeRel(path.relative(projectRoot, absolute)));
      return;
    }
    if (!stat.isDirectory()) return;
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
      visit(path.join(absolute, entry.name));
    }
  };
  for (const root of roots) visit(resolveWithin(projectRoot, root));
  return [...result].sort();
}

function contractCandidate(projectRoot, rel) {
  const name = path.basename(rel).toLowerCase();
  if (name === "wl-contract.json" || name.endsWith(".contract.json")) return true;
  try {
    const raw = JSON.parse(fs.readFileSync(resolveWithin(projectRoot, rel), "utf8"));
    return Boolean(raw && typeof raw.contractId === "string" && raw.entity && typeof raw.entity === "object");
  } catch { return false; }
}

function storageCapacity(dbType) {
  const match = String(dbType || "").toUpperCase().match(/^(?:VAR)?CHAR2?\((\d+)/u);
  return match ? Number(match[1]) : null;
}

function classifyFile(rel) {
  const value = rel.replace(/\\/g, "/").toLowerCase();
  const name = path.basename(value);
  if (name === "wl-contract.json" || name.endsWith(".contract.json")) return "contract";
  if (/db\/migration|migration|\.sql$/u.test(value)) return "migration";
  if (/controller\.java$/u.test(value)) return "controller";
  if (/(?:dto|request|param|command|query)\.java$/u.test(value) || /\/(?:dto|request|param|command|query)\//u.test(value)) return "dto";
  if (/(?:entity|model|po)\.java$/u.test(value) || /\/(?:entity|model|po)\//u.test(value)) return "entity";
  if (/mapper(?:\.java|\.xml)$/u.test(value) || /\/mapper\//u.test(value)) return "mapper";
  if (/service(?:impl)?\.java$/u.test(value) || /\/service\//u.test(value)) return "service";
  if (/test|spec/u.test(value)) return "test";
  if (/\.md$/u.test(value)) return "documentation";
  if (/\.(?:yml|yaml|properties)$/u.test(value)) return "configuration";
  return "other";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function referenceMatcher(terms) {
  const patterns = unique(terms.filter(Boolean)).map((term) => escapeRegExp(term));
  return patterns.length > 0 ? new RegExp(`(?<![A-Za-z0-9_])(?:${patterns.join("|")})(?![A-Za-z0-9_])`, "giu") : null;
}

function scanReferences(projectRoot, files, terms) {
  const matcher = referenceMatcher(terms);
  if (!matcher) return [];
  const evidence = [];
  for (const rel of files) {
    const lines = fs.readFileSync(resolveWithin(projectRoot, rel), "utf8").split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      matcher.lastIndex = 0;
      let match;
      while ((match = matcher.exec(lines[index])) !== null) {
        evidence.push({
          file: rel,
          line: index + 1,
          role: classifyFile(rel),
          term: match[0],
          snippet: lines[index].trim().replace(/\s+/gu, " ").slice(0, 180),
        });
        if (match[0].length === 0) matcher.lastIndex += 1;
      }
    }
  }
  return evidence.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line || left.term.localeCompare(right.term));
}

function directlyRelatedBound(projectRoot, bound, match, contentCache) {
  const rel = bound.file.toLowerCase().replace(/[^a-z0-9]/gu, "");
  const entity = String(match.contractEntity || "").toLowerCase();
  if (entity && rel.includes(entity)) return true;
  if (!contentCache.has(bound.file)) contentCache.set(bound.file, fs.readFileSync(resolveWithin(projectRoot, bound.file), "utf8").toLowerCase());
  const content = contentCache.get(bound.file);
  return (entity && new RegExp(`\\b${escapeRegExp(entity)}\\b`, "u").test(content))
    || content.includes(String(match.table || "").toLowerCase());
}

function javaSizeBounds(projectRoot, files, fieldNames) {
  const names = new Set(fieldNames);
  const bounds = [];
  for (const rel of files.filter((file) => file.endsWith(".java"))) {
    const lines = fs.readFileSync(resolveWithin(projectRoot, rel), "utf8").split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      const declaration = lines[index].match(/\b(?:String|List<[^>]+>)\s+([a-z][A-Za-z0-9]*)\s*[;=]/u);
      if (!declaration || !names.has(declaration[1])) continue;
      const annotations = lines.slice(Math.max(0, index - 8), index).join("\n");
      const size = annotations.match(/@(?:Size|Length)\s*\([^)]*\bmax\s*=\s*(\d+)/u);
      bounds.push({ file: rel, line: index + 1, field: declaration[1], maxLength: size ? Number(size[1]) : null });
    }
  }
  return bounds;
}

function migrationPhases(migrations) {
  return migrations.map((migration, index) => {
    const value = String(migration);
    const lower = value.toLowerCase();
    const phase = lower.includes("backfill") ? "backfill"
      : lower.includes("expand") ? "expand"
        : lower.includes("contract") ? "contract"
          : "unspecified";
    return { index, migration: value, phase };
  });
}

function validateMigrationChain(contractId, migrations) {
  const phases = migrationPhases(migrations);
  const errors = [];
  const indexes = Object.fromEntries(["expand", "backfill", "contract"].map((phase) => [phase, phases.findIndex((item) => item.phase === phase)]));
  if (indexes.contract >= 0 && indexes.expand < 0) errors.push(issue("I301", "error", `$.contracts.${contractId}.migrations`, "contract 阶段缺少在先 expand 阶段"));
  if (indexes.contract >= 0 && indexes.backfill < 0) errors.push(issue("I302", "error", `$.contracts.${contractId}.migrations`, "contract 阶段缺少在先 backfill 阶段"));
  if (indexes.expand >= 0 && indexes.backfill >= 0 && indexes.expand > indexes.backfill) errors.push(issue("I303", "error", `$.contracts.${contractId}.migrations`, "expand 必须早于 backfill"));
  if (indexes.backfill >= 0 && indexes.contract >= 0 && indexes.backfill > indexes.contract) errors.push(issue("I304", "error", `$.contracts.${contractId}.migrations`, "backfill 必须早于 contract"));
  return { phases, issues: errors };
}

function analyzeFieldImpact(projectRootInput, options = {}) {
  const projectRoot = path.resolve(projectRootInput || process.cwd());
  const loaded = loadCatalogConfig(projectRoot, options.configRel);
  if (!loaded.ok) return { ok: false, errors: loaded.errors };
  const moduleId = options.module;
  if (!moduleId) return { ok: false, errors: [issue("I101", "error", "$.module", "必须指定 module，禁止隐式全仓扫描")] };
  const moduleConfig = loaded.config.modules[moduleId];
  if (!moduleConfig) return { ok: false, errors: [issue("I102", "error", "$.module", `未知模块：${moduleId}`)] };
  const query = String(options.field || "").trim();
  if (!query) return { ok: false, errors: [issue("I103", "error", "$.field", "必须指定字段名或列名")] };
  const table = options.table ? String(options.table).toLowerCase() : null;
  const jsonFiles = listFiles(projectRoot, moduleConfig.contractRoots, (file) => file.toLowerCase().endsWith(".json"));
  const contracts = [];
  const contractErrors = [];
  for (const rel of jsonFiles.filter((file) => contractCandidate(projectRoot, file))) {
    const contract = loadContractCompat(rel, { projectRoot });
    if (!contract.ok) {
      contractErrors.push(...contract.errors.map((item) => ({ ...item, file: rel })));
      continue;
    }
    contracts.push({ rel, descriptor: contract.descriptor });
  }
  const matches = [];
  for (const contract of contracts) {
    if (table && String(contract.descriptor.entity.table).toLowerCase() !== table) continue;
    for (const field of contract.descriptor.fields) {
      if (![field.name, field.column].some((value) => String(value).toLowerCase() === query.toLowerCase())) continue;
      matches.push({
        contractId: contract.descriptor.contractId,
        contractKind: contract.descriptor.contractKind,
        contractFile: contract.rel,
        contractEntity: contract.descriptor.entity.name,
        table: contract.descriptor.entity.table,
        owner: contract.descriptor.ownership,
        field,
        storageMaxLength: storageCapacity(field.dbType),
        migrations: contract.descriptor.migrations,
      });
    }
  }
  if (matches.length === 0) {
    const candidates = unique(contracts.flatMap((contract) => contract.descriptor.fields.flatMap((field) => [field.name, field.column])))
      .filter((value) => value.toLowerCase().includes(query.toLowerCase())).slice(0, 20);
    return { ok: false, reason: "field-not-found", errors: contractErrors, module: moduleId, field: query, candidates };
  }
  const terms = unique(matches.flatMap((match) => [match.field.name, match.field.column]));
  const scanFiles = listFiles(projectRoot, unique([...moduleConfig.contractRoots, ...moduleConfig.sourceRoots]), (file) => SCAN_EXTENSIONS.has(path.extname(file).toLowerCase()));
  const evidence = scanReferences(projectRoot, scanFiles, terms);
  const allJavaBounds = javaSizeBounds(projectRoot, scanFiles, new Set(matches.map((match) => match.field.name)));
  const contentCache = new Map();
  const relevantJavaBounds = allJavaBounds.filter((bound) => matches.some((match) => directlyRelatedBound(projectRoot, bound, match, contentCache)));
  const findings = [];
  for (const match of matches) {
    const relatedBounds = relevantJavaBounds.filter((bound) => bound.field === match.field.name && directlyRelatedBound(projectRoot, bound, match, contentCache));
    for (const bound of relatedBounds) {
      if (match.storageMaxLength && bound.maxLength && bound.maxLength > match.storageMaxLength) {
        findings.push(issue("I201", "error", `${bound.file}:${bound.line}`, `API maxLength=${bound.maxLength} 超过 ${match.table}.${match.field.column} 容量 ${match.storageMaxLength}`));
      }
      if (match.storageMaxLength && bound.maxLength === null && ["dto", "controller"].includes(classifyFile(bound.file))) {
        findings.push(issue("I202", "warn", `${bound.file}:${bound.line}`, `字符串字段 ${bound.field} 缺少 @Size(max=${match.storageMaxLength}) 边界`));
      }
    }
    const chain = validateMigrationChain(match.contractId, match.migrations);
    match.migrationPhases = chain.phases;
    findings.push(...chain.issues);
  }
  const owners = unique(matches.map((match) => match.owner || "unassigned"));
  if (owners.length > 1) findings.push(issue("I203", "warn", "$.ownership", `同一字段命中多个所有权：${owners.join(", ")}`));
  const roleCounts = Object.fromEntries(unique(evidence.map((item) => item.role)).map((role) => [role, evidence.filter((item) => item.role === role).length]));
  const limit = Math.max(1, Math.min(200, Number.parseInt(options.limit, 10) || 50));
  const cursor = Math.max(0, Number.parseInt(options.cursor, 10) || 0);
  const page = evidence.slice(cursor, cursor + limit);
  const base = {
    schemaVersion: 1,
    kind: "wl-field-impact-report",
    project: loaded.config.project.id,
    module: moduleId,
    query: { field: query, table: options.table || null },
    matches,
    ownership: { owners, assigned: !owners.includes("unassigned") },
    propagation: {
      javaBoundsTotal: relevantJavaBounds.length,
      javaBounds: relevantJavaBounds.slice(0, limit),
      findingsTotal: findings.length,
      findings: findings.slice(0, limit),
    },
    evidence: { total: evidence.length, roleCounts, cursor, limit, nextCursor: cursor + page.length < evidence.length ? cursor + page.length : null, items: page },
    diagnostics: { contractErrors, errors: findings.filter((item) => item.severity === "error").length, warnings: findings.filter((item) => item.severity === "warn").length },
  };
  return { ok: contractErrors.length === 0 && base.diagnostics.errors === 0, ...base, reportHash: hashJson(base) };
}

module.exports = {
  analyzeFieldImpact,
  classifyFile,
  migrationPhases,
  storageCapacity,
  validateMigrationChain,
};
