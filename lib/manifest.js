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
  return resolved;
}

function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function hashFile(file) {
  return hashBuffer(fs.readFileSync(file));
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
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, value, "utf8");
  fs.renameSync(temp, file);
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
  normalizeRel,
  readManifest,
  resolveWithin,
  writeJsonAtomic,
  writeManifest,
  writeTextAtomic,
};
