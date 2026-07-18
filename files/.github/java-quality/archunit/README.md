# ArchUnit 分层规则（J1）

`LayerRulesTest.java` 物化五条规则：

1. Controller 不依赖 Mapper；
2. Service 不反向依赖 Controller；
3. Entity 不依赖 Controller/Service；
4. `@RestController` 只能位于 controller 包；
5. `@Mapper` 只能位于 mapper 包。

将模板复制到 `src/test/java/<rootPackage>/arch/`，替换两处 `{{rootPackage}}`，并从 `quality-profile.xml` 接入 `archunit-junit5:1.4.2`：

```bash
mvn test -Dtest=LayerRulesTest -Pwl-quality
```

每条规则都显式 `allowEmptyShould(true)`，因此模型模块或无 Controller 的子模块不会因为“没有匹配类”误失败；一旦存在匹配层，实际依赖违规仍会失败。包自身 Maven 夹具会真实运行全部五条规则。

存量违规不能用全局关闭处理。应拆分依赖；确需阶段治理时，使用 ArchUnit freeze 机制并把基线文件纳入评审。
