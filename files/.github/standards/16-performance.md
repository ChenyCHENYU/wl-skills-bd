# 16 · 性能优化规范（✅ 已落地）

> 基于《后端代码规范》PDF 第四章整理，5 条强制规则。  
> 涵盖：BeanUtils / 时间戳 / 集合容量 / 正则预编译 / 循环拼接。

---

## R23 · 禁止使用 Apache BeanUtils.copyProperties

```java
// ❌ 性能极差，反射无缓存
org.apache.commons.beanutils.BeanUtils.copyProperties(dest, src);

// ✅ 使用 Spring BeanUtils（注意参数顺序相反）
org.springframework.beans.BeanUtils.copyProperties(src, dest);

// ✅ 大批量场景使用 Cglib BeanCopier（需缓存 Copier 实例）
```

> ⚠️ Spring BeanUtils 和 Apache BeanUtils 参数顺序相反，生成时必须注明。

---

## R24 · 获取当前毫秒数使用 System.currentTimeMillis()

```java
// ❌ 额外创建 Date 对象，无意义开销
long t = new Date().getTime();

// ✅
long t = System.currentTimeMillis();
```

---

## R25 · 集合初始化必须指定容量

```java
// ❌ 触发多次 resize/rehash
Map<String, Object> map = new HashMap<>();
List<String> list = new ArrayList<>();

// ✅ 明确预期容量（不确定时给合理估值）
Map<String, Object> map = new HashMap<>(16);
List<String> list = new ArrayList<>(expectedSize);
```

- HashMap 容量建议 = 预期元素数 / 0.75 + 1，取最近 2 的幂

---

## R26 · 正则表达式必须预编译为静态常量

```java
// ❌ 每次调用都编译，性能损耗严重
public boolean isNumeric(String s) {
    return s.matches("[0-9]+");
}

// ✅ 类加载时编译一次
private static final Pattern NUMERIC = Pattern.compile("[0-9]+");
public boolean isNumeric(String s) {
    return NUMERIC.matcher(s).matches();
}
```

---

## R27 · 循环内字符串拼接使用 StringBuilder

```java
// ❌ 每次循环创建新 StringBuilder，产生大量临时对象
String result = "";
for (String s : list) {
    result = result + s;
}

// ✅
StringBuilder sb = new StringBuilder(list.size() * 16);
for (String s : list) {
    sb.append(s);
}
String result = sb.toString();
```

---

## 变更记录

- 2026-05-17 v0.0.2 新增（基于《后端代码规范》PDF R23–R27）
