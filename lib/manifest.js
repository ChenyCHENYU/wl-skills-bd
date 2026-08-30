"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MANIFEST_NAME = ".wl-skills-bd-manifest.json";

function normalizeRel(value) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function nearestExistingAncestor(value) {
  let current = path.resolve(value);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return current;
}

function isWithin(base, candidate) {
  const relative = path.relative(base, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function projectedRealPath(value) {
  const existing = nearestExistingAncestor(value);
  if (!existing) return path.resolve(value);
  return path.resolve(fs.realpathSync(existing), path.relative(existing, path.resolve(value)));
}

function resolveWithin(root, rel) {
  const normalized = normalizeRel(rel);
  if (!normalized || normalized.startsWith("../") || path.isAbsolute(normalized)) {
    throw new Error(`非法相对路径: ${rel}`);
  }
  const base = path.resolve(root);
  const resolved = path.resolve(base, normalized);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`路径越界: ${rel}`);
  }
  const realBase = projectedRealPath(base);
  const realResolved = projectedRealPath(resolved);
  if (!isWithin(realBase, realResolved)) {
    throw new Error(`路径经符号链接越界: ${rel}`);
  }
  return resolved;
}

function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function hashFile(file) {
  return hashBuffer(fs.readFileSync(file));
}

/**
 * 受管文本资产必须在 Windows/Linux 间保持同一内容身份。
 * Git 的 core.autocrlf 可能只改变换行符；这种变化不属于用户定制，
 * 不应阻断 update/check/clean。二进制文件仍按原始字节计算，避免误改。
 */
function hashManagedFile(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.includes(0)) return hashBuffer(buffer);
  const normalized = buffer.toString("utf8").replace(/\r\n/g, "\n");
  return hashBuffer(Buffer.from(normalized, "utf8"));
}

function readManifest(projectRoot) {
  const file = path.join(projectRoot, MANIFEST_NAME);
  if (!fs.existsSync(file)) return null;
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (parsed.schemaVersion !== 1 || !parsed.files || typeof parsed.files !== "object") {
    throw new Error(`${MANIFEST_NAME} 格式不受支持`);
  }
  return parsed;
}

function writeTextAtomic(file, value, options = {}) {
  let destination = path.resolve(file);
  if (options.projectRoot) {
    destination = resolveWithin(options.projectRoot, path.relative(path.resolve(options.projectRoot), destination));
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (options.projectRoot) {
    destination = resolveWithin(options.projectRoot, path.relative(path.resolve(options.projectRoot), destination));
  }
  const temp = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`,
  );
  let descriptor;
  try {
    descriptor = fs.openSync(temp, "wx", 0o600);
    if (Buffer.isBuffer(value)) fs.writeFileSync(descriptor, value);
    else fs.writeFileSync(descriptor, value, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    if (options.projectRoot) {
      destination = resolveWithin(options.projectRoot, path.relative(path.resolve(options.projectRoot), destination));
    }
    fs.renameSync(temp, destination);
    // rename 本身原子，但目录项持久化也要尽量同步，避免掉电后出现半更新状态。
    try {
      const directory = fs.openSync(path.dirname(destination), "r");
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    } catch { /* 某些平台/文件系统不允许 fsync 目录，不影响 rename 原子性 */ }
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* ignore cleanup errors */ }
    }
    try { fs.unlinkSync(temp); } catch { /* ignore cleanup errors */ }
    throw error;
  }
}

function writeJsonAtomic(file, value, options = {}) {
  writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`, options);
}

function writeManifest(projectRoot, manifest) {
  writeJsonAtomic(path.join(projectRoot, MANIFEST_NAME), manifest, { projectRoot });
}

module.exports = {
  MANIFEST_NAME,
  hashBuffer,
  hashFile,
  hashManagedFile,
  normalizeRel,
  projectedRealPath,
  readManifest,
  resolveWithin,
  writeJsonAtomic,
  writeManifest,
  writeTextAtomic,
};
