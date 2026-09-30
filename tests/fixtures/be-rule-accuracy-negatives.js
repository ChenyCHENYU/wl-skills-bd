"use strict";

const safe = (rule, files) => ({ id: `${rule}-negative`, rules: [rule], files, expectedRules: [] });
const java = (name, content) => ({ [`src/main/java/demo/${name}.java`]: content });

module.exports = [
  safe("B2", java("DemoController", "class DemoController { @Operation(summary=\"save\") @PostMapping(\"save\") public Object save() { return null; } }")),
  safe("B4", { "src/main/resources/mapper/DemoMapper.xml": "<mapper><select id=\"x\">SELECT ID FROM T WHERE ID=#{id}</select></mapper>" }),
  safe("B6", Object.fromEntries(Array.from({ length: 20 }, (_, id) => [`src/main/java/demo/Demo${id}.java`, `class Demo${id} {}`]))),
  safe("B7", { "src/main/resources/mapper/DemoMapper.xml": "<mapper><select id=\"x\">SELECT ID FROM T WHERE COMPANY_ID=#{companyId}</select></mapper>" }),
  safe("B8", java("DemoService", "class DemoService { @Transactional public void save() { throw new BusinessException(\"x\"); } }")),
  safe("B9", java("LongClass", `class LongClass {\n${"int x;\n".repeat(300)}}`)),
  safe("B10", java("LongMethod", `class LongMethod {\n  public void work() {\n${"    int x = 1;\n".repeat(60)}  }\n}`)),
  safe("B11", java("Complex", `class Complex { void work(int x) { ${Array.from({ length: 5 }, (_, id) => `if (x == ${id}) x++;`).join(" ")} } }`)),
  safe("B12", java("DocumentedService", "class DocumentedService { /** 保存。 */ public void save(String value) {} }")),
  safe("B14", java("LockService", "class LockService { void lock() { redissonClient.getLock(\"key\").lock(); } }")),
  safe("B15", java("RedisService", "class RedisService { void read() { redisTemplate.opsForValue().get(\"key\"); } }")),
  safe("B16", java("RedisConfig", "class RedisConfig { Object serializer() { return new StringRedisSerializer(); } }")),
  safe("B19", java("BatchService", "class BatchService { void batch() { service.saveBatch(list, 1000); } }")),
  safe("B20", java("TxService", "class TxService { @Transactional(rollbackFor = Exception.class) void save() { baseMapper.insert(entity); } }")),
  safe("B22", java("OpenApiController", "import io.swagger.v3.oas.annotations.Operation; class OpenApiController { @Operation(summary=\"x\") public void read() {} }")),
  safe("B23", java("InjectedService", `class InjectedService {\n${Array.from({ length: 10 }, (_, id) => `@Autowired private Dependency${id} dependency${id};`).join("\n")}\n}`)),
  safe("B24", {
    ...java("SecureController", "class SecureController { @PreAuthorize(\"hasAuthority('demo')\") @GetMapping(\"x\") public void query() {} }"),
    ...java("SecurityConfig", "@EnableGlobalMethodSecurity(prePostEnabled = true) class SecurityConfig {}"),
  }),
  safe("B26", {
    "src/main/java/demo/mapper/DemoMapper.java": "package demo.mapper; @Mapper public interface DemoMapper extends BaseMapper<Demo> {}",
    "src/main/resources/mapper/DemoMapper.xml": "<mapper namespace=\"demo.mapper.DemoMapper\"></mapper>",
  }),
  safe("B27", { "pom.xml": "<project><parent><groupId>com.jhict</groupId><artifactId>jh4j-cloud</artifactId><version>3.1.0</version></parent><dependencies><dependency><groupId>com.alibaba</groupId><artifactId>easyexcel</artifactId></dependency></dependencies></project>" }),
  safe("B28", java("PlatformConfig", "@Component class PlatformConfig { void configure() {} }")),
  safe("B29", java("SamplePageDTO", "class SamplePageDTO { private static final long DEFAULT_PAGE_SIZE = 10L; private Long current = 1L; @Max(200) private Long size = DEFAULT_PAGE_SIZE; }")),
  safe("B30", {
    ...java("FirstController", "@RequestMapping(\"/demo\") class FirstController { @GetMapping(\"/item\") public void read() {} }"),
    ...java("SecondController", "@RequestMapping(\"/demo\") class SecondController { @PostMapping(\"/item\") public void save() {} }"),
  }),
  safe("B31", { "docs/db-spec/demo.json": JSON.stringify({ tables: [] }) }),
];
