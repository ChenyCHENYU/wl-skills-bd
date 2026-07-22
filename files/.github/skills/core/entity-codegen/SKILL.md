---
name: entity-codegen
description: |
  基于通过 Schema 校验的 wl-contract.json 确定性生成 Entity、CreateDTO、UpdateDTO、PageDTO、VO、PageVO。
  典型触发：「生成实体」「生成 DTO/VO」「根据契约生成模型」「补模型层」
status: ✅ 已落地
stage: ③ 模型生成
---

# entity-codegen

模型不是从 DDL 或自然语言单独反推，而是与 Controller、Service、Mapper、DDL、测试和协作产物一起由同一契约生成。

## Pre-flight 声明

```text
🚀 已触发技能 entity-codegen/SKILL.md
✅ 已读取 standards/02-project-structure.md
✅ 已读取 standards/03-naming.md
✅ 已读取 standards/07-entity-dto-vo.md
✅ 已读取 standards/12-database-ddl.md
✅ 已校验 wl-contract.json
```

## 前置条件

- `profile/rootPackage/module/entity/database/fields` 已明确；
- 每个业务字段的 Java 类型、DB 类型、中文含义和可写/查询/响应白名单已确认；
- `companyId/isDelete/revision` 和六个 CoreEntity 字段不在普通业务 `fields` 中重复声明；
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
| Entity | 持久化 | 继承 CoreEntity 六字段，显式 `isDelete/revision` |
| CreateDTO | 新增请求 | 禁止 id/companyId/isDelete/revision/审计字段 |
| UpdateDTO | 修改请求 | 强制 id/revision；业务字段采用 Patch 语义 |
| PageDTO | 查询请求 | 只含 `queryMode != none` 的字段，全部可选 |
| VO | 详情响应 | 业务 `detail=true` 字段 + id/revision |
| PageVO | 分页响应 | 业务 `list=true` 字段 + id；默认不暴露治理字段 |

VO/PageVO 不继承 Entity，避免租户、软删和内部审计字段意外出现在 API。`revision` 只在详情→更新并发闭环中暴露。

## 字段规则

- String 创建必填用 `@NotBlank`，非 String 用 `@NotNull`；`maxLength` 生成 `@Size`；
- PageDTO 查询字段只来自契约，`eq/like` 显式决定 SQL 运算；
- Oracle/MySQL DB 类型由契约保存并经方言校验，不从 Java 类型静默猜精度；
- `List<String>/List<Long>` 只用于 API 模型，不得直接映射单一普通列；
- Java 8 使用 `javax.validation` 和当前 Profile 声明的 OpenAPI 3 注解。
- `@TableField/@TableLogic` 的列名、有效值和删除值必须由当前 profile 渲染；项目覆盖不得只改 DDL。

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
