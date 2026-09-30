"use strict";

const fs = require("fs");
const path = require("path");
const { normalizeRel, resolveWithin } = require("./manifest");

const IGNORED_DIRECTORIES = new Set(["target", "node_modules", ".git", ".git_disabled", ".idea", ".state"]);
const CONTENT_CACHE_LIMIT = 2000;
const CONTENT_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const contentCache = new Map();
let contentCacheBytes = 0;

function signature(stat) {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
}

function remember(file, value) {
  const previous = contentCache.get(file);
  if (previous) {
    contentCacheBytes -= previous.bytes;
    contentCache.delete(file);
  }
  if (value.bytes > CONTENT_CACHE_MAX_BYTES) return;
  contentCache.set(file, value);
  contentCacheBytes += value.bytes;
  while (contentCache.size > CONTENT_CACHE_LIMIT || contentCacheBytes > CONTENT_CACHE_MAX_BYTES) {
    const oldest = contentCache.keys().next().value;
    contentCacheBytes -= contentCache.get(oldest).bytes;
    contentCache.delete(oldest);
  }
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
  remember(file, { signature: key, content, bytes: Buffer.byteLength(content, "utf8") });
  return content;
}

function walk(directory, extensions, output, diagnostics, targetDir) {
  let stat;
  try { stat = fs.lstatSync(directory); } catch (error) {
    diagnostics.push({ rel: normalizeRel(path.relative(targetDir, directory)) || ".", message: `扫描路径状态读取失败：${error.message}` });
    return;
  }
  if (stat.isSymbolicLink()) {
    diagnostics.push({ rel: normalizeRel(path.relative(targetDir, directory)) || ".", message: "扫描路径是符号链接，未跟随" });
    return;
  }
  if (stat.isFile()) {
    if (extensions.has(path.extname(directory).toLowerCase())) output.push(directory);
    return;
  }
  if (!stat.isDirectory()) return;
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    diagnostics.push({ rel: normalizeRel(path.relative(targetDir, directory)) || ".", message: `目录读取失败：${error.message}` });
    return;
  }
  for (const entry of entries) {
    if (IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      diagnostics.push({ rel: normalizeRel(path.relative(targetDir, absolute)), message: "扫描路径是符号链接，未跟随" });
      continue;
    }
    if (entry.isDirectory()) walk(absolute, extensions, output, diagnostics, targetDir);
    else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) output.push(absolute);
  }
}

function discoverFiles(targetDir, options, diagnostics) {
  if (options.discoverExtensions.size === 0) return [];
  if (Array.isArray(options.stagedFiles)) {
    return [...new Set(options.stagedFiles.map((rel) => resolveWithin(targetDir, rel)))]
      .filter((file) => fs.existsSync(file) && options.discoverExtensions.has(path.extname(file).toLowerCase()))
      .sort();
  }
  const root = options.scanRel ? resolveWithin(targetDir, options.scanRel) : targetDir;
  const files = [];
  walk(root, options.discoverExtensions, files, diagnostics, targetDir);
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
  const diagnostics = [];
  const files = discoverFiles(targetDir, { ...options, discoverExtensions }, diagnostics);
  metrics.discoveredFiles = files.length;
  const contents = new Map();
  for (const absolute of files) {
    const rel = normalizeRel(path.relative(targetDir, absolute));
    if (!readExtensions.has(path.extname(absolute).toLowerCase())) continue;
    let stat;
    try {
      const linkStat = fs.lstatSync(absolute);
      if (linkStat.isSymbolicLink()) {
        diagnostics.push({ rel, message: "扫描文件是符号链接，未跟随" });
        continue;
      }
      stat = fs.statSync(absolute);
    } catch (error) {
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
  metrics.contentCacheBytes = contentCacheBytes;
  return { targetDir, files, contents, diagnostics, metrics, complete: diagnostics.length === 0 };
}

function clearScanContextCache() {
  contentCache.clear();
  contentCacheBytes = 0;
}

module.exports = { clearScanContextCache, createScanContext };
