// 直接调 registry handle 函数测试，绕过 stdio
const path = require("path");
const { HANDLERS, TOOLS } = require("../mcp/registry");

(async () => {
  console.log("=== tools/list ===");
  console.log(TOOLS.map(t => t.name).join(", "));

  console.log("\n=== wls_be_validate ===");
  process.env.WL_PROJECT_ROOT = path.join(__dirname, "..");
  const r1 = await HANDLERS["wls_be_validate"].handle({});
  console.log("ok:", JSON.stringify(r1.structuredContent));

  console.log("\n=== wls_be_standards ===");
  const r2 = await HANDLERS["wls_be_standards"].handle({ id: "04" });
  console.log("首行:", r2.text.split("\n")[0]);

  console.log("\n=== wls_be_templates ===");
  const r3 = await HANDLERS["wls_be_templates"].handle({ name: "Controller" });
  console.log("首行:", r3.text.split("\n")[0]);

  console.log("\n✅ 三个工具 handle 全部正常");
})();
