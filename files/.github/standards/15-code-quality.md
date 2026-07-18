# 15 · 编程质量规范（✅ 已落地）

> 基于《后端代码规范》PDF 第三章整理，14 条强制规则。  
> 涵盖：过时方法 / 常量声明 / 枚举注释 / 条件判断 / 数字字面量 / 方法长度 / 大括号 / 字符串常量 / 注释位置 / switch-break / import / 操作符。

---

## R09 · 禁止使用 @Deprecated 方法或类

```java
// ❌ 禁止
new Date(year, month, day);   // @Deprecated
Thread.stop();                // @Deprecated

// ✅ 改用非废弃替代 API
LocalDate.of(year, month, day);
```

- AI 生成代码时，若有替代 API 必须优先使用非废弃版本

---

## R10 · public static 变量必须声明为 final 常量

```java
// ❌
public class Foo {
    public static String STATUS = "1";
}

// ✅
public class Foo {
    public static final String STATUS_ACTIVE = "1";
}
```

- 命名：UPPER_SNAKE_CASE
- 禁止生成可变的 public static 字段

---

## R11 · 枚举字段必须有 Javadoc 注释

```java
// ❌
public enum WhetherEnum { YES(1), NO(0); }

// ✅
public enum WhetherEnum {
    /** 是 */
    YES(1),
    /** 否 */
    NO(0);
    private final int code;
    WhetherEnum(int code) { this.code = code; }
}
```

---

## R12 · 条件判断禁止内嵌复杂逻辑

```java
// ❌ 嵌套超过 2 层或含函数调用
if (((a && b) || (c && d)) && e) { ... }

// ✅ 提取为有意义的布尔变量
boolean isValid = (checkA() || checkB()) && checkFinal();
if (isValid) { ... }
```

---

## R13 · long/Long 赋值必须使用大写 L

```java
// ❌ 小写 l 与数字 1 混淆
Long timeout = 1000l;

// ✅
Long timeout = 1000L;
```

---

## R14 · 方法体不超过 80 行

- 单个方法超过 80 行时，AI 必须主动提示拆分
- 拆出 private 辅助方法，每个职责单一

---

## R15 · 控制结构必须使用大括号

```java
// ❌
if (ok) return;
for (int i = 0; i < n; i++) doSomething();

// ✅
if (ok) {
    return;
}
for (int i = 0; i < n; i++) {
    doSomething();
}
```

- 适用于 `if / else / for / while / do`，无例外

---

## R18 · 字符串字面量禁止重复出现（≥ 2 次）

> 字面量长度 < 5 个字符可豁免

```java
// ❌
prepare("action1"); execute("action1"); release("action1");

// ✅
private static final String ACTION_1 = "action1";
prepare(ACTION_1); execute(ACTION_1); release(ACTION_1);
```

---

## R19 · 单行注释置于代码行之前，不写尾随注释

```java
// ❌
int a = b + c; // 这是一条很长的尾随注释

// ✅
// 这条注释写在代码行前
int a = b + c;
```

---

## R20 · switch case 末尾必须有 break

```java
// ❌ — 意外穿透
switch (status) {
    case 1: doA();   // 穿透到 case 2
    case 2: doB(); break;
}

// ✅
switch (status) {
    case 1: doA(); break;
    case 2: doB(); break;
    default: doDefault(); break;
}
```

例外：空 case 分组（连续 case 共享行为）、以 `return`/`throw`/`continue` 显式结束。

---

## R21 · 删除非必要 import

- 禁止 `java.lang.*` 显式导入（自动引入）
- 禁止重复导入
- 禁止导入同包类
- 禁止导入未使用的类
- AI 生成代码后必须自检 import 列表

---

## R22 · 禁止误用 =+ / =- / =!

```java
// ❌ 语义错误：等价于 total = (+count)，不是累加
total =+ count;
price =- discount;

// ✅
total += count;
price -= discount;
if (status != expected) { ... }
```

---

## R23/R24 · Javadoc 注释规范

> **本规范由 standards/19 §9 统一定义（单一数据源）**，此处仅保留强制度声明，避免重复维护。
>
> - **类 Javadoc 强制**（@author @since + 职责说明）— Checkstyle `JavadocType` 兜底
> - **接口/抽象方法 Javadoc 强制**（@param/@return/@throws）— Checkstyle `JavadocMethod` 兜底
> - **复杂业务方法 Javadoc 强制**（业务规则、@throws 场景、状态变更说明）
> - **纯数据类字段**：用 `@Schema` 即可（不重复 Javadoc）
> - **Controller 方法**：`@Operation` 给 OpenAPI；只有复杂业务再补 Javadoc
>
> 完整边界、正反例、Clean Code 原则详见 **[`standards/19-design.md` §9](19-design.md#9-注释设计黄山版第一章注释与-15-联动)**。
> 代码模板已内置合规注释，codegen 读模板填空即满足本规范。

---

## 变更记录

- 2026-07-17 v0.6 R23/R24 合并到 19 §9 单一数据源（避免三处重复）
- 2026-07-17 v0.5 新增 R23/R24（Javadoc 规范，联动 19 §9 + Checkstyle）
- 2026-05-17 v0.0.2 新增（基于《后端代码规范》PDF R09–R22）
