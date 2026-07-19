"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { applyPlan, buildPlan } = require("../lib/codegen");

const ROOT = path.resolve(__dirname, "..");
const contractFile = path.join(ROOT, "files", ".github", "templates", "examples", "feature-category.contract.json");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wl-skills-bd-javac-"));
const stubRoot = path.join(tempRoot, "stubs");

function writeSource(root, rel, content) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${content.trim()}\n`, "utf8");
  return file;
}

function javaFiles(root) {
  const result = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && entry.name.endsWith(".java")) result.push(absolute);
    }
  }
  if (fs.existsSync(root)) walk(root);
  return result.sort();
}

function compile(label, sources) {
  const output = path.join(tempRoot, `classes-${label}`);
  fs.mkdirSync(output, { recursive: true });
  const result = spawnSync("javac", ["-encoding", "UTF-8", "-source", "8", "-target", "8", "-proc:none", "-d", output, ...sources], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  assert.strictEqual(result.status, 0, `javac ${label} 失败：\n${result.stdout}\n${result.stderr}`);
}

const commonStubs = {
  "com/baomidou/mybatisplus/annotation/TableLogic.java": `package com.baomidou.mybatisplus.annotation; public @interface TableLogic { String value(); String delval(); }`,
  "com/baomidou/mybatisplus/annotation/TableName.java": `package com.baomidou.mybatisplus.annotation; public @interface TableName { String value() default ""; boolean autoResultMap() default false; }`,
  "com/baomidou/mybatisplus/annotation/Version.java": `package com.baomidou.mybatisplus.annotation; public @interface Version {}`,
  "com/jhict/common/core/entity/CoreEntity.java": `package com.jhict.common.core.entity; public class CoreEntity { private String id; private String companyId; public String getId(){return id;} public void setId(String value){id=value;} public String getCompanyId(){return companyId;} public void setCompanyId(String value){companyId=value;} }`,
  "com/jhict/common/core/entity/ApiResult.java": `package com.jhict.common.core.entity; public class ApiResult<T> { public static <T> ApiResult<T> success(String message, T data){return new ApiResult<T>();} }`,
  "com/jhict/common/core/util/ServiceAssert.java": `package com.jhict.common.core.util; public final class ServiceAssert { public static void isTrue(boolean value,String message){} public static void isNotNull(Object value,String message){} }`,
  "com/jhict/common/core/exception/ServiceException.java": `package com.jhict.common.core.exception; public class ServiceException extends RuntimeException { public ServiceException(String message){super(message);} }`,
  "com/jhict/common/auth/util/AuthUtil.java": `package com.jhict.common.auth.util; public final class AuthUtil { public static String getLoginCompanyId(){return "company";} }`,
  "com/jhict/common/auth/util/EntityUtil.java": `package com.jhict.common.auth.util; public final class EntityUtil { public static void setCreateProp(Object value){} public static void setUpdateProp(Object value){} }`,
  "com/jhict/common/data/mapper/JhBaseMapper.java": `package com.jhict.common.data.mapper; public interface JhBaseMapper<T> { int insert(T value); int updateById(T value); }`,
  "com/jhict/common/data/mybatis/entity/JhPage.java": `package com.jhict.common.data.mybatis.entity; public class JhPage<T> { public void setCurrent(long value){} public void setSize(long value){} }`,
  "com/jhict/common/data/service/JhServiceImpl.java": `package com.jhict.common.data.service; import com.jhict.common.data.mapper.JhBaseMapper; import java.util.function.Function; public class JhServiceImpl<M extends JhBaseMapper<T>,T> { protected M baseMapper; protected Query<T> lambdaQuery(){return new Query<T>();} public static class Query<T>{ public Query<T> eq(Function<T,?> getter,Object value){return this;} public Query<T> in(Function<T,?> getter,Object value){return this;} public T one(){return null;} public java.util.List<T> list(){return new java.util.ArrayList<T>();} } }`,
  "cn/hutool/core/bean/BeanUtil.java": `package cn.hutool.core.bean; import cn.hutool.core.bean.copier.CopyOptions; public final class BeanUtil { public static void copyProperties(Object from,Object to,String... ignore){} public static void copyProperties(Object from,Object to,CopyOptions options){} }`,
  "cn/hutool/core/bean/copier/CopyOptions.java": `package cn.hutool.core.bean.copier; public class CopyOptions { public static CopyOptions create(){return new CopyOptions();} public CopyOptions setIgnoreNullValue(boolean value){return this;} public CopyOptions setIgnoreProperties(String... names){return this;} }`,
  "io/swagger/v3/oas/annotations/media/Schema.java": `package io.swagger.v3.oas.annotations.media; public @interface Schema { String description() default ""; String example() default ""; RequiredMode requiredMode() default RequiredMode.AUTO; enum RequiredMode { AUTO, REQUIRED, NOT_REQUIRED } }`,
  "io/swagger/v3/oas/annotations/Operation.java": `package io.swagger.v3.oas.annotations; public @interface Operation { String summary() default ""; }`,
  "io/swagger/v3/oas/annotations/Parameter.java": `package io.swagger.v3.oas.annotations; public @interface Parameter { String name() default ""; String description() default ""; String example() default ""; boolean hidden() default false; }`,
  "io/swagger/v3/oas/annotations/Parameters.java": `package io.swagger.v3.oas.annotations; public @interface Parameters { Parameter[] value(); }`,
  "io/swagger/v3/oas/annotations/tags/Tag.java": `package io.swagger.v3.oas.annotations.tags; public @interface Tag { String name(); }`,
  "lombok/Getter.java": `package lombok; public @interface Getter {}`,
  "lombok/Setter.java": `package lombok; public @interface Setter {}`,
  "lombok/ToString.java": `package lombok; public @interface ToString {}`,
  "lombok/RequiredArgsConstructor.java": `package lombok; public @interface RequiredArgsConstructor {}`,
  "lombok/experimental/Accessors.java": `package lombok.experimental; public @interface Accessors { boolean chain() default false; }`,
  "javax/annotation/Resource.java": `package javax.annotation; public @interface Resource {}`,
  "javax/servlet/http/HttpServletResponse.java": `package javax.servlet.http; public interface HttpServletResponse {}`,
  "javax/validation/constraints/NotBlank.java": `package javax.validation.constraints; public @interface NotBlank { String message() default ""; }`,
  "javax/validation/constraints/NotEmpty.java": `package javax.validation.constraints; public @interface NotEmpty { String message() default ""; }`,
  "javax/validation/constraints/NotNull.java": `package javax.validation.constraints; public @interface NotNull { String message() default ""; }`,
  "javax/validation/constraints/Min.java": `package javax.validation.constraints; public @interface Min { long value(); String message() default ""; }`,
  "javax/validation/constraints/Max.java": `package javax.validation.constraints; public @interface Max { long value(); String message() default ""; }`,
  "javax/validation/constraints/Size.java": `package javax.validation.constraints; public @interface Size { int max() default 2147483647; String message() default ""; }`,
  "org/apache/ibatis/annotations/Mapper.java": `package org.apache.ibatis.annotations; public @interface Mapper {}`,
  "org/apache/ibatis/annotations/Param.java": `package org.apache.ibatis.annotations; public @interface Param { String value(); }`,
  "org/springframework/security/access/prepost/PreAuthorize.java": `package org.springframework.security.access.prepost; public @interface PreAuthorize { String value(); }`,
  "org/springframework/stereotype/Service.java": `package org.springframework.stereotype; public @interface Service { String value() default ""; }`,
  "org/springframework/transaction/annotation/Transactional.java": `package org.springframework.transaction.annotation; public @interface Transactional { Class<?>[] rollbackFor() default {}; }`,
  "org/springframework/validation/annotation/Validated.java": `package org.springframework.validation.annotation; public @interface Validated {}`,
  "org/springframework/web/bind/annotation/DeleteMapping.java": `package org.springframework.web.bind.annotation; public @interface DeleteMapping { String[] value() default {}; }`,
  "org/springframework/web/bind/annotation/GetMapping.java": `package org.springframework.web.bind.annotation; public @interface GetMapping { String[] value() default {}; }`,
  "org/springframework/web/bind/annotation/PathVariable.java": `package org.springframework.web.bind.annotation; public @interface PathVariable { String value() default ""; }`,
  "org/springframework/web/bind/annotation/PatchMapping.java": `package org.springframework.web.bind.annotation; public @interface PatchMapping { String[] value() default {}; }`,
  "org/springframework/web/bind/annotation/PostMapping.java": `package org.springframework.web.bind.annotation; public @interface PostMapping { String[] value() default {}; }`,
  "org/springframework/web/bind/annotation/PutMapping.java": `package org.springframework.web.bind.annotation; public @interface PutMapping { String[] value() default {}; }`,
  "org/springframework/web/bind/annotation/RequestBody.java": `package org.springframework.web.bind.annotation; public @interface RequestBody {}`,
  "org/springframework/web/bind/annotation/RequestMapping.java": `package org.springframework.web.bind.annotation; public @interface RequestMapping { String[] value() default {}; }`,
  "org/springframework/web/bind/annotation/RequestParam.java": `package org.springframework.web.bind.annotation; public @interface RequestParam { String value() default ""; boolean required() default true; }`,
  "org/springframework/web/bind/annotation/RestController.java": `package org.springframework.web.bind.annotation; public @interface RestController {}`,
  "org/junit/jupiter/api/BeforeEach.java": `package org.junit.jupiter.api; public @interface BeforeEach {}`,
  "org/junit/jupiter/api/Test.java": `package org.junit.jupiter.api; public @interface Test {}`,
  "org/junit/jupiter/api/Assertions.java": `package org.junit.jupiter.api; public final class Assertions { public static void assertEquals(Object expected,Object actual){} public static <T extends Throwable> T assertThrows(Class<T> expectedType, org.junit.jupiter.api.function.Executable executable){return null;} }`,
  "org/junit/jupiter/api/function/Executable.java": `package org.junit.jupiter.api.function; public interface Executable { void execute() throws Throwable; }`,
  "org/junit/jupiter/api/extension/ExtendWith.java": `package org.junit.jupiter.api.extension; public @interface ExtendWith { Class<?>[] value(); }`,
  "org/mockito/Mock.java": `package org.mockito; public @interface Mock {}`,
  "org/mockito/junit/jupiter/MockitoExtension.java": `package org.mockito.junit.jupiter; public final class MockitoExtension {}`,
  "org/mockito/invocation/InvocationOnMock.java": `package org.mockito.invocation; public interface InvocationOnMock { <T> T getArgument(int index); }`,
  "org/mockito/stubbing/Answer.java": `package org.mockito.stubbing; import org.mockito.invocation.InvocationOnMock; public interface Answer<T> { T answer(InvocationOnMock invocation) throws Throwable; }`,
  "org/mockito/stubbing/OngoingStubbing.java": `package org.mockito.stubbing; public interface OngoingStubbing<T> { OngoingStubbing<T> thenReturn(T value); OngoingStubbing<T> thenAnswer(Answer<T> answer); }`,
  "org/mockito/Mockito.java": `package org.mockito; import org.mockito.stubbing.OngoingStubbing; public final class Mockito { public static <T> OngoingStubbing<T> when(T value){return null;} public static <T> T verify(T mock){return mock;} public static <T> T verify(T mock, Object mode){return mock;} }`,
  "org/mockito/ArgumentCaptor.java": `package org.mockito; public final class ArgumentCaptor<T> { public static <T> ArgumentCaptor<T> forClass(Class<T> clazz){return new ArgumentCaptor<T>();} public T capture(){return null;} public T getValue(){return null;} }`,
  "org/mockito/ArgumentMatchers.java": `package org.mockito; public final class ArgumentMatchers { public static <T> T any(Class<T> type){return null;} public static <T> T any(){return null;} }`,
  "org/springframework/test/util/ReflectionTestUtils.java": `package org.springframework.test.util; public final class ReflectionTestUtils { public static void setField(Object target,String name,Object value){} }`,
  "org/springframework/test/web/servlet/RequestBuilder.java": `package org.springframework.test.web.servlet; public interface RequestBuilder {}`,
  "org/springframework/test/web/servlet/ResultMatcher.java": `package org.springframework.test.web.servlet; public interface ResultMatcher {}`,
  "org/springframework/test/web/servlet/ResultActions.java": `package org.springframework.test.web.servlet; public class ResultActions { public ResultActions andExpect(ResultMatcher value){return this;} }`,
  "org/springframework/test/web/servlet/MockMvc.java": `package org.springframework.test.web.servlet; public class MockMvc { public ResultActions perform(RequestBuilder value){return new ResultActions();} }`,
  "org/springframework/test/web/servlet/setup/MockMvcBuilders.java": `package org.springframework.test.web.servlet.setup; import org.springframework.test.web.servlet.MockMvc; public final class MockMvcBuilders { public static Builder standaloneSetup(Object value){return new Builder();} public static class Builder { public MockMvc build(){return new MockMvc();} } }`,
  "org/springframework/test/web/servlet/request/MockMvcRequestBuilders.java": `package org.springframework.test.web.servlet.request; import org.springframework.test.web.servlet.RequestBuilder; public final class MockMvcRequestBuilders { public static RequestBuilder get(String path,Object... values){return null;} }`,
  "org/springframework/test/web/servlet/result/MockMvcResultMatchers.java": `package org.springframework.test.web.servlet.result; import org.springframework.test.web.servlet.ResultMatcher; public final class MockMvcResultMatchers { public static JsonPath jsonPath(String path){return new JsonPath();} public static class JsonPath implements ResultMatcher { public ResultMatcher value(Object value){return this;} } }`,
};

const modelStubs = {
  "com/jhict/mdm/api/entity/feature/MdmFeatureCategory.java": `package com.jhict.mdm.api.entity.feature; import com.jhict.common.core.entity.CoreEntity; public class MdmFeatureCategory extends CoreEntity { private Integer isDelete; private Integer revision; public Integer getRevision(){return revision;} public void setRevision(Integer value){revision=value;} public Integer getIsDelete(){return isDelete;} public void setIsDelete(Integer value){isDelete=value;} }`,
  "com/jhict/mdm/api/dto/feature/MdmFeatureCategoryCreateDTO.java": `package com.jhict.mdm.api.dto.feature; public class MdmFeatureCategoryCreateDTO { public void setCategoryCode(String value){} public void setCategoryName(String value){} }`,
  "com/jhict/mdm/api/dto/feature/MdmFeatureCategoryUpdateDTO.java": `package com.jhict.mdm.api.dto.feature; public class MdmFeatureCategoryUpdateDTO { public String getId(){return "id";} public Integer getRevision(){return 0;} }`,
  "com/jhict/mdm/api/dto/feature/MdmFeatureCategoryPageDTO.java": `package com.jhict.mdm.api.dto.feature; public class MdmFeatureCategoryPageDTO { public long getCurrent(){return 1L;} public long getSize(){return 20L;} }`,
  "com/jhict/mdm/api/vo/feature/MdmFeatureCategoryVO.java": `package com.jhict.mdm.api.vo.feature; public class MdmFeatureCategoryVO {}`,
  "com/jhict/mdm/api/vo/feature/MdmFeatureCategoryPageVO.java": `package com.jhict.mdm.api.vo.feature; public class MdmFeatureCategoryPageVO {}`,
};

const extensionModelStubs = {
  "com/jhict/sale/api/entity/order/SaleOrderMaster.java": `package com.jhict.sale.api.entity.order; import com.jhict.common.core.entity.CoreEntity; public class SaleOrderMaster extends CoreEntity { private Integer isDelete; private Integer revision; private String status; private String approvalOpinion; public Integer getRevision(){return revision;} public void setRevision(Integer value){revision=value;} public Integer getIsDelete(){return isDelete;} public void setIsDelete(Integer value){isDelete=value;} public String getStatus(){return status;} public void setStatus(String value){status=value;} public void setApprovalOpinion(String value){approvalOpinion=value;} }`,
  "com/jhict/sale/api/dto/order/SaleOrderMasterCreateDTO.java": `package com.jhict.sale.api.dto.order; public class SaleOrderMasterCreateDTO { public void setOrderNo(String value){} public void setCustomerName(String value){} }`,
  "com/jhict/sale/api/dto/order/SaleOrderMasterUpdateDTO.java": `package com.jhict.sale.api.dto.order; public class SaleOrderMasterUpdateDTO { public String getId(){return "id";} public Integer getRevision(){return 0;} }`,
  "com/jhict/sale/api/dto/order/SaleOrderMasterPageDTO.java": `package com.jhict.sale.api.dto.order; public class SaleOrderMasterPageDTO { public long getCurrent(){return 1L;} public long getSize(){return 20L;} }`,
  "com/jhict/sale/api/dto/order/SaleOrderMasterApproveRequestDTO.java": `package com.jhict.sale.api.dto.order; public class SaleOrderMasterApproveRequestDTO { public String getId(){return "id";} public String getOpinion(){return "ok";} }`,
  "com/jhict/sale/api/dto/order/SaleOrderMasterBatchCancelRequestDTO.java": `package com.jhict.sale.api.dto.order; public class SaleOrderMasterBatchCancelRequestDTO { public java.util.List<String> getIds(){return java.util.Collections.singletonList("id");} }`,
  "com/jhict/sale/api/vo/order/SaleOrderMasterVO.java": `package com.jhict.sale.api.vo.order; public class SaleOrderMasterVO {}`,
  "com/jhict/sale/api/vo/order/SaleOrderMasterPageVO.java": `package com.jhict.sale.api.vo.order; public class SaleOrderMasterPageVO {}`,
  "com/jhict/sale/api/vo/order/SaleOrderItemVO.java": `package com.jhict.sale.api.vo.order; public class SaleOrderItemVO {}`,
};

try {
  const version = spawnSync("javac", ["-version"], { encoding: "utf8" });
  assert.strictEqual(version.status, 0, "Java 8 编译夹具需要可用的 javac");
  assert.match(`${version.stdout}${version.stderr}`, /javac 1\.8\./, "支持基线必须使用 Java 8 编译验证");

  const plan = buildPlan(contractFile, { projectRoot: tempRoot });
  const applied = applyPlan(plan, { confirm: true, planHash: plan.planHash });
  assert.strictEqual(applied.ok, true);

  const commonFiles = Object.entries(commonStubs).map(([rel, source]) => writeSource(stubRoot, rel, source));
  const generatedModelFiles = javaFiles(path.join(tempRoot, "src", "main", "java", "com", "jhict", "mdm", "api"));
  compile("model", [...commonFiles, ...generatedModelFiles]);

  const modelRoot = path.join(tempRoot, "model-stubs");
  const modelFiles = Object.entries(modelStubs).map(([rel, source]) => writeSource(modelRoot, rel, source));
  const mainFiles = javaFiles(path.join(tempRoot, "src", "main", "java")).filter((file) => !file.includes(`${path.sep}api${path.sep}`));
  const testFiles = javaFiles(path.join(tempRoot, "src", "test", "java"));
  compile("service", [...commonFiles, ...modelFiles, ...mainFiles, ...testFiles]);

  const extensionRoot = path.join(tempRoot, "extension-project");
  fs.mkdirSync(extensionRoot, { recursive: true });
  const extensionContract = JSON.parse(fs.readFileSync(path.join(
    ROOT,
    "files",
    ".github",
    "templates",
    "examples",
    "sale-order-master.contract.json",
  ), "utf8"));
  extensionContract.customOperations[0].method = "PATCH";
  extensionContract.customOperations[1].idFrom = "body";
  extensionContract.customOperations[1].path = "approve";
  const extensionContractFile = path.join(extensionRoot, "sale-order.contract.json");
  fs.writeFileSync(extensionContractFile, `${JSON.stringify(extensionContract, null, 2)}\n`, "utf8");
  const extensionPlan = buildPlan(extensionContractFile, { projectRoot: extensionRoot });
  assert.strictEqual(extensionPlan.ok, true, JSON.stringify(extensionPlan.errors));
  assert.strictEqual(applyPlan(extensionPlan, { confirm: true, planHash: extensionPlan.planHash }).ok, true);

  const extensionGeneratedModels = javaFiles(path.join(extensionRoot, "src", "main", "java", "com", "jhict", "sale", "api"));
  compile("extension-model", [...commonFiles, ...extensionGeneratedModels]);
  const extensionStubRoot = path.join(tempRoot, "extension-model-stubs");
  const extensionStubFiles = Object.entries(extensionModelStubs)
    .map(([rel, source]) => writeSource(extensionStubRoot, rel, source));
  const extensionMain = javaFiles(path.join(extensionRoot, "src", "main", "java"))
    .filter((file) => !file.includes(`${path.sep}api${path.sep}`));
  const extensionTests = javaFiles(path.join(extensionRoot, "src", "test", "java"));
  compile("extension-service", [...commonFiles, ...extensionStubFiles, ...extensionMain, ...extensionTests]);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("✅ java fixture：标准 CRUD 与 PATCH/body/none/batch/relation/export 扩展产物通过 Java 8 真编译");
