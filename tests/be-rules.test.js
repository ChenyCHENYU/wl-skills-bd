"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { runBeRules } = require("../lib/be-rules");

function withFixture(files, callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-rules-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const file = path.join(root, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, "utf8");
    }
    callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function count(result, rule) {
  return result.issues.filter((value) => value.rule === rule).length;
}

withFixture({
  "controller/demo/BadController.java": `package x;
public class BadController {
    @PostMapping("save")
    public Object save() { return null; }
}`,
}, (root) => {
  const result = runBeRules(root);
  assert.strictEqual(count(result, "B1"), 1);
  assert.strictEqual(count(result, "B2"), 1);
});

withFixture({
  "controller/demo/ClassGuardController.java": `package x;
@PreAuthorize("@pms.authenticated()")
public class ClassGuardController {
    @Operation(summary = "save")
    @PostMapping("save")
    public Object save() { return null; }
}`,
}, (root) => assert.strictEqual(count(runBeRules(root), "B1"), 0));

withFixture({
  "controller/demo/PartialController.java": `package x;
public class PartialController {
    @PostMapping("save")
    public Object save() { return null; }
}`,
  ".be-rules-ignore": "B1:controller/demo/PartialController.java # SEC-123 公开接口已评审\n",
}, (root) => {
  const result = runBeRules(root);
  assert.strictEqual(count(result, "B1"), 0, "豁免 B1 不能触发 B1");
  assert.strictEqual(count(result, "B2"), 1, "豁免 B1 不能连带关闭 B2");
  assert.strictEqual(result.suppressed.length, 1);
});

withFixture({
  "resources/mapper/StarMapper.xml": `<mapper>
<!-- SELECT * FROM ignored -->
<select id="a">SELECT t.* FROM T t WHERE t.COMPANY_ID = #{companyId}</select>
<select id="b">SELECT COUNT(*) FROM T t WHERE t.COMPANY_ID = #{companyId}</select>
</mapper>`,
}, (root) => assert.strictEqual(count(runBeRules(root), "B3"), 1, "只报 t.*，不误报注释和 COUNT(*)"));

withFixture({
  "resources/mapper/SubstitutionMapper.xml": `<mapper><select id="x">SELECT ID FROM T WHERE ${"${ew.customSqlSegment}"}</select></mapper>`,
}, (root) => assert.strictEqual(count(runBeRules(root), "B4"), 1, "默认基线禁止 MyBatis 文本替换"));

withFixture({
  "resources/mapper/TenantMapper.xml": `<mapper>
<select id="bad">SELECT a.ID FROM A a JOIN B b ON a.ID=b.ID</select>
<select id="good">SELECT a.ID FROM A a WHERE a.COMPANY_ID = #{companyId}</select>
</mapper>`,
}, (root) => assert.strictEqual(count(runBeRules(root), "B7"), 1, "JOIN 不能绕过租户检查"));

withFixture({
  "config/TenantConfig.java": "class TenantConfig { TenantLineInnerInterceptor interceptor; }",
  "resources/mapper/TenantMapper.xml": `<mapper><select id="all">SELECT ID FROM T</select></mapper>`,
  ".wl-skills-bd/rules.local.json": JSON.stringify({ schemaVersion: 1, tenant: { mode: "interceptor", evidence: "config/TenantConfig.java" } }),
}, (root) => assert.strictEqual(count(runBeRules(root), "B7"), 0));

withFixture({
  "service/demo/WriteService.java": `package x;
public class WriteService {
    public void updateById(String id) { }
    public void note() {
        String text = "throw new RuntimeException(";
        // throw new RuntimeException("ignored");
    }
}`,
}, (root) => {
  const result = runBeRules(root);
  assert.strictEqual(count(result, "B5"), 1, "updateById 必须识别为写用例");
  assert.strictEqual(count(result, "B8"), 0, "字符串和注释不得误报 B8");
});

