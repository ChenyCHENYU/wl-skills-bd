"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const TEMPLATE_DIR = path.join(ROOT, "files", ".github", "templates");

function read(name) {
  return fs.readFileSync(path.join(TEMPLATE_DIR, name), "utf8");
}

const required = [
  "Entity.java.tmpl",
  "CreateDTO.java.tmpl",
  "UpdateDTO.java.tmpl",
  "PageDTO.java.tmpl",
  "VO.java.tmpl",
  "PageVO.java.tmpl",
  "Controller.java.tmpl",
  "Service.java.tmpl",
  "Mapper.java.tmpl",
  "Mapper.xml.tmpl",
  "Migration.sql.tmpl",
  "Rollback.md.tmpl",
  "ServiceTest.java.tmpl",
  "ControllerTest.java.tmpl",
  "OperationRequestDTO.java.tmpl",
  "DdlPreview.md.tmpl",
];

for (const name of required) {
  assert.ok(fs.existsSync(path.join(TEMPLATE_DIR, name)), `缺少模板 ${name}`);
}

const entity = read("Entity.java.tmpl");
assert.match(entity, /extends CoreEntity/);
assert.match(entity, /@TableLogic[\s\S]*private Integer isDelete/);
assert.match(entity, /@Version[\s\S]*private Integer revision/);

const vo = read("VO.java.tmpl");
const pageVo = read("PageVO.java.tmpl");
assert.doesNotMatch(vo, /extends\s+\{\{Entity\}\}/, "VO 禁止继承 Entity");
assert.doesNotMatch(pageVo, /extends\s+\{\{Entity\}\}/, "PageVO 禁止继承 Entity");

const controller = read("Controller.java.tmpl");
assert.match(controller, /ApiResult<JhPage<\{\{Entity\}\}PageVO>>/);
assert.doesNotMatch(controller, /JhPage<List</, "分页不能二次嵌套 List");
assert.doesNotMatch(controller, /web\.bind\.annotation\.\*/, "模板禁止通配符 import");
assert.match(controller, /public ApiResult<String> save\(/);
assert.match(controller, /\{\{pagePermission\}\}/);
assert.doesNotMatch(controller, /permissionPrefix\}\}_query_page/);

const service = read("Service.java.tmpl");
assert.match(service, /AuthUtil\.getLoginCompanyId\(\)/);
assert.match(service, /EntityUtil\.setCreateProp\(entity\)/);
assert.doesNotMatch(service, /IdWorker|deleteBatchIds/, "默认模板禁止重复生成 ID 或物理删除");
assert.match(service, /inserted == 1/);
assert.match(service, /updated == 1/);
assert.doesNotMatch(service, /baseMapper\.updateById/, "写操作不得依赖未验证的插件式乐观锁");
assert.match(service, /<wl-custom name="export">/);
assert.match(service, /<wl-custom name="relation:\{\{name\}\}">/);

const serviceTest = read("ServiceTest.java.tmpl");
assert.match(serviceTest, /<wl-custom name="tests">/);

const mapperXml = read("Mapper.xml.tmpl");
assert.match(mapperXml, /COMPANY_ID\s*=\s*#\{companyId\}/);
assert.match(mapperXml, /AND IS_DELETE = 1[\s\S]*AND REVISION = #\{expectedRevision\}/, "原子更新必须同时约束有效标记和版本");
const executableMapperXml = mapperXml.replace(/<!--[\s\S]*?-->/g, "");
assert.doesNotMatch(executableMapperXml, /SELECT\s+\*/i);

const exceptionStandard = fs.readFileSync(
  path.join(ROOT, "files", ".github", "standards", "08-exception.md"),
  "utf8",
);
assert.match(exceptionStandard, /\| 2000 \| 成功 \|/);

console.log(`✅ template contract：${required.length} 个模板与 jh4j/安全契约一致`);
