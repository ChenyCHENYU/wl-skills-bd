# 《项目开发手册》覆盖与增强矩阵

> 本文是 `wl-skills-bd` 的团队基线追溯入口。根目录《项目开发手册》是最低强制要求；`bd` 在不改变团队口径的前提下补充安全、可验证和可回滚闭环。分支命名、合并链和仓库保护策略由团队单独管控，不属于本包执行范围。

## 覆盖矩阵

| 手册要求 | bd 落点 | 可执行闭环 |
|---|---|---|
| 工程名、根包名 | `standards/02` | contract/config doctor 核对根包与业务中心 |
| `wl-common` / `wl-apis` / 业务工程职责 | `standards/02` | 生成前确认共享 API 或单服务模式，不强制依赖其他 skill 包 |
| 业务子域为顶级目录 | `standards/02` + Java/XML 模板 | `{rootPackage}.{module}.controller/service/mapper` |
| Entity 继承 `CoreEntity` | `standards/07` + Entity 模板 | 编译契约测试和 ArchUnit |
| Service 继承 `JhServiceImpl` | `standards/05` + Service 模板 | Java 编译契约测试 |
| API/DTO 归属 `wl-apis`，单服务可例外 | `standards/02` + contract `output` | `modelJava` / `serviceJava` 可独立配置，契约无需 design/kit 也可完成后端闭环 |
| 端口划分 | `standards/02` / `24` | config doctor 校验包名与端口区间 |
| 数据库物理划分 | `standards/02` / `12` / `24` | contract `dbCluster` + doctor 校验 datasource |
| 文件粒度不超过 20 | `standards/02` | B 规则目录阈值检查 |
| 提交信息规范 | `standards/18` | 内置 commit validator + 版本受控 commit-msg Hook + CI range 校验；不包含分支治理 |

## 超出手册的强化基线

- 接口：请求 DTO 是唯一传输模型，分页、批量、业务命令与 `wl-api-contract` 可机械比对。
- 服务：租户、软删除和 `revision` 必须进入同一条原子写条件，受影响行数必须等于 1。
- 数据库：Flyway 版本全局唯一且已有 migration 不可改写；ALTER 执行 Expand/Backfill/Contract 分阶段管控。
- 写入链：所有工程文件写入都遵循 preview → planHash → confirm → 原子写入 → 复验 → 可回滚；`pre/prod/production` 默认阻断。
- 安全：禁止全表写、物理删除、请求传租户、明文密钥、无幂等和未审批高危 DDL。
- 质量：Node 契约测试、生成 Java 编译测试、Maven 质量门、扫描规则及发布包内容校验共同构成发布门。

## 变更原则

1. 手册条款变更时，先更新本矩阵，再同步 standards、contract、templates、rules 和 tests。
2. 新增强化项不得削弱手册要求；引入不兼容变更必须升级契约版本并记录迁移方法。
3. 团队未定稿的业务归属不得由生成器猜测，必须显式填写并由 doctor 提示复核。
