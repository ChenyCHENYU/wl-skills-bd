# 05 · Service 层规范（✅ 已落地，依据 Spring 官方 + 团队基线）

> 团队基线：Service 接口 + ServiceImpl，**继承 `JhServiceImpl<Mapper, Entity>` 获取 MyBatis-Plus 通用方法**；状态变更模板抽自 CLAUDE 共性最佳实践。

---

## Service 接口

```java
package com.jhict.mdm.service.feature;

import com.jhict.common.data.service.JhService;
import com.jhict.mdm.api.dto.feature.MdmFeatureCategoryDTO;
import com.jhict.mdm.api.entity.feature.MdmFeatureCategory;

/**
 * 特征量分类 应用服务
 *
 * @author jason
 * @since 2025-08-19
 */
public interface MdmFeatureCategoryService extends JhService<MdmFeatureCategory> {

    /** 分页查询 */
    JhPage<List<MdmFeatureCategoryPageVO>> queryMdmFeatureCategoryPage(JhPage page, MdmFeatureCategoryPageDTO dto);

    /** 主键查询 */
    MdmFeatureCategoryVO getById(String id);

    /** 新增 */
    String save(MdmFeatureCategoryDTO dto);

    /** 更新 */
    void updateById(MdmFeatureCategoryDTO dto);

    /** 删除 */
    void deleteById(String id);
}
```

**要点**：

- 接口名不加 `I` 前缀，直接 `XxxService`
- 接口可继承 `JhService<Entity>` 复用 MyBatis-Plus 通用方法（`getById` / `save` / `updateById` / `removeById` / `list` / `page` 等）；**重写时显式声明**，让 IDE 跳转更清晰
- 方法签名使用 DTO / VO，**不返回 Entity 给上层**（除内部使用）

---

## ServiceImpl 实现

```java
@Service
@RequiredArgsConstructor                // Lombok 构造注入
public class MdmFeatureCategoryServiceImpl
        extends JhServiceImpl<MdmFeatureCategoryMapper, MdmFeatureCategory>
        implements MdmFeatureCategoryService {

    private final MdmFeatureCategoryMapper categoryMapper;        // 同 baseMapper
    private final MdmModelMapper modelMapper;                     // 跨域 Mapper
    private final TableNameConverter tableNameConverter;

    @Override
    public JhPage<List<MdmFeatureCategoryPageVO>> queryMdmFeatureCategoryPage(JhPage page, MdmFeatureCategoryPageDTO dto) {
        return categoryMapper.queryPage(page, dto);
    }

    @Override
    public MdmFeatureCategoryVO getById(String id) {
        MdmFeatureCategory entity = baseMapper.selectById(id);
        ServiceAssert.notNull(entity, "记录不存在");
        MdmFeatureCategoryVO vo = new MdmFeatureCategoryVO();
        BeanUtils.copyProperties(entity, vo);
        return vo;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public String save(MdmFeatureCategoryDTO dto) {
        MdmFeatureCategory entity = BeanUtil.copyProperties(dto, MdmFeatureCategory.class);
        if (entity.getId() == null) {
            entity.setId(String.valueOf(IdWorker.getId()));
        }
        // 重复校验
        MdmFeatureCategory exist = baseMapper.getByFeatureKey(entity.getFeatureKey());
        ServiceAssert.isNull(exist, "feature_key 已存在");
        EntityUtil.fillCreateData(entity);             // 团队工具：填创建人 / 创建时间 / IS_DELETE=1
        baseMapper.insert(entity);
        return entity.getId();
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void updateById(MdmFeatureCategoryDTO dto) {
        ServiceAssert.notNull(dto.getId(), "主键不能为空");
        MdmFeatureCategory entity = BeanUtil.copyProperties(dto, MdmFeatureCategory.class);
        EntityUtil.fillUpdateData(entity);             // 团队工具：填更新人 / 更新时间
        baseMapper.updateById(entity);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void deleteById(String id) {
        MdmFeatureCategory db = baseMapper.selectById(id);
        ServiceAssert.notNull(db, "记录不存在");
        // 软删除：把 IS_DELETE 置为 0（团队约定 1=有效, 0=删除）
        MdmFeatureCategory patch = new MdmFeatureCategory();
        patch.setId(id);
        patch.setIsDelete(WhetherEnum.NO.getCode());
        EntityUtil.fillUpdateData(patch);
        baseMapper.updateById(patch);
    }
}
```