withFixture({
  "service/demo/TransactionalService.java": `package x;
@Transactional(rollbackFor = Exception.class)
public class TransactionalService {
    /** save */
    public void saveAll() { }
}`,
}, (root) => assert.strictEqual(count(runBeRules(root), "B5"), 0));

withFixture({
  "service/demo/BadExceptionService.java": `package x;
public class BadExceptionService {
    /** save */
    @Transactional(rollbackFor = Exception.class)
    public void save() { throw new RuntimeException("x"); }
}`,
}, (root) => assert.strictEqual(count(runBeRules(root), "B8"), 1));

withFixture({
  "service/demo/LongService.java": `package x;
public class LongService {
    public void complex(int x) {
${Array.from({ length: 85 }, (_, index) => `        if (x == ${index}) { x++; }`).join("\n")}
    }
}`,
}, (root) => {
  const result = runBeRules(root);
  assert.strictEqual(count(result, "B10"), 1);
  assert.strictEqual(count(result, "B11"), 1);
  const quick = runBeRules(root, { quick: true });
  assert.strictEqual(count(quick, "B10"), 0);
  assert.strictEqual(count(quick, "B11"), 0);
});

withFixture({
  "service/demo/NoDocService.java": `package x;
public class NoDocService {
    @Transactional
    public void save(String dto) { }
}`,
  "mapper/demo/NoDocMapper.java": `package x;
public interface NoDocMapper {
    String findById(
            String id);
}`,
}, (root) => {
  const result = runBeRules(root);
  assert.strictEqual(count(result, "B12"), 2, "Service 与多行 Mapper 方法都要检查 Javadoc");
});

withFixture({
  ".be-rules-ignore": "B1:**/*.java\n",
}, (root) => assert.strictEqual(count(runBeRules(root), "WLS_CONFIG"), 1, "无理由豁免必须失败"));

withFixture({}, (root) => {
  const result = runBeRules(root, { scanRel: "../outside" });
  assert.strictEqual(count(result, "WLS_CONFIG"), 1, "扫描路径越界必须失败");
  assert.strictEqual(result.stats.error, 1);
  assert.strictEqual(result.stats.total, result.stats.error + result.stats.warn + result.stats.info);
});

console.log("✅ be-rules：B1~B12、独立豁免、租户证据、误报保护和路径边界通过");

// ─── B13~B19 数据安全规则（v0.10）───

withFixture({
  "service/demo/RedisNoTtlService.java": `package x;
public class RedisNoTtlService {
    private RedisTemplate redis;
    public void cache(String k, String v) {
        redis.opsForValue().set(k, v);
    }
    public void safeCache(String k, String v) {
        redis.opsForValue().set(k, v, 30, TimeUnit.MINUTES);
    }
}`,
}, (root) => {
  const result = runBeRules(root);
  assert.strictEqual(count(result, "B13"), 1, "缺 TTL 的 set 应报 B13");
});

withFixture({
  "service/demo/RedisSelfLockService.java": `package x;
public class RedisSelfLockService {
    private StringRedisTemplate redis;
    public boolean lock(String k) {
        return Boolean.TRUE.equals(redis.opsForValue().setIfAbsent(k, "1"));
    }
}`,
}, (root) => {
  const result = runBeRules(root);
  assert.strictEqual(count(result, "B14"), 1, "setIfAbsent 两参数自实现锁应报 B14");
});

withFixture({
  "service/demo/RedisDangerousService.java": `package x;
public class RedisDangerousService {
    public void scan() {
        Set keys = redisTemplate.keys("*");
    }
    public void flush() {
        redisTemplate.execute("FLUSHDB");
    }
}`,
}, (root) => {
  const result = runBeRules(root);
  assert.ok(count(result, "B15") >= 2, "KEYS * 与 FLUSHDB 都应报 B15");
});

withFixture({
  "config/RedisConfig.java": `package x;
public class RedisConfig {
    public Object serializer() {
        return new JdkSerializationRedisSerializer();
    }
}`,
}, (root) => {
  const result = runBeRules(root);
  assert.strictEqual(count(result, "B16"), 1, "JdkSerializationRedisSerializer 应报 B16");
});

