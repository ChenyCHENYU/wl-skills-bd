#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const tests = fs.readdirSync(path.join(ROOT, "tests"))
  .filter((file) => file.endsWith(".test.js"))
  .sort()
  .map((file) => path.join("tests", file));
const coverage = process.argv.includes("--coverage");
const args = ["--test", "--test-concurrency=4"];

if (coverage) {
  args.push(
    "--experimental-test-coverage",
    "--test-coverage-lines=80",
    "--test-coverage-branches=65",
    "--test-coverage-functions=85",
    "--test-coverage-include=lib/**/*.js",
    "--test-coverage-include=mcp/**/*.js",
    "--test-coverage-include=bin/**/*.js",
  );
}
args.push(...tests);

const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: "inherit" });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
