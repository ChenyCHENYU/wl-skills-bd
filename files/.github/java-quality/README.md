# Java 质量门

本目录维护共享 Java 8 规则。0.40.0 的模式分离与精选扫描规则避免把风格硬失败、真实缺陷和外部系统测试混在同一作业。静态扫描不改变业务源码，构建和测试仍需隔离 Runner；模板不是网络隔离措施。

| 编号 | 工具 | 职责 | 执行建议 |
|---|---|---|---|
| J1 | ArchUnit 1.4.2 | Controller/Service/Mapper/Entity 依赖方向 | 独立单元/架构作业；断言失败阻断 |
| J2 | Checkstyle 3.6.0 | 命名、Javadoc、规模、风格 | 存量先报告治理，已批准严格规范可硬门 |
| J3 | Maven PMD Plugin 3.28.0 / PMD 7.17 | 资源、缺陷、复杂度、性能 | Gate 按规则分级，确定缺陷保持阻断 |
| J4 | SpotBugs 4.8.6.8 | Java 8 字节码缺陷分析 | 类别/置信度分级；分析异常与缺类不可放行 |
| J5 | Spotless 2.30.0 | AOSP 格式和 UNIX 换行 | 严格模式 check；存量格式整改独立进行，不在检查中 apply |
| J6 | P3C 2.1.1 / PMD 6 | 存量规约审计 | 独立 profile，不与 PMD 7 同跑 |
| J7 | Knife4j/OpenAPI | 运行时接口文档 | 按运行验收登记，静态门不代替 |
| J8 | JaCoCo 0.8.15 | Service/Controller 类级覆盖率 | 独立单元作业；底线不可伪造/基线化 |

## 接入

平台维护者审查 POM 差异后复制所需 profile，保留 `.github/java-quality/` 规则目录。业务项目不得直接批量覆盖 POM；升级模板也不会自动修改 POM。模式与命令见 [Maven 模板](maven-snippets/README.md)。

- 存量项目：`wl-quality-audit` 仅生产静态报告，Gate `java-xml` 集中转换，不在各项目复制解析脚本。
- 单元/架构测试：`wl-quality-unit`，复制 `archunit/LayerRulesTest.java` 并替换 `{{rootPackage}}`，登记实际业务必测。单元命名/目录须审查，不依靠名称断言安全。
- 已批准严格规范：`wl-quality` 保留原 Checkstyle/PMD/SpotBugs/Spotless/JaCoCo 硬失败。

规则路径使用 `${maven.multiModuleProjectDirectory}/.github/java-quality/...`。从仓库根调用 Maven；包装器、`-f`、多模块作业需明确绑定该根。每个适用子模块产出自己的报告，聚合 POM 不算已扫描业务模块。

## 测试边界

共享单元模板只选择 `*UnitTest`、`unit/` 内 `*Test`、`LayerRulesTest`，排除 Flow、Integration、IT、integration/ 和 mq/。未归类的已有 `*Test` 保留在待验收清单，逐项审查后纳入批准的单元/集成集合；不得通过 `-Dtest=*Test` 绕过选择，也不得以只有 ArchUnit 通过代替核心业务测试。零用例失败；JUnit 4 项目先核实 Surefire provider/Vintage 引擎及实际 testcase，禁止把未发现的用例当成功。

外部集成测试在独立无生产凭据、限制出网的 Runner 中运行，使用临时数据库/Broker 或独立 vhost、队列和数据范围。不得向共享队列发布或自动确认无关消息。Release 必需的集成/端到端证据仍要验收；静态审计刻意不运行测试，不能提供测试通过证明。

## 分级和历史治理

`enforceWarnings: false` 只能控制 Gate，不覆盖原生 Maven check 的硬失败。采用 audit 报告目标，再由 Gate `java-xml` 按规则分级；不使用 `|| true`、跳过必需检查或自动建全量基线。PMD 确定缺陷、高/中置信度 SpotBugs 正确性/安全缺陷、编译和关键测试仍阻断。普通风格/复杂度及待核实问题形成 warning，有负责人和期限。缺文件、坏报告、分析异常、依赖缺类均 invalid。

本包可独立运行，不要求安装 Gate。若接入 Gate，组织风险映射、基线与豁免由 Gate 维护，本包不另存可执行的组织风险表。原生告警和成员身份须保留；Spring 协作引用不能机械复制，DTO/VO 的可变边界须按消费者复核，不能按类级注解吞掉所有告警。具体约束见 [扫描规则决策](codecc-triage.md)。本包 B32：请求缺入口 error；未知消费者的返回 DTO warn，仅序列化模型无需修改可变性，实际 Java 消费链用真实 Jackson 配置验证。

## PMD 7 与 P3C 隔离

`p3c-pmd:2.1.1` 基于 PMD 6.15，PMD 插件 3.28.0 使用 PMD 7.17。`wl-p3c-legacy` 单独使用插件 3.21.2/PMD 6，且 failOnViolation=false；不得与任何 PMD 7 profile 在同一次调用激活。两个生态的类/API 冲突不能靠忽略退出码处理。

## 包自身验证（源码维护者）

以下命令在本包源码仓库执行；npm 安装包只分发业务所需资产，不包含维护者验证脚本。业务项目按已审查的 Maven Profile 执行检查。

```bash
npm run verify:quality-config
npm run verify:quality-maven
npm run verify:quality-codecc
```

Maven 验证只在临时工程中进行，测试单元/架构、覆盖率、J2～J5，以及生成源码和注释正反例；新增本地哨兵测试若被错误选中会直接失败，不连接外部系统。当前运行结果见本轮验证记录，包自测不等于真实项目/内网流水线验收。

`verify:quality-codecc` 复用共享 audit profile，在临时 Java 8 工程中实跑 PMD 的显式 Locale、硬编码密钥、固定 IV 正反例，SpotBugs 的输入/输出可变引用，以及集合所有权行为。不依赖 code-scan-kit，不执行真实业务 POM，也不把生成前的规范读取当作扫描通过。
