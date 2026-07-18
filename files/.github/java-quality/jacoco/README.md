# JaCoCo 覆盖率门（J8）

`wl-quality` 使用 JaCoCo Maven Plugin 0.8.15，在 Java 8 上执行 agent、HTML/XML report 和 verify 阶段 check。

默认红线：

| 类路径 | 行覆盖率 | 分支覆盖率 |
|---|---:|---:|
| `*/service/*` | ≥ 70% | ≥ 60% |
| `*/controller/*` | ≥ 50% | 不设统一阈值 |

阈值作用于 CLASS，避免一个高覆盖类掩盖同层零覆盖类。DTO/VO/Entity/配置类不参与默认比例；业务项目可在复制的 profile 中增加排除项，但必须写明生成代码来源和理由，禁止用大范围 glob 让门禁失效。

## 多模块

默认规则在每个激活 `wl-quality` 的模块独立检查。父聚合项目如需总报告，应另配 `report-aggregate` 模块；聚合报告不能替代各服务模块的 check。

## 常见冲突

- 若 Surefire 已配置 `argLine`，必须保留 JaCoCo 注入的 `${argLine}`/late replacement，不能覆盖 agent 参数；
- 单测未执行或被 `skipTests` 跳过时没有有效覆盖数据，CI 不得以跳过测试方式发布；
- Lombok/编译器生成分支可能影响比例，先补真实用例，再对精确类做有理由排除。

官方 JaCoCo `check` 支持 BUNDLE/PACKAGE/CLASS 等 element，并可对 LINE/BRANCH 的 COVEREDRATIO 设置上下限。本包用真实 Java 8 Maven 夹具验证规则会执行并通过。
