package com.jhict.${rootPackage}.arch;

import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;

/**
 * 架构分层规则（ArchUnit）
 * <p>
 * 对应 standards/02-project-structure.md 的"禁止跨层调用"红线。
 * 任何违反都会让本测试失败，CI build 红灯。
 * <p>
 * 接入：把 com.jhict.${rootPackage} 替换为工程根包（见 standards/02 业务中心包名映射）。
 *
 * @author wl-skills-bd J1
 */
@AnalyzeClasses(packagesOf = LayerRulesTest.class)
public class LayerRulesTest {

    /**
     * R1: Controller 不得直接依赖 Mapper（必须经 Service）。
     * standards/02: Controller → Service → Mapper，禁止跨层。
     */
    @ArchTest
    static final ArchRule 控制器不得依赖Mapper = noClasses()
            .that().resideInAPackage("..controller..")
            .should().dependOnClassesThat().resideInAPackage("..mapper..")
            .because("standards/02: Controller 必须经 Service，禁止直连 Mapper");

    /**
     * R2: Controller 不得直接依赖 Mapper XML 资源（同上，防直连 DB）。
     */
    @ArchTest
    static final ArchRule 控制器不得操作数据库层 = noClasses()
            .that().resideInAPackage("..controller..")
            .should().dependOnClassesThat().resideInAnyPackage("..mapper..", "..entity..")
            .andShould().notBeAnnotatedWith("org.apache.ibatis.annotations.Mapper");

    /**
     * R3: Service 实现类不得互相直接依赖实现（应依赖接口）。
     * standards/02: 禁止跨服务直接 new 调用，必须 @Autowired。
     */
    @ArchTest
    static final ArchRule 服务实现不得相互依赖实现类 = noClasses()
            .that().resideInAPackage("..service..impl..")
            .should().dependOnClassesThat().resideInAPackage("..service..impl..");

    /**
     * R4: Entity 不得依赖 Controller/Service（领域模型纯净）。
     * standards/02: api/entity 禁止业务逻辑、禁止 Spring 注解。
     */
    @ArchTest
    static final ArchRule 实体不得依赖控制层或服务层 = noClasses()
            .that().resideInAPackage("..entity..")
            .should().dependOnClassesThat().resideInAnyPackage("..controller..", "..service..")
            .because("standards/02: Entity 是纯数据模型，禁止反向依赖业务层");

    /**
     * R5: 业务子域包之间不得循环依赖。
     * standards/02: 业务模块边界清晰。
     */
    @ArchTest
    static final ArchRule 子域包无循环依赖 = slices()
            .matching("..controller.(*)..")
            .should().beFreeOfCycles();

    /**
     * R6: Controller 只能放在 controller 包（防止散落）。
     * standards/02: 包结构约束。
     */
    @ArchTest
    static final ArchRule 控制器必须在控制器包 = classes()
            .that().areAnnotatedWith("org.springframework.web.bind.annotation.RestController")
            .should().resideInAPackage("..controller..")
            .because("standards/02: Controller 统一放 controller/ 子包");

    /**
     * R7: Mapper 接口必须在 mapper 包（防止散落）。
     */
    @ArchTest
    static final ArchRule 映射器接口必须在映射器包 = classes()
            .that().areAnnotatedWith("org.apache.ibatis.annotations.Mapper")
            .should().resideInAPackage("..mapper..");
}
