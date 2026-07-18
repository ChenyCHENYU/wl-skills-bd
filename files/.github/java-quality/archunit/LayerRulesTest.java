package {{rootPackage}}.arch;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

/**
 * 架构分层规则（ArchUnit）
 *
 * <p>对应 standards/02-project-structure.md 的"禁止跨层调用"红线。任何违反都会让本测试失败，CI build 红灯。
 *
 * <p>接入：把 {{rootPackage}} 替换为工程根包（见 standards/02 业务中心包名映射）。
 *
 * @author wl-skills-bd J1
 */
@AnalyzeClasses(
        packages = "{{rootPackage}}",
        importOptions = ImportOption.DoNotIncludeTests.class)
public class LayerRulesTest {

    /**
     * R1: Controller 不得直接依赖 Mapper（必须经 Service）。standards/02: Controller → Service → Mapper，禁止跨层。
     */
    @ArchTest
    static final ArchRule 控制器不得依赖Mapper =
            noClasses()
                    .that()
                    .resideInAPackage("..controller..")
                    .should()
                    .dependOnClassesThat()
                    .resideInAPackage("..mapper..")
                    .because("standards/02: Controller 必须经 Service，禁止直连 Mapper")
                    .allowEmptyShould(true);

    /** R2: Service 不得反向依赖 Controller。 */
    @ArchTest
    static final ArchRule 服务不得依赖控制器 =
            noClasses()
                    .that()
                    .resideInAPackage("..service..")
                    .should()
                    .dependOnClassesThat()
                    .resideInAPackage("..controller..")
                    .allowEmptyShould(true);

    /** R3: Entity 不得依赖 Controller/Service（领域模型纯净）。standards/02: api/entity 禁止业务逻辑、禁止 Spring 注解。 */
    @ArchTest
    static final ArchRule 实体不得依赖控制层或服务层 =
            noClasses()
                    .that()
                    .resideInAPackage("..entity..")
                    .should()
                    .dependOnClassesThat()
                    .resideInAnyPackage("..controller..", "..service..")
                    .because("standards/02: Entity 是纯数据模型，禁止反向依赖业务层")
                    .allowEmptyShould(true);

    /** R4: Controller 只能放在 controller 包（防止散落）。standards/02: 包结构约束。 */
    @ArchTest
    static final ArchRule 控制器必须在控制器包 =
            classes()
                    .that()
                    .areAnnotatedWith("org.springframework.web.bind.annotation.RestController")
                    .should()
                    .resideInAPackage("..controller..")
                    .because("standards/02: Controller 统一放 controller/ 子包")
                    .allowEmptyShould(true);

    /** R5: Mapper 接口必须在 mapper 包（防止散落）。 */
    @ArchTest
    static final ArchRule 映射器接口必须在映射器包 =
            classes()
                    .that()
                    .areAnnotatedWith("org.apache.ibatis.annotations.Mapper")
                    .should()
                    .resideInAPackage("..mapper..")
                    .allowEmptyShould(true);
}
