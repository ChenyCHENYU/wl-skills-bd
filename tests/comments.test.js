"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { runBeRules } = require("../lib/be-rules");
const { buildPlan } = require("../lib/codegen");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-comments-"));
try {
  const source = path.join(root, "ExampleService.java");
  fs.writeFileSync(source, `public class ExampleService {
    private String name;
    /** @return 标签不能代替业务正文 */
    public String queryMissing() { return name; }
    /** 查询登录租户内记录。 @return 业务记录 */
    public String queryValid() { return name; }
    /** */
    public void empty() { }
    public String getName() { return name; }
    public void setName(String value) { this.name = value; }
    @Override
    public String toString() { return name; }
    public String getRemote() { return fetch(); }
}`);
  const result = runBeRules(root, { rules: ["B12"] });
  const issues = result.issues.filter((item) => item.rule === "B12");
  assert.strictEqual(issues.length, 3, JSON.stringify(issues));
  assert.ok(issues.some((item) => item.message.includes("queryMissing")));
  assert.ok(issues.some((item) => item.message.includes("empty")));
  assert.ok(issues.some((item) => item.message.includes("getRemote")), "名称像 getter 的业务方法不能豁免");
  fs.unlinkSync(source);
  const contract = path.resolve(__dirname, "../files/.github/templates/examples/sale-order-master.contract.json");
  const plan = buildPlan(contract, { projectRoot: root });
  assert.strictEqual(plan.ok, true, JSON.stringify(plan.errors));
  const service = plan.actions.find((file) => file.rel.endsWith("SaleOrderMasterService.java"));
  const mapper = plan.actions.find((file) => file.rel.endsWith("SaleOrderMasterMapper.java"));
  assert.ok(service && mapper, "真实契约必须生成 Service 与 Mapper");
  assert.ok(service.content.includes("业务模块：order"));
  assert.ok(service.content.includes("以客户端 revision 原子更新"));
  assert.ok(service.content.includes("不能代替请求幂等"));
  assert.ok(mapper.content.includes("Mapper 不承担接口权限校验与事务编排"));
  assert.ok(!mapper.content.includes("默认 getById 由 Service.lambdaQuery"), "不得保留与执行代码不一致的历史说明");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log("✅ comments：正文、继承/属性豁免、真实契约模板职责与事务边界");
