"use strict";

const path = require("path");
const { normalizeRel, resolveWithin } = require("./manifest");

function commonRelativeRoot(values) {
  const parts = values
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => normalizeRel(value).split("/").filter(Boolean));
  if (parts.length === 0) return null;
  const common = [];
  for (let index = 0; index < Math.min(...parts.map((item) => item.length)); index += 1) {
    const value = parts[0][index];
    if (parts.every((item) => item[index] === value)) common.push(value);
    else break;
  }
  return common.length > 0 ? common.join("/") : null;
}

function discoverWorkspace(projectRootInput) {
  const projectRoot = path.resolve(projectRootInput || process.cwd());
  let loaded;
  try {
    loaded = require("./project-catalog").loadCatalogConfig(projectRoot);
  } catch {
    return { ok: false, enabled: false, projectRoot, reason: "catalog-unavailable", modules: [] };
  }
  if (!loaded.ok || Object.keys(loaded.config.modules).length < 2) {
    return {
      ok: loaded.ok,
      enabled: false,
      projectRoot,
      reason: loaded.ok ? "single-module" : "catalog-unavailable",
      errors: loaded.errors || [],
      modules: [],
    };
  }
  const modules = [];
  const errors = [];
  for (const [id, config] of Object.entries(loaded.config.modules)) {
    const rel = config.root || commonRelativeRoot([...config.sourceRoots, ...config.contractRoots]);
    if (!rel) {
      errors.push({ module: id, message: "模块源码根与契约根没有共同目录；请显式配置 modules.<id>.root" });
      continue;
    }
    try {
      const root = resolveWithin(projectRoot, rel);
      modules.push({ id, rel: normalizeRel(rel), root, config });
    } catch (cause) {
      errors.push({ module: id, message: cause.message });
    }
  }
  const roots = new Map();
  for (const module of modules) {
    const key = module.root.toLowerCase();
    if (roots.has(key)) errors.push({ module: module.id, message: `与模块 ${roots.get(key)} 共用作用域 ${module.rel}` });
    else roots.set(key, module.id);
  }
  return {
    ok: errors.length === 0,
    enabled: errors.length === 0 && modules.length > 1,
    projectRoot,
    config: loaded.config,
    configHash: loaded.configHash,
    modules: modules.sort((left, right) => left.id.localeCompare(right.id)),
    errors,
  };
}

function prefixRelative(prefix, value) {
  if (!value || value === ".") return normalizeRel(prefix);
  return normalizeRel(path.posix.join(normalizeRel(prefix), normalizeRel(value)));
}

function relativeToModule(module, projectRelative) {
  const rel = normalizeRel(projectRelative);
  if (rel === module.rel) return ".";
  const prefix = `${module.rel}/`;
  return rel.startsWith(prefix) ? rel.slice(prefix.length) : null;
}

module.exports = {
  commonRelativeRoot,
  discoverWorkspace,
  prefixRelative,
  relativeToModule,
};
