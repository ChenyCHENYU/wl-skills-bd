"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { clearScanContextCache, createScanContext } = require("../lib/scan-context");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-scan-memory-"));
try {
  const content = "x".repeat(20 * 1024 * 1024);
  for (let index = 0; index < 4; index += 1) fs.writeFileSync(path.join(root, `${index}.txt`), content);
  const options = {
    discoverExtensions: new Set([".txt"]),
    readExtensions: new Set([".txt"]),
    maxFileBytes: 21 * 1024 * 1024,
  };
  clearScanContextCache();
  const first = createScanContext(root, options);
  assert.strictEqual(first.complete, true);
  assert.strictEqual(first.metrics.loadedFiles, 4);
  assert.ok(first.metrics.contentCacheBytes <= 64 * 1024 * 1024, "内容缓存必须按字节淘汰");
  const second = createScanContext(root, options);
  assert.ok(second.metrics.contentCacheMisses > 0, "超出预算的文件不能全部留在缓存中");
} finally {
  clearScanContextCache();
  fs.rmSync(root, { recursive: true, force: true });
}
