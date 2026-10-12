---
name: entity-codegen
description: |
  基于通过 Schema 校验的 wl-contract.json 确定性生成 Entity、CreateDTO、UpdateDTO、PageDTO、VO、PageVO。
  典型触发：「生成实体」「生成 DTO/VO」「根据契约生成模型」「补模型层」
metadata:
  status: "✅ 已落地"
  stage: "③ 模型生成"
  triggers: "生成实体、生成 Entity、生成 DTO、生成 VO"
---

# entity-codegen

模型不是从 DDL 或自然语言单独反推，而是与 Controller、Service、Mapper、DDL、测试和协作产物一起由同一契约生成。

## Pre-flight 模型声明

```text
模型声明：🚀 已触发技能 entity-codegen/SKILL.md
模型声明：✅ 已读取 standards/02-project-structure.md
模型声明：✅ 已读取 standards/03-naming.md
模型声明：✅ 已读取 standards/07-entity-dto-vo.md
模型声明：✅ 已读取 standards/12-database-ddl.md
✅ 已校验 wl-contract.json
```

## 前置条件

- `profile/rootPackage/module/entity/database/fields` 已明确；
- 每个业务字段的 Java 类型、DB 类型、中文含义和可写/查询/响应白名单已确认；
- `companyId/deleteFlag/revision` 和六个 CoreEntity 字段不在普通业务 `fields` 中重复声明；
- 类型只使用当前 Schema 白名单；未知类型先扩 Schema/Profile/模板和测试，不在单个资源临时拼代码。

## 执行

```bash
wl-skills-bd codegen validate wl-contract.json
wl-skills-bd codegen plan wl-contract.json --json
```

模型是 `17+N` 个整体产物的一部分。评审完整计划后才执行 apply，禁止只手工复制其中一半导致模型与 SQL/接口漂移。

## 六个模型的边界

| 产物 | 输入/输出 | 治理字段 |
|---|---|---|
| Entity | 持久化 | 继承 CoreEntity 六字段，显式 `deleteFlag/revision` |
| CreateDTO | 新增请求 | 禁止 id/companyId/deleteFlag/revision/审计字段 |
| UpdateDTO | 修改请求 | 强制 id/revision；业务字段采用 Patch 语义 |
| PageDTO | 查询请求 | 只含 `queryMode != none` 的字段，全部可选 |
| VO | 详情响应 | 业务 `detail=true` 字段 + id/revision |
| PageVO | 分页响应 | 业务 `list=true` 字段 + id；默认不暴露治理字段 |

VO/PageVO 不继承 Entity，避免租户、软删和内部审计字段意外出现在 API。`revision` 只在详情→更新并发闭环中暴露。

请求及确需 Java 消费端反序列化的传输模型必须具备与实际 Jackson 配置匹配的入口；仅服务端序列化的返回模型无需因此改变可变性。默认生成的 VO/PageVO 使用非 `final` 字段、setter 和显式 `@NoArgsConstructor`；不可变模型只有在逐参数声明 `@JsonCreator/@JsonProperty` 并通过真实 `ObjectMapper` 往返测试后才允许使用。`@AllArgsConstructor` 不能单独充当反序列化契约（B32：请求缺入口 error；返回模型消费者未验证时 warn）。

## 字段规则

- String 创建必填用 `@NotBlank`，非 String 用 `@NotNull`；`maxLength` 生成 `@Size`；
- PageDTO 查询字段只来自契约，`eq/like` 显式决定 SQL 运算；
- Oracle/MySQL DB 类型由契约保存并经方言校验，不从 Java 类型静默猜精度；
- `List<String>/List<Long>` 只用于 API 模型，不得直接映射单一普通列；
- Java 8 使用 `javax.validation` 和当前 Profile 声明的 OpenAPI 3 注解。
- `@TableField/@TableLogic` 的列名、有效值和删除值必须由当前 profile 渲染；项目覆盖不得只改 DDL。
- 项目差异只写 `.wl-skills-bd/profile.local.json`；禁止编辑受管 `profiles/*.json`，否则 installer 会正确报告漂移。
- 字段长度调整必须同步 `constraints/maxLength`、DB 类型、Create/Update DTO、协作契约与业务文档；扩大数据库列但保留旧 `@Size`，或只放开 DTO 但数据库仍窄，均应阻断。查询 DTO 仍只采用显式 `queryConstraints`，不得机械继承写入长度。

## 验证

```bash
wl-skills-bd validate <生成目录> --strict
mvn verify -Pwl-quality
```

包自身的 Java 8 编译夹具会编译六个模型及其消费者；业务工程仍需用真实依赖验证。

## 禁止

- 单个 DTO 同时承担创建、更新和查询；
- 请求 DTO 接收 companyId 或客户端指定软删值；
- VO 继承 Entity；
- UpdateDTO 无 revision，或详情不返回 revision；
- 直接编辑模板生成物却不更新契约并重新 plan。

## 完成摘要

报告契约 ID、六个模型路径、planHash、冲突数和真实验证命令/结果，不报告“已生成五件套”或预估质量。

## 注释交付

读取 `../../../standards/19-design.md` §9 的单一权威规范。对本次新建/实质修改的类和业务方法说明实际模块、职责、租户/事务/版本与副作用边界；保留有效历史。事实不足列 gap，不能从方法名编造幂等或异常。结合契约复核业务语义，分别报告 B12 正文与实际 Checkstyle 格式结果；同 runId 回查真实执行证据。无需兄弟包或 harness。


## 精选静态质量约束

生成或实质修改 Java 前读取 `../../../standards/15-code-quality.md` 和 `../../../standards/17-bug-prevention.md` 的质量/所有权边界：机器码大小写使用显式 Locale；不硬编码密钥或 IV；共享静态集合不可借固定长度 List 暴露可写状态。请求模型按契约支持 Jackson，只有跨对象、线程或异步所有权时才确定防御性复制与元素策略，不能把 Lombok setter 一概整改为不可变模型。

Spring 构造注入保持共享协作者身份，不为 EI_EXPOSE_REP2 深拷贝 bean；非法配置时拒绝启动保持。检查同一任务的真实 J2/J3/J4 范围及回执，不把 B 规则执行或“已读取规范”的模型声明当作 PMD/SpotBugs 已执行。没有编译/分析证据的项明确未验证。详见 `../../../java-quality/codecc-triage.md`，本包不要求 Gate/scanner/Harness 运行时依赖。
