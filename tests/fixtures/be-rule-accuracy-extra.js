"use strict";

// 每条规则独立运行，避免一个缺陷偶然由另一条规则代报。
const single = (rule, files, expectedFindings) => ({ id: `${rule}-positive`, rules: [rule], files,
  expectedRules: [rule], ...(expectedFindings ? { expectedFindings } : {}) });
const java = (name, content) => ({ [`src/main/java/demo/${name}.java`]: content });

module.exports = [
  single("B2", java("DemoController", "class DemoController {\n  @PostMapping(\"save\")\n  public Object save() { return null; }\n}")),
  single("B4", { "src/main/resources/mapper/DemoMapper.xml": "<mapper><select id=\"x\">SELECT ID FROM T WHERE ${ew.customSqlSegment}</select></mapper>" }),
  single("B6", Object.fromEntries(Array.from({ length: 21 }, (_, id) => [`src/main/java/demo/Demo${id}.java`, `class Demo${id} {}`]))),
  single("B7", { "src/main/resources/mapper/DemoMapper.xml": "<mapper><select id=\"x\">SELECT ID FROM T</select></mapper>" }),
  single("B8", java("DemoService", "class DemoService { @Transactional public void save() { throw new RuntimeException(\"x\"); } }")),
  single("B9", java("LongClass", `class LongClass {\n${"int x;\n".repeat(501)}}`)),
  single("B10", java("LongMethod", `class LongMethod {\n  public void work() {\n${"    int x = 1;\n".repeat(85)}  }\n}`)),
  single("B11", java("Complex", `class Complex {\n  public void work(int x) {\n${Array.from({ length: 11 }, (_, id) => `    if (x == ${id}) x++;`).join("\n")}\n  }\n}`)),
  single("B12", java("NoDocService", "class NoDocService {\n  public void save(String value) {}\n}")),
  single("B14", java("RedisLockService", "class RedisLockService { boolean lock(String k) { return redis.opsForValue().setIfAbsent(k, \"1\"); } }")),
  single("B15", java("RedisDangerService", "class RedisDangerService { void flush() { redisTemplate.execute(\"FLUSHDB\"); } }")),
  single("B16", java("RedisConfig", "class RedisConfig { Object serializer() { return new JdkSerializationRedisSerializer(); } }")),
  single("B19", java("BatchService", "class BatchService { void batch() { service.saveBatch(list, 5000); } }")),
  single("B20", java("TxService", "class TxService {\n  @Transactional(rollbackFor = Exception.class)\n  public void saveAndSend() {\n    baseMapper.insert(entity);\n    rocketMQTemplate.syncSend(\"topic\", \"msg\");\n  }\n}")),
  single("B22", java("SwaggerController", "import io.swagger.annotations.Api; import io.swagger.v3.oas.annotations.Operation; @Api(value=\"x\") class SwaggerController { @Operation(summary=\"x\") @PostMapping(\"x\") public void save() {} }")),
  single("B23", java("InjectedService", `class InjectedService {\n${Array.from({ length: 11 }, (_, id) => `@org.springframework.beans.factory.annotation.Autowired\nprivate Dependency${id} dependency${id};`).join("\n")}\n}`)),
  single("B24", java("SecureController", "class SecureController { @PreAuthorize(\"hasAuthority('demo')\") @GetMapping(\"x\") public void query() {} }"),
    [{ rule: "B24", file: "src/main/java/demo/SecureController.java", line: 1, severity: "error" }]),
  single("B26", {
    "src/main/java/demo/mapper/DemoMapper.java": "package demo.mapper; public interface DemoMapper extends BaseMapper<Demo> {}",
    "src/main/java/demo/Application.java": "package demo; @MapperScan(\"demo.**\") class Application {}",
    "src/main/resources/mapper/DemoMapper.xml": "<mapper namespace=\"demo.mapper.MissingMapper\"></mapper>",
  }),
  single("B27", { "pom.xml": "<project><parent><groupId>com.jhict</groupId><artifactId>jh4j-cloud</artifactId><version>3.1.0</version></parent><dependencyManagement><dependencies><dependency><groupId>com.alibaba</groupId><artifactId>easyexcel</artifactId><version>3.1.0</version></dependency></dependencies></dependencyManagement><dependencies><dependency><groupId>com.alibaba</groupId><artifactId>easyexcel</artifactId><version>2.2.5</version></dependency></dependencies></project>" }),
  single("B28", {
    "pom.xml": "<project><parent><groupId>com.jhict</groupId><artifactId>jh4j-cloud</artifactId><version>3.1.0</version></parent></project>",
    "src/main/java/demo/UnsafeHandler.java": "package demo; import com.baomidou.mybatisplus.core.handlers.MetaObjectHandler; @Component public class UnsafeHandler implements MetaObjectHandler { public void insertFill(MetaObject value) {} public void updateFill(MetaObject value) {} }",
  }),
  single("B29", java("SamplePageDTO", "class SamplePageDTO { private static final long DEFAULT_PAGE_SIZE = 20L; private Long current = 1L; @Max(1000) private Long size = DEFAULT_PAGE_SIZE; }"),
    Array.from({ length: 2 }, () => ({ rule: "B29", file: "src/main/java/demo/SamplePageDTO.java", line: 1, severity: "error" }))),
  single("B30", {
    "src/main/java/demo/FirstController.java": "package demo;\n@RequestMapping(\"/demo\")\nclass FirstController {\n  @PostMapping(\"/save\")\n  public void save() {}\n}",
    "src/main/java/demo/SecondController.java": "package demo;\n@RequestMapping(\"/demo\")\nclass SecondController {\n  @PostMapping(\"/save\")\n  public void save() {}\n}",
  }, [{ rule: "B30", file: "src/main/java/demo/SecondController.java", line: 5, severity: "error" }]),
  single("B31", { "docs/db-spec/demo.json": JSON.stringify({ tables: [{ name: "demo", fields: [{ name: "is_enabled", dbType: "tinyint(1)", nullable: false, comment: "启用标志" }] }] }) },
    [{ rule: "B31", file: "docs/db-spec", line: 1, severity: "warn" }]),
];
