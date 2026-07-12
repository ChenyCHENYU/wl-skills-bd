# Backend Best Practices · 场景索引（v0.0.1 骨架）

> 用于**语义级路由**：用户的诉求未必命中精确触发词，AI 应通过场景识别落到对应 Skill。

---

## 场景 1：新模块全量开发

**典型说话方式**：

- "新做一个 `特征量分类` 模块"
- "给我做一套 CRUD"
- "前端已经设计好了 api.md，后端开始"

**推荐 Pipeline**：

```
② api-design-be → ③ entity-codegen → ④ service-codegen → ⑤ mapper-xml-gen
                                                                │
                                                                ▼
                                          ⑥ db-migration（新表需要）
                                                                │
                                                                ▼
                                          ⑦ unit-test-gen → ⑧ convention-audit-be
```

**关键约束**：

- 必须先有前端 api.md，或同步 `api-design-be` 产出后端契约
- ⑥ 之前必须人工确认 DDL

---

## 场景 2：仅新增字段

**典型说话方式**：

- "在特征量分类表加一个 `description` 字段"
- "新增字段 `categoryLevel`，Integer 类型"

**推荐 Pipeline**：

```
⑥ db-migration（ALTER TABLE） → ③ entity-codegen（补字段） → ⑤ mapper-xml-gen（补列）
                                          │
                                          ▼
                            ④ service-codegen（按需调整 DTO/VO） → ⑧ convention-audit-be
```

**关键约束**：

- ALTER TABLE 必须有回滚脚本
- 新字段是否必填、默认值、索引需求要在 DDL 评审中明确

---

## 场景 3：存量服务体检

**典型说话方式**：

- "扫一下我们这个服务有哪些规范问题"
- "做一次代码审计"

**推荐 Pipeline**：

```
⑧ convention-audit-be → 输出报告 → 用户确认 → ⑨ code-fix-be → 复扫
```

**关键约束**：

- 审计输出报告本身不改代码
- 修复阶段每个补丁展示 diff

---

## 场景 4：前后端联调与契约对齐

**典型说话方式**：

- "前端 api.md 改了，后端也要跟上"
- "接口入参变了，帮我同步"

**推荐 Pipeline**：

```
② api-design-be（diff 前后端契约） → 影响面分析 → ③ / ④ / ⑤ 按需局部刷新
                                                          │
                                                          ▼
                                            ⑧ convention-audit-be（聚焦受影响文件）
```

---

## 场景 5：业务理解优先（陌生模块接手）

**典型说话方式**：

- "这个模块我没接手过，先帮我搞清楚业务"
- "把 mdm-feature-category 的业务文档整理出来"

**推荐 Pipeline**：

```
business-doc-extract-be（读 controller+service+xml+表注释）→ docs/business/{module}.md
```

**关键约束**：

- 不改代码
- 输出的业务文档需要业务侧确认

---

## 场景 6：仅看不写（咨询模式）

**典型说话方式**：

- "我们这个项目用的什么框架？"
- "Mapper XML 怎么写？"

**正确响应**：

- **不要**触发任何写代码 Skill
- 引用 `standards/` 对应章节回答
- 文末提示："如需生成代码，可触发 ④ service-codegen 等"

---

## 场景 7：环境配置标准化 / 切换客户环境（本地启动 + K8s 部署）

**典型说话方式**：

- "这个项目要从 172 切到华新，帮我把配置标准化"
- "clone 下来本地起不来，连不上 Nacos"
- "K8s 部署清单补一下，pre 环境缺 / 有冲突"
- "后端环境标准化"

**推荐 Skill**：

```
ops/standard-env-config-be（scan → plan → 确认 → apply → verify → 再 plan no-op）
```

**关键约束**：

- 默认只读 / dry-run，必须用户确认地址、模块名、文件清单后才写入
- 华新项目必须显式 `--profile walsin`，不静默套华新地址
- secret（Nacos 密码 / DB 账密 / 集成 token）不落明文、报告脱敏
- git 冲突标记 🔴 阻断，必须先人工解决
- 不碰 Nacos 内配置、不碰镜像构建（Dockerfile / CI）

---

## 反模式（禁止）

- ❌ 用户问 "这段代码哪里有问题" → 不要直接动手改代码，先 ⑧ 审计输出报告
- ❌ 用户说 "建个表" → 不要直接生成 DDL 后执行，必须走 ⑥ 并人工确认
- ❌ 用户说 "全套来一下" → 不要把代码生成主线 Skill（②-⑨）一次性堆砌，按 Pipeline 顺序逐步推进
