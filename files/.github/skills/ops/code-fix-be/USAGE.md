# 使用指南：受控自动修复（code-fix-be）

读审计报告修复违规，修复后★强制复扫确认（不可跳过）。

## 触发词

```
修复规范问题 / 按审计报告改 / 修违规 / 批量改 / 整改 / code fix
```

## 典型场景

### 场景 A：修复 🔴 阻断项（最常见）

```
用户：修一下刚才审计报告里的 B1（缺 @PreAuthorize）
AI：  → 读 Controller.java.tmpl + 权限码规则
      → 生成补丁，展示 diff
      → 确认后写入
      → ★ 强制复扫 validate → error=0 → ✔ 闭环完成
```

### 场景 B：批量修同一类型违规

```
用户：把所有 SELECT 星号都改掉
AI：  → 读 Mapper.xml.tmpl 的 BaseColumns
      → 每文件首个补丁先 diff 确认范式
      → 确认后批量改剩余文件
      → 复扫
```

### 场景 C：修设计级问题（上帝类/长方法）

```
用户：MdmModelService 3373 行怎么改
AI：  → 按 standards/19 §6 反模式拆分
      → 建议拆为 MdmModelCrudService / MdmModelImportService / ...
      → ⚠️ 这是重构，逐个 diff 确认 + 用户审核业务逻辑
```

## 修复对照表

| 违规 | 规则 | 修复方式 |
|------|:---:|---------|
| 缺 @PreAuthorize | B1 | 补 `@PreAuthorize("@pms.hasPermission('xxx')")` |
| 缺 @Operation | B2 | 补 OpenAPI 3 注解 |
| SELECT 星号 | B3 | 改 `<include refid="BaseColumns"/>` |
| 美元符注入 | B4 | 改 `#{x}` + jdbcType |
| 缺 @Transactional | B5 | 加 `@Transactional(rollbackFor=Exception.class)` |
| 缺 COMPANY_ID | B7 | 补租户过滤 |
| 裸 RuntimeException | B8 | 改 ServiceAssert / ServiceException |
| **上帝类** | **B9** | **按职责拆 Service（重构）** |
| **长方法** | **B10** | **提取 private 辅助方法** |
| **高复杂度** | **B11** | **卫语句 / 多态替代 switch** |
| **缺 Javadoc** | **B12** | **补类/方法 Javadoc** |

## 复扫报告格式（每次必出）

```markdown
## 🔄 复扫 {时间}

| 指标 | 修复前 | 修复后 | 变化 |
|---|---:|---:|---|
| 🔴 阻断 | {N} | {N} | {-N} |
| 🟡 警告 | {N} | {N} | {-N} |

### 结论
- ✔ 闭环完成，可安全提交
- 或：✖ 仍有 {N} 项待处理
```

## FAQ

**Q：业务逻辑会被改吗？**
A：不会。code-fix 只修偏差（结构/规范），业务逻辑由 codegen 负责。语义偏差标"人工"不自动修。

**Q：能跳过复扫吗？**
A：不能。"强制复扫"是硬约束（对标 kit/code-fix），即使说"不用验证了"也必须跑——这是闭环完整性保障。

**Q：DDL 类违规怎么办？**
A：转 ⑥ db-migration（表结构变更不在 code-fix 范围）。

**Q：批改前要每个文件都确认吗？**
A：每类型首个补丁确认范式后，剩余同类可批量。防批量盲改。
