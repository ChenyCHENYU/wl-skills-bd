"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MANIFEST_NAME = ".wl-skills-bd-manifest.json";

function normalizeRel(value) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
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
  // 词法前缀检查无法阻止项目内 symlink 指向项目外；逐段核对已有路径，
  // 保留“输出文件尚不存在”的正常场景，同时拒绝真实路径逃逸。
  let baseReal = base;
  try { baseReal = fs.realpathSync.native(base); } catch { /* root may be created by caller */ }
  let cursor = base;
  for (const segment of path.relative(base, resolved).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (!fs.existsSync(cursor)) break;
    let stat;
    try { stat = fs.lstatSync(cursor); } catch { break; }
    if (!stat.isSymbolicLink()) continue;
    let real;
    try { real = fs.realpathSync.native(cursor); } catch { throw new Error(`无法解析符号链接：${rel}`); }
    if (real !== baseReal && !real.startsWith(baseReal + path.sep)) {
      throw new Error(`路径越界（符号链接逃逸）: ${rel}`);
    }
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

function writeTextAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`,
  );
  let descriptor;
  try {
    descriptor = fs.openSync(temp, "wx", 0o600);
    fs.writeFileSync(descriptor, value, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temp, file);
    // rename 本身原子，但目录项持久化也要尽量同步，避免掉电后出现半更新状态。
    try {
      const directory = fs.openSync(path.dirname(file), "r");
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

function writeJsonAtomic(file, value) {
  writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeManifest(projectRoot, manifest) {
  writeJsonAtomic(path.join(projectRoot, MANIFEST_NAME), manifest);
}

module.exports = {
  MANIFEST_NAME,
  hashBuffer,
  hashFile,
  hashManagedFile,
  normalizeRel,
  readManifest,
  resolveWithin,
  writeJsonAtomic,
  writeManifest,
  writeTextAtomic,
};