withFixture({
  "service/demo/PhysicalDeleteService.java": `package x;
public class PhysicalDeleteService {
    private BaseMapper mapper;
    public void purge(String id) {
        mapper.deleteById(id);
    }
    public void batch(java.util.List ids) {
        mapper.deleteBatchIds(ids);
    }
    public void truncate() {
        jdbcTemplate.execute("TRUNCATE TABLE X");
    }
}`,
}, (root) => {
  const result = runBeRules(root);
  assert.strictEqual(count(result, "B17"), 3, "deleteById/deleteBatchIds/TRUNCATE 都应报 B17");
});

withFixture({
  "resources/mapper/NoWhereMapper.xml": `<mapper>
<update id="resetAll">UPDATE T SET STATUS = 'X'</update>
<delete id="purgeAll">DELETE FROM T</delete>
<update id="ok">UPDATE T SET STATUS='X' WHERE ID=#{id}</update>
</mapper>`,
}, (root) => {
  const result = runBeRules(root);
  assert.strictEqual(count(result, "B18"), 3, "无 WHERE 或缺少租户谓词的 update/delete 应报 B18");
});

withFixture({
  "service/demo/BatchService.java": `package x;
public class BatchService {
    public void batch() {
        service.saveBatch(list, 5000);
    }
    public void defaultBatch() {
        service.saveBatch(list);
    }
}`,
}, (root) => {
  const result = runBeRules(root);
  assert.strictEqual(count(result, "B19"), 1, "saveBatch(list, 5000) 应报 B19，默认 saveBatch(list) 不报");
});

withFixture({
  "service/demo/SafeRedisService.java": `package x;
public class SafeRedisService {
    public void cache(RedisTemplate redis, String k, String v) {
        redis.opsForValue().set(k, v, 30, TimeUnit.MINUTES);
    }
    public RLock lock(RedissonClient client, String k) {
        return client.getLock(k);
    }
}`,
}, (root) => {
  const result = runBeRules(root);
  assert.strictEqual(count(result, "B13"), 0, "带 TTL 的 set 不应报 B13");
  assert.strictEqual(count(result, "B14"), 0, "Redisson RLock 不应报 B14");
});

console.log("✅ be-rules v0.10：B13~B19 Redis/敏感写/全表写/批量分批规则通过");

// ─── B14 扩展 + B20~B23 数据安全稳定性规则（v0.11）───

withFixture({
  "service/demo/LongLockService.java": `package x;
public class LongLockService {
    public void longTask(String k) {
        redisTemplate.opsForValue().setIfAbsent(k, "1", 1, TimeUnit.HOURS);
    }
    public void safeLock(String k) {
        redisTemplate.opsForValue().setIfAbsent(k, "1", 30, TimeUnit.SECONDS);
    }
}`,
}, (root) => {
  const result = runBeRules(root);
  assert.ok(count(result, "B14") >= 1, "setIfAbsent 1 HOURS 应报 B14（长 TTL 缺 watchdog）");
});

withFixture({
  "service/demo/TxMqService.java": `package x;
public class TxMqService {
    @Transactional(rollbackFor = Exception.class)
    public void saveAndSend() {
        baseMapper.insert(entity);
        rocketMQTemplate.syncSend("topic", "msg");
    }
    @Transactional(rollbackFor = Exception.class)
    public void saveAndHttp() {
        baseMapper.insert(entity);
        HttpUtil.createPost(url).body(data).execute();
    }
    public void noTx() {
        rocketMQTemplate.syncSend("topic", "msg");
    }
}`,
}, (root) => {
  const result = runBeRules(root);
  assert.ok(count(result, "B20") >= 2, "@Transactional 内 MQ/HTTP 各 1 个 B20");
});

