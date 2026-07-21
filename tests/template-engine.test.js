"use strict";

const assert = require("assert");
const { parse, render } = require("../lib/template-engine");

assert.strictEqual(render("Hello {{name}}!", { name: "world" }), "Hello world!");
assert.strictEqual(render("{{#items}}[{{name}}={{.}}]{{/items}}", {
  name: "root",
  items: ["a", "b"],
}), "[root=a][root=b]");
assert.strictEqual(render("{{^items}}empty{{/items}}", { items: [] }), "empty");
assert.throws(() => render("{{missing}}", {}), /模板变量未提供/);
assert.throws(() => render("{{value}}", { value: {} }), /必须是标量/);
assert.strictEqual(
  render("a\n{{#enabled}}\nvalue\n{{/enabled}}\nz\n", { enabled: false }),
  "a\nz\n",
  "standalone 控制标签不得产生空行污染",
);
assert.throws(() => parse("{{#a}}"), /未闭合/);
assert.throws(() => parse("{{#a}}{{/b}}"), /未配对/);

console.log("✅ template-engine：严格变量、循环、反向分支和错误路径通过");
