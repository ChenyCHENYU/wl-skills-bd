# Maven 质量 profile

| 文件 | 用途 |
|---|---|
| `quality-profile.xml` | Java 8 默认硬门：J1 ArchUnit + J2 Checkstyle + J3 PMD 7 + J4 SpotBugs + J5 Spotless + J8 JaCoCo |
| `p3c-legacy-profile.xml` | 可选 P3C 存量审计；PMD 6 隔离、非阻断 |

两个文件都是可解析 XML，不是伪装成 `.xml` 的 Markdown。复制其中的 `<profile>` 到父 `pom.xml` 的 `<profiles>` 后执行：

```bash
mvn verify -Pwl-quality
```

规则文件直接引用工程内 `.github/java-quality/`，不要另复制到 `build/`。P3C 必须单独运行：

```bash
mvn pmd:check -Pwl-p3c-legacy
```

不要同时激活 `wl-quality` 和 `wl-p3c-legacy`，因为它们分别运行 PMD 7 和 PMD 6。
