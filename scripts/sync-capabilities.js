#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const {
  DEFAULT_OUTPUT_REL,
  discoverCapabilities,
  serializeCapabilities,
} = require("../lib/capabilities");

const ROOT = path.resolve(__dirname, "..");
const destination = path.join(ROOT, DEFAULT_OUTPUT_REL);
const expected = serializeCapabilities(discoverCapabilities(ROOT));

if (process.argv.includes("--write")) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, expected, "utf8");
  fs.renameSync(temporary, destination);
  console.log(`capabilities synchronized: ${DEFAULT_OUTPUT_REL}`);
  process.exit(0);
}

let actual;
try {
  actual = fs.existsSync(destination) ? JSON.parse(fs.readFileSync(destination, "utf8")) : null;
} catch {
  actual = null;
}
const discovered = JSON.parse(expected);
if (JSON.stringify(actual) !== JSON.stringify(discovered)) {
  console.error(`capabilities drift: run node scripts/sync-capabilities.js --write`);
  process.exit(1);
}
console.log(`capabilities verified: ${DEFAULT_OUTPUT_REL}`);