**要点**：

1. **写操作必加** `@Transactional(rollbackFor = Exception.class)`
2. **构造注入**优先（`@RequiredArgsConstructor`）；不用字段 `@Autowired`
3. **业务校验**用 `ServiceAssert`（团队工具，抛 `ServiceException`），不直接 `throw new RuntimeException`
4. **审计字段**统一通过 `EntityUtil.fillCreateData / fillUpdateData` 填充，禁止业务代码裸写 `setCreateUserNo` / `setCreateDateTime`
5. **软删除**：约定 `IS_DELETE = 1 (有效) / 0 (删除)`；查询时在 XML 加 `AND IS_DELETE = 1`
6. **主键生成**：`IdWorker.getId()`（雪花算法，String 类型，与数据库类型无关）
7. **BeanCopy**：用 `BeanUtil` (Hutool) 或 `BeanUtils.copyProperties` (Spring) 二选一在团队内统一；本基线 **保存场景用 Hutool，单转用 Spring**

---

## 状态变更通用模板（共性最佳实践）

```java
@Override
@Transactional(rollbackFor = Exception.class)
public void submitForReview(String id) {
    MdmFeatureCategory db = requireExist(id);
    ServiceAssert.isTrue("DRAFT".equals(db.getStatus()), "仅「待提交」可提交审核");

    MdmFeatureCategory patch = new MdmFeatureCategory();
    patch.setId(id);
    patch.setStatus("REVIEWING");
    EntityUtil.fillUpdateData(patch);
    baseMapper.updateById(patch);
}

private MdmFeatureCategory requireExist(String id) {
    MdmFeatureCategory entity = baseMapper.selectById(id);
    ServiceAssert.notNull(entity, "记录不存在");
    return entity;
}
```

> 共性来自 CLAUDE 规范 §七：**先校验存在 → 再校验当前状态 → 构造 patch 只更新必要字段 → updateById** 四段式。

---

## 批量保存模式

```java
public void saveBatch(List<MdmFeatureCategoryDTO> rows) {
    List<MdmFeatureCategory> inserts = new ArrayList<>();
    List<MdmFeatureCategory> updates = new ArrayList<>();
    for (MdmFeatureCategoryDTO dto : rows) {
        MdmFeatureCategory e = BeanUtil.copyProperties(dto, MdmFeatureCategory.class);
        if (StringUtils.isBlank(e.getId())) {
            e.setId(String.valueOf(IdWorker.getId()));
            EntityUtil.fillCreateData(e);
            inserts.add(e);
        } else {
            EntityUtil.fillUpdateData(e);
            updates.add(e);
        }
    }
    if (CollectionUtils.isNotEmpty(inserts)) saveBatch(inserts);           // 来自 JhServiceImpl
    if (CollectionUtils.isNotEmpty(updates)) updateBatchById(updates);
}
```

---

## 禁止事项

- 禁止 Controller 直接调用 Mapper
- 禁止 ServiceImpl 之间互相直接 new（必须 @Autowired/@Resource）
- 禁止 Service 中拼 SQL 字符串
- 禁止在事务方法中调外部 Feign 接口（除非 Feign 失败可回滚业务）
- 禁止裸写 `setCreateDateTime` 等审计字段（统一走 EntityUtil）

---

## 变更记录

- 2026-05-14 v0.0.1 落地（基于 `mdm-service/MdmFeatureCategoryServiceImpl.java` 真实代码 + CLAUDE 共性 §七）
