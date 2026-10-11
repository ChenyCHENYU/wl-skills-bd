"use strict";

/**
 * tests/verify-version.test.js — scripts/verify-version.js 冒烟测试
 *
 * 通过子进程跑 verify-version.js，确认当前仓库自身能通过自检。
 * 对标 wl-skills-kit/tests/version-tools.test.js。
 */

const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const capabilities = require("../lib/capabilities");

const ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "verify-version.js");

function run() {
  return execFileSync("node", [SCRIPT], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

(function testVerifyVersionPasses() {
  const out = run();
  assert.match(out, /\[verify-version\] ✔/, "verify-version 应通过自检");
  assert.match(out, /standards=\d+/, "应输出 standards 计数");
  assert.match(out, /skills=\d+/, "应输出 skills 计数");
  console.log("  ✔ verify-version 通过，版本/计数一致");
})();

(function testNestedSkillMetadata() {
  const file = path.join(ROOT, "files", ".github", "skills", "core", "api-design-be", "SKILL.md");
  const frontmatter = capabilities.readFrontmatter(file);
  assert.strictEqual(frontmatter.status, "✅ 已落地", "能力目录必须读取 metadata.status，而非误判为 unknown");
  assert.ok(frontmatter.stage, "能力目录必须读取 metadata.stage");
})();

(function testGatewayPinUsesCurrentVersionAndRejectsEveryStalePin() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-version-gateway-"));
  try {
    for (const name of ["scripts", "files", "lib", "mcp", "bin", "package.json", "package-lock.json", "README.md", "CHANGELOG.md"]) {
      fs.cpSync(path.join(ROOT, name), path.join(fixture, name), { recursive: true });
    }
    const gateway = path.join(fixture, "files/.agents/skills/wl-skills-bd/SKILL.md");
    const original = fs.readFileSync(gateway, "utf8");
    const version = require("../package.json").version;
    const currentCommand = `npx --yes @agile-team/wl-skills-bd@${version}`;
    assert.ok(original.includes(currentCommand), "真实 gateway 必须使用已验收的当前包 pin");
    const check = () => spawnSync(process.execPath, [path.join(fixture, "scripts/verify-version.js")], {
      cwd: fixture,
      encoding: "utf8",
      env: { ...process.env, NODE_PATH: path.join(ROOT, "node_modules") },
    });
    const current = check();
    assert.strictEqual(current.status, 0, current.stderr);
    fs.writeFileSync(gateway, original.replace(currentCommand, "wl-skills-bd"));
    const local = check();
    assert.strictEqual(local.status, 0, "本地 CLI 无 pin 形式合法，不强制网络 npx");
    fs.writeFileSync(gateway, original + `\n补充命令：\`npx --package @agile-team/wl-skills-bd@${version} --package @agile-team/wl-skills-bd@0.0.0 wl-skills-bd task --input 检查\`\n`);
    const stale = check();
    assert.strictEqual(stale.status, 1, "同一命令第二个旧 pin 也必须真实阻断版本门禁");
    assert.match(stale.stderr, /gateway npx pin 版本不一致 \(0\.0\.0 vs /);
    assert.doesNotMatch(stale.stderr, /加载失败|读取失败/, "失败必须来自旧 pin，不用缺依赖冒充回归");
    console.log("  ✔ gateway 真实当前 pin / 本地无 pin / 同一命令第二个旧 pin 拒绝");
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
})();

console.log("\n✅ verify-version 测试通过");