withFixture({
  "service/demo/HttpNoTimeoutService.java": `package x;
public class HttpNoTimeoutService {
    public void call() {
        HttpResponse resp = HttpUtil.createPost(url).body(data).execute();
    }
    public void safeCall() {
        HttpResponse resp = HttpUtil.createPost(url).timeout(5000).body(data).execute();
    }
}`,
}, (root) => {
  const result = runBeRules(root);
  assert.strictEqual(count(result, "B21"), 1, "HttpUtil 无 timeout 应报 B21");
});

withFixture({
  "controller/demo/MixedSwaggerController.java": `package x;
import io.swagger.annotations.Api;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
@Api(value = "x")
@Tag(name = "x")
public class MixedSwaggerController {
    @Operation(summary = "save")
    @org.springframework.web.bind.annotation.PostMapping("save")
    public Object save() { return null; }
}`,
}, (root) => {
  const result = runBeRules(root);
  assert.ok(count(result, "B22") >= 1, "同类混用 Swagger 2 + OpenAPI 3 应报 B22 error");
});

withFixture({
  "controller/demo/LegacySwaggerController.java": `package x;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
@Api(value = "x")
public class LegacySwaggerController {
    @ApiOperation(value = "save")
    @org.springframework.web.bind.annotation.PostMapping("save")
    public Object save() { return null; }
}`,
}, (root) => {
  const result = runBeRules(root);
  const b22Issues = result.issues.filter((i) => i.rule === "B22");
  assert.ok(b22Issues.length >= 1, "纯 Swagger 2 Controller 应报 B22 warn");
  assert.strictEqual(b22Issues[0].severity, "warn", "纯 Swagger 2 是 warn 不是 error");
});

withFixture({
  "service/demo/OverInjectedService.java": `package x;
public class OverInjectedService {
    @org.springframework.beans.factory.annotation.Autowired
    private OrderService orderService;
    @org.springframework.beans.factory.annotation.Autowired
    private UserService userService;
    @org.springframework.beans.factory.annotation.Autowired
    private ProductService productService;
    @org.springframework.beans.factory.annotation.Autowired
    private InventoryService inventoryService;
    @org.springframework.beans.factory.annotation.Autowired
    private PromotionService promotionService;
    @org.springframework.beans.factory.annotation.Autowired
    private PaymentService paymentService;
    @org.springframework.beans.factory.annotation.Autowired
    private LogisticsService logisticsService;
    @org.springframework.beans.factory.annotation.Autowired
    private InvoiceService invoiceService;
    @org.springframework.beans.factory.annotation.Autowired
    private SmsService smsService;
    @org.springframework.beans.factory.annotation.Autowired
    private EmailService emailService;
    @org.springframework.beans.factory.annotation.Autowired
    private AuditService auditService;
}`,
}, (root) => {
  const result = runBeRules(root);
  assert.ok(count(result, "B23") >= 1, "11 个 @Autowired 注入应报 B23");
});

console.log("✅ be-rules v0.11：B14 扩展 + B20~B23 事务内 MQ/HTTP 超时/Swagger 混用/巨型 Service 规则通过");

withFixture({
  "src/main/resources/mapper/DangerMapper.xml": `<?xml version="1.0" encoding="UTF-8"?>
<mapper namespace="demo.DangerMapper">
  <update id="wipe">UPDATE DEMO SET STATUS = 0 WHERE 1=1</update>
  <delete id="physical">DELETE FROM DEMO WHERE COMPANY_ID = #{companyId}</delete>
</mapper>`,
  "src/main/java/demo/DangerRepository.java": `package demo;
class DangerRepository {
    void wipe(org.springframework.jdbc.core.JdbcTemplate jdbcTemplate) {
        jdbcTemplate.update("DELETE FROM DEMO WHERE 1=1");
    }
}`,
}, (root) => {
  const result = runBeRules(root);
  assert.ok(count(result, "B17") >= 2, "XML <delete> 和 JDBC DELETE FROM 必须识别为物理删除");
  assert.ok(count(result, "B18") >= 2, "XML/JDBC WHERE 1=1 必须识别为全表写");
});

console.log("✅ be-rules v0.14：XML/JDBC 物理删除、WHERE 1=1 与跨租户写漏报回归通过");
