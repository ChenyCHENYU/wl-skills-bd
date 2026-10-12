# Maven 质量 profile

0.40.0 提供独立执行模式；同一调用只选一种。按项目栈审查 POM、父子插件继承和测试引擎，复制 `<profile>` 到父 POM 的 `<profiles>`；不会自动覆盖业务 POM。

| 模板 | 用途 |
|---|---|
| quality-audit-profile.xml | wl-quality-audit：存量项目静态报告生产，不绑定生命周期；显式禁止测试 |
| quality-unit-profile.xml | wl-quality-unit：单元/架构测试、JaCoCo；不绑定风格硬门 |
| quality-profile.xml | wl-quality：已批准完整严格门，J1/J2/J3/J4/J5/J8；单元选择规则同 unit |
| p3c-legacy-profile.xml | wl-p3c-legacy：PMD 6/P3C 独立审计，不与 PMD 7 混跑 |

```bash
# 只生产静态报告，编译/分析器异常仍非零退出；单模块示例。
mvn -B -ntp -Pwl-quality-audit compile checkstyle:checkstyle pmd:pmd spotbugs:spotbugs
# 独立单元/架构测试及覆盖率；无测试不能视作成功。
mvn -B -ntp -Pwl-quality-unit verify
# 已验收严格规范的项目使用。
mvn -B -ntp -Pwl-quality verify
```

Gate 0.5.2 源码新增显式共享生产者：各 java-xml 声明同一 producer、相同的上述组合 command 与 timeoutMs，一轮只执行一次生产；同组全部旧 XML 先清理，任何新报告缺失或生产异常仍 invalid。下一轮重新执行，不复用跨作业旧报告。配置片段见 [Gate Java 静态检查](https://github.com/ChenyCHENYU/wl-skills-gate/blob/main/templates/quality/java-static-checks.yml)；该模板也随 Gate 包分发；本包独立使用不要求安装 Gate。未使用 producer 的检查仍各自执行 command。若在前一个 CI 作业生成报告，不能直接把旧文件摄入受控 Gate，需由受控生产/传输方案绑定真实作业与 SHA；本包不提供该平台查询。Gate 内建 java-xml 处理 Checkstyle、PMD、SpotBugs；多个模块逐项登记报告和覆盖范围，不只验证聚合 POM。

配置读取 `${maven.multiModuleProjectDirectory}/.github/java-quality`。在仓库根执行；包装命令或特殊 `-f` 调用显式传 `-Dmaven.multiModuleProjectDirectory=<实际仓库根>`。依赖解析失败仍按失效处理。

单元 include/exclude 的依据见 [Surefire 官方说明](https://maven.apache.org/surefire/maven-surefire-plugin/examples/inclusion-exclusion.html)。默认 Surefire 会选择普通 `*Test`，因此模板覆盖为批准的单元集合，并排除 Flow/Integration/IT/MQ。尚未归类的存量 `ServiceTest`/`ControllerTest` 等不算已通过：审查是否连接外部系统，再纳入受控集合；生成测试骨架也需人工补齐与纳入必测清单。`-Dtest` 可覆盖选择，应禁止在受控作业任意注入。

命名白名单不能保证测试无网络副作用。单元 Runner 不给共享系统凭据并限制出网；集成测试单独使用临时环境、专用队列和清理策略。审计 profile 不产生测试/覆盖率证据，不能单独满足发布门。
