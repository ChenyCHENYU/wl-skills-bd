"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { COMMAND_CATALOG, commandInventory, createCommandDispatcher } = require("../lib/cli-catalog");
const { commandHandlers } = require("../bin/wl-skills-bd");
const { protocol } = require("../lib/protocol-cli");
const capabilities = require("../files/.wl-skills-bd/capabilities.json");
const BIN = path.join(__dirname, "../bin/wl-skills-bd.js");

const EXPECTED_COMMANDS = [
  "init", "update", "diff", "clean", "check", "validate", "doctor", "codegen", "contract",
  "db", "permissions", "catalog", "context", "impact", "integration", "review", "commit",
  "fix", "config", "troubleshoot", "task", "route", "explain", "status", "doctor-host",
  "test", "capabilities", "protocol", "mcp", "help", "version",
];

test("完整 CLI 命令、参数与副作用在真实接线/公开目录/分发快照逐项一致", () => {
  assert.deepEqual(COMMAND_CATALOG.map((entry) => entry.name), EXPECTED_COMMANDS);
  const realDispatcher = createCommandDispatcher(commandHandlers);
  for (const name of EXPECTED_COMMANDS) {
    const entry = realDispatcher.get(name);
    assert.equal(commandHandlers[entry.handler].name, entry.handler, `${name} 必须接真实函数`);
  }
  assert.deepEqual(protocol.describe().inventory.commands, commandInventory());
  assert.deepEqual(capabilities.cliCommands.items, commandInventory());
  assert.equal(capabilities.cliCommands.count, EXPECTED_COMMANDS.length);
  const byName = Object.fromEntries(commandInventory().map((entry) => [entry.name, entry]));
  assert.match(byName.codegen.args, /<validate\|plan\|apply> <contract-file>/);
  assert.ok(!byName.codegen.args.includes("--contract"), "不存在的 --contract 不能冒充参数");
  assert.match(byName.check.sideEffects, /不执行 Maven/);
  assert.equal(byName.validate.write, "recorded");
  assert.match(byName.validate.sideEffects, /runs/);
  assert.equal(byName.task.write, "recorded");
  assert.match(byName.task.sideEffects, /--list 不记录/);
  assert.equal(byName.route.write, "readonly");
  assert.match(byName.integration.args, /adapters\|plan\|apply/);
  assert.match(byName.config.sideEffects, /TCP/);
});

test("每个命令及别名精确分发至原 handler；安装/只读判定/宿主模式保持原参数", () => {
  const calls = [];
  const handlers = Object.fromEntries(Object.keys(commandHandlers).map((name) => [name, (...args) => { calls.push({ name, args }); return 37; }]));
  const dispatcher = createCommandDispatcher(handlers);
  for (const entry of COMMAND_CATALOG) {
    const args = ["a", "--json"];
    for (const name of [entry.name, ...(entry.aliases || [])]) {
      assert.equal(dispatcher.run(name, args), 37);
      assert.deepEqual(calls.at(-1), {
        name: entry.handler,
        args: entry.passCommand ? [entry.name, args] : [args, ...(entry.trailingArguments || [])],
      }, name);
    }
  }
  dispatcher.run("route", []);
  assert.deepEqual(calls.at(-1), { name: "commandTask", args: [[], false] });
  dispatcher.run("doctor-host", []);
  assert.deepEqual(calls.at(-1), { name: "commandDoctor", args: [[], true] });
  assert.equal(dispatcher.get("missing"), undefined);
  assert.throws(() => dispatcher.run("missing", []), /未知命令/);
});

test("新增目录没有真实 handler 或重复入口时拒绝，而非数量通过", () => {
  assert.throws(() => createCommandDispatcher(commandHandlers, [...COMMAND_CATALOG, {
    name: "future", handler: "missingFuture", args: "", sideEffects: "none",
  }]), /CLI 入口未接线：future/);
  assert.throws(() => createCommandDispatcher(commandHandlers, [...COMMAND_CATALOG, COMMAND_CATALOG[0]]), /CLI 入口重复：init/);
  assert.throws(() => createCommandDispatcher(commandHandlers, [...COMMAND_CATALOG, {
    ...COMMAND_CATALOG[0], name: "future", aliases: ["--help"],
  }]), /CLI 入口重复：--help/);
});

test("实际 CLI 帮助展示完整同源参数/副作用，版本别名与 protocol describe 正常", () => {
  const help = spawnSync(process.execPath, [BIN, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  for (const entry of commandInventory()) {
    assert.ok(help.stdout.includes(`  ${entry.name.padEnd(13)} ${entry.summary}`), entry.name);
    assert.ok(help.stdout.includes(`    ${entry.args || "（无参数）"}\n    副作用：${entry.sideEffects}`), entry.name);
  }
  const described = spawnSync(process.execPath, [BIN, "protocol", "describe", "--json"], { encoding: "utf8" });
  assert.equal(described.status, 0, described.stderr);
  assert.deepEqual(JSON.parse(described.stdout).inventory.commands, commandInventory());
  const version = spawnSync(process.execPath, [BIN, "-v"], { encoding: "utf8" });
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), require("../package.json").version);
});
