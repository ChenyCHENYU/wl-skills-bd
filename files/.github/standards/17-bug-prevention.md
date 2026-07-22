# 17 · 漏洞防护规范（✅ 已落地）

> 基于《后端代码规范》PDF 第五章整理，16 条强制规则（R29 → 见 07-entity-dto-vo.md）。
> 涵盖：精度 / 集合修改 / equals / 原子类 / 浮点 / 拆箱NPE / 集合 / 随机数 / finally / 线程安全 / 日期格式。

---

## R28 · 禁止 new BigDecimal(float/double)

```java
// ❌ 精度丢失（float/double 本身不精确）
BigDecimal bd = new BigDecimal(1.1);   // 实际约 1.100000000000000088...

// ✅
BigDecimal bd = BigDecimal.valueOf(1.1);   // 先 toString 再解析
BigDecimal bd2 = new BigDecimal("1.1");    // 字符串构造
```

---

## R30 · 禁止在 Stream forEach 中向外部集合 add/remove

```java
// ❌ ConcurrentModificationException / 非线程安全
List<String> names = new ArrayList<>();
books.stream().filter(...).forEach(names::add);

// ✅ 使用 collect
List<String> names = books.stream()
    .filter(b -> b.getIsbn().startsWith("0"))
    .map(Book::getTitle)
    .collect(Collectors.toList());
```

---

## R31 · foreach 循环内禁止对被遍历集合 remove/add

```java
// ❌ 抛 ConcurrentModificationException
for (String item : list) {
    if (shouldRemove(item)) list.remove(item);
}

// ✅ 使用 Iterator.remove()
Iterator<String> it = list.iterator();
while (it.hasNext()) {
    if (shouldRemove(it.next())) it.remove();
}

// ✅ 或 removeIf（Java 8+）
list.removeIf(this::shouldRemove);
```

---

## R32 · equals 比较：常量 / 字面量写在前面

```java
// ❌ inner 为 null 时 NPE
if (inner.equals("hello")) { ... }

// ✅ 常量在前，inner 为 null 时安全返回 false
if ("hello".equals(inner)) { ... }

// ✅ 双变量时用 Objects.equals
if (Objects.equals(a, b)) { ... }
```

---

## R33 · String 和包装类型比较必须用 equals()，禁止 ==

```java
// ❌ == 比较对象引用，超出 [-128,127] 缓存范围即错
Integer a = 200, b = 200;
if (a == b) { ... }              // false
String s1 = "hi", s2 = new String("hi");
if (s1 == s2) { ... }            // false

// ✅
if (a.equals(b)) { ... }
if (Objects.equals(s1, s2)) { ... }
```

---

## R34 · AtomicXxx 比较使用 .get() 取值后再比较

```java
// ❌ equals() 比较引用，两个 AtomicInteger 永远不等
AtomicInteger a = new AtomicInteger(0);
AtomicInteger b = new AtomicInteger(0);
if (a.equals(b)) { ... }   // 永远 false

// ✅
if (a.get() == b.get()) { ... }
```

---

## R35 · 禁止对 float/double 使用 == 等值判断

```java
// ❌ 浮点精度问题
if (price == 0.0f) { ... }
if (rate == 0.1) { ... }

// ✅ 方案一：误差范围比较
if (Math.abs(price) < 1e-6f) { ... }

// ✅ 方案二：转 BigDecimal 比较（货币等精度敏感场景）
if (BigDecimal.valueOf(price).compareTo(BigDecimal.ZERO) == 0) { ... }
```

---

## R36 · 方法返回值为基本类型时，注意自动拆箱 NPE

```java
// ❌ count 为 null 时自动拆箱抛 NPE
public int getCount() {
    Integer count = cache.get(key);   // 可能返回 null
    return count;   // NPE
}

// ✅ 显式处理 null
public int getCount() {
    Integer count = cache.get(key);
    return count != null ? count : 0;
}
```

---

## R37 · Arrays.asList() 返回的 List 不可修改

```java
// ❌ UnsupportedOperationException
List<String> list = Arrays.asList("a", "b");
list.add("c");   // 抛异常

// ✅ 包一层 ArrayList
List<String> list = new ArrayList<>(Arrays.asList("a", "b"));
list.add("c");   // 正常

// ✅ Java 9+：List.of("a","b") 同样不可变，明确表达不可变语义
```

---

## R38 · 随机数使用 Random.nextInt(n)，不用强转截断

```java
// ❌ nextDouble() 强转后永远为 0
int r = (int) new Random().nextDouble() * 100;

// ✅
int r = new Random().nextInt(100);   // [0, 100)

// ✅ 安全随机（验证码 / Token）
int r = new SecureRandom().nextInt(1000000);
```

---

## R39 · finally 块禁止 return / break / throw

```java
// ❌ finally 的 return 会吞掉 try 里的异常
try {
    throw new RuntimeException("业务失败");
} finally {
    return "ok";   // 异常被静默丢弃
}

// ✅ finally 只做清理（关资源 / 日志），不改变控制流
try {
    process();
} finally {
    closeResource();   // 不含 return/throw/break
}
```

---

## R40 · SimpleDateFormat 非线程安全，禁止声明为 static 变量

```java
// ❌ 多线程共享，parse/format 结果错乱
private static SimpleDateFormat SDF = new SimpleDateFormat("yyyy-MM-dd");

// ✅ 方案一：ThreadLocal 隔离（高频场景）
private static final ThreadLocal<SimpleDateFormat> SDF_TL =
    ThreadLocal.withInitial(() -> new SimpleDateFormat("yyyy-MM-dd"));

// ✅ 方案二：每次 new（低频场景）
new SimpleDateFormat("yyyy-MM-dd").format(date);

// ✅ 方案三：Java 8+ DateTimeFormatter（线程安全）
private static final DateTimeFormatter DTF =
    DateTimeFormatter.ofPattern("yyyy-MM-dd");
```

---

## R41 · toArray() 必须传入类型数组

```java
// ❌ 返回 Object[]，强转抛 ClassCastException
String[] arr = (String[]) list.toArray();

// ✅
String[] arr = list.toArray(new String[0]);
```

---

## R42 · 删除从未使用的 private 字段

```java
// ❌ 死代码，误导维护者
private int unusedFlag = 0;

// ✅ 删除；若将来需要再补
```

---

## R43 · ThreadLocal 使用完毕必须 remove()

```java
// ❌ 线程池复用线程时，旧值泄漏到下一个请求
USER_CONTEXT.set(currentUser);
// ... 业务逻辑 ...
// 忘记 remove

// ✅ try-finally 确保清除
USER_CONTEXT.set(currentUser);
try {
    doWork();
} finally {
    USER_CONTEXT.remove();   // 必须在 finally 中
}
```

---

## R44 · 日期格式化使用小写 yyyy，禁止大写 YYYY（除明确需要周年）

```java
// ❌ YYYY = "week in which year"，12-31 可能返回下一年
new SimpleDateFormat("YYYY-MM-dd").format(new Date());  // 跨年周出错

// ✅ yyyy = 当天所在日历年
new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date());
DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
```

---

## 变更记录

- 2026-05-17 v0.0.2 新增（基于《后端代码规范》PDF R28–R44，R29 见 07-entity-dto-vo.md）
