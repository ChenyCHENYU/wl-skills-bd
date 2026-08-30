"use strict";

const fs = require("fs");
const path = require("path");
const { normalizeRel, resolveWithin } = require("./manifest");

const IGNORED_DIRECTORIES = new Set(["target", "node_modules", ".git", ".git_disabled", ".idea", ".state"]);
const CONTENT_CACHE_LIMIT = 2000;
const contentCache = new Map();

function signature(stat) {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
}

function remember(file, value) {
  if (contentCache.has(file)) contentCache.delete(file);
  contentCache.set(file, value);
  while (contentCache.size > CONTENT_CACHE_LIMIT) contentCache.delete(contentCache.keys().next().value);
}

function readCached(file, stat, metrics) {
  const key = signature(stat);
  const cached = contentCache.get(file);
  if (cached && cached.signature === key) {
    metrics.contentCacheHits += 1;
    remember(file, cached);
    return cached.content;
  }
  const content = fs.readFileSync(file, "utf8");
  metrics.contentCacheMisses += 1;
  remember(file, { signature: key, content });
  return content;
}

function walk(directory, extensions, output) {
  if (!fs.existsSync(directory)) return;
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    return;
  }
  for (const entry of entries) {
    if (IGNORED_DIRECTORIES.has(entry.name) || entry.isSymbolicLink()) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, extensions, output);
    else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) output.push(absolute);
  }
}

function discoverFiles(targetDir, options) {
  if (Array.isArray(options.stagedFiles)) {
    return [...new Set(options.stagedFiles.map((rel) => resolveWithin(targetDir, rel)))]
      .filter((file) => fs.existsSync(file) && options.discoverExtensions.has(path.extname(file).toLowerCase()))
      .sort();
  }
  const root = options.scanRel ? resolveWithin(targetDir, options.scanRel) : targetDir;
  const files = [];
  walk(root, options.discoverExtensions, files);
  return files;
}

function createScanContext(targetDirInput, options = {}) {
  const targetDir = path.resolve(targetDirInput);
  const discoverExtensions = options.discoverExtensions || new Set();
  const readExtensions = options.readExtensions || discoverExtensions;
  const maxFileBytes = options.maxFileBytes || 2 * 1024 * 1024;
  const metrics = {
    discoveredFiles: 0,
    loadedFiles: 0,
    loadedBytes: 0,
    oversizedFiles: 0,
    contentCacheHits: 0,
    contentCacheMisses: 0,
  };
  const files = discoverFiles(targetDir, { ...options, discoverExtensions });
  metrics.discoveredFiles = files.length;
  const contents = new Map();
  const diagnostics = [];
  for (const absolute of files) {
    const rel = normalizeRel(path.relative(targetDir, absolute));
    if (!readExtensions.has(path.extname(absolute).toLowerCase())) continue;
    let stat;
    try { stat = fs.statSync(absolute); } catch (error) {
      diagnostics.push({ rel, message: `文件状态读取失败：${error.message}` });
      continue;
    }
    if (!stat.isFile()) continue;
    if (stat.size > maxFileBytes) {
      metrics.oversizedFiles += 1;
      diagnostics.push({ rel, message: `文件超过 ${maxFileBytes} 字节扫描上限` });
      continue;
    }
    try {
      const content = readCached(absolute, stat, metrics);
      contents.set(rel, content);
      metrics.loadedFiles += 1;
      metrics.loadedBytes += Buffer.byteLength(content, "utf8");
    } catch (error) {
      diagnostics.push({ rel, message: `文件读取失败：${error.message}` });
    }
  }
  return { targetDir, files, contents, diagnostics, metrics };
}

function clearScanContextCache() {
  contentCache.clear();
}

module.exports = { clearScanContextCache, createScanContext };
