# 智机惠小程序云开发上线方案

## 1. 当前项目状态

当前小程序仍是前端原型，角色、权限、合约、卡券都存放在本地 `mockDB` 中。

关键现状：

- 角色识别入口在 `app.js`
- 启动分流页在 `pages/launch/index.js`
- 管理员管理界面在 `packageAdmin/pages/admin/index.js`
- 真实上线前，`utils/mock.js` 里的身份和权限判断都应迁移到云函数

## 2. 正式上线后的角色识别原则

微信只负责给你当前用户的 `openId`，真正的角色和权限由你自己的云数据库决定。

正式流程建议如下：

1. 小程序启动后调用云函数 `login`
2. 云函数通过 `cloud.getWXContext()` 获取 `OPENID`
3. 云函数创建或更新 `portal_users` 用户档案
4. 小程序继续调用 `resolveLaunchContext`
5. 云函数根据 `OPENID` 查询角色表 `portal_roles`
6. 返回可进入的角色入口列表
7. 前端根据角色列表跳转客户首页、门店核销页或管理后台

## 3. 推荐角色模型

### 角色枚举

- `customer`
- `store_clerk`
- `store_owner`
- `admin`
- `super_admin`

### 权限建议

| 角色 | 典型权限 |
|------|----------|
| `customer` | 查看本人合约、查看本人卡包、生成本人核销码 |
| `store_clerk` | 查询核销码、确认核销、查看本店核销记录 |
| `store_owner` | 具备 `store_clerk` 权限，并可查看本店经营数据 |
| `admin` | 合约处理、代金券规则管理、门店管理、运营配置 |
| `super_admin` | 管理管理员账号、分配角色、回收角色、查看审计日志 |

说明：

- 前端只负责展示控制
- 真正的权限校验必须放在云函数里
- `admin` 和 `super_admin` 必须区分，避免所有管理员都能增删管理员

## 4. 推荐云数据库设计

### `portal_users`

用于记录微信用户本身。

建议字段：

- `openId`
- `nickName`
- `avatarUrl`
- `phone`
- `status`
- `lastLoginAt`
- `createdAt`
- `updatedAt`

### `portal_roles`

用于记录一个用户拥有哪些角色，以及角色作用范围。

建议字段：

- `openId`
- `roleKey`
- `scopeType`
- `scopeId`
- `scopeName`
- `permissions`
- `status`
- `boundBy`
- `createdAt`
- `updatedAt`

字段说明：

- `scopeType` 建议取值：`system`、`store`
- `scopeId` 例如：`portal`、`S001`

### `staff_invites`

用于提前配置管理员或门店人员，等对方首次登录后完成绑定。

建议字段：

- `phone`
- `name`
- `roleKey`
- `scopeType`
- `scopeId`
- `scopeName`
- `status`
- `boundOpenId`
- `boundAt`
- `createdBy`
- `createdAt`
- `updatedAt`

为什么需要它：

- 你在新增管理员时，往往还不知道对方的 `openId`
- 可以先按手机号创建待绑定记录
- 对方首次登录后，在启动页输入手机号完成绑定

### `stores`

沿用现有门店主数据，但要迁移到云数据库。

建议字段：

- `storeId`
- `name`
- `address`
- `phone`
- `location`
- `status`
- `createdAt`
- `updatedAt`

### `contracts`

建议字段：

- `contractId`
- `openId`
- `phone`
- `name`
- `address`
- `storeId`
- `storeName`
- `status`
- `logistics`
- `createdAt`
- `updatedAt`

### `coupons`

建议字段：

- `couponId`
- `contractId`
- `openId`
- `storeId`
- `storeName`
- `amount`
- `status`
- `verifyCode`
- `verifyExpireAt`
- `usedAt`
- `createdAt`
- `updatedAt`

### `audit_logs`

用于记录敏感操作。

建议字段：

- `operatorOpenId`
- `operatorRole`
- `action`
- `targetType`
- `targetId`
- `payload`
- `createdAt`

## 5. 推荐云函数职责

### `login`

职责：

- 获取当前 `openId`
- 创建或更新 `portal_users`
- 返回当前登录态

### `resolveLaunchContext`

职责：

- 根据 `openId` 查询 `portal_roles`
- 补齐门店范围角色的门店信息
- 返回启动页需要的角色入口列表

### `bindRoleByPhone`

职责：

- 根据手机号查 `staff_invites`
- 将当前 `openId` 绑定到角色
- 写入或更新 `portal_roles`
- 更新 `staff_invites.boundOpenId`

### `manageAdmin`

职责：

- 仅 `super_admin` 可调用
- 创建管理员待绑定记录
- 停用管理员角色
- 查询管理员列表

### `manageContract`

职责：

- 校验是否具备合约处理权限
- 更新合约状态
- 写审计日志

### `verifyCoupon`

职责：

- 校验是否具备当前门店核销权限
- 校验券是否属于本门店
- 完成核销并落审计日志

## 6. 管理员应如何管理

正式版建议不要让“当前登录人自己把自己升级成管理员”。

建议管理方式：

1. 系统初始化时，手工写入一个 `super_admin`
2. 只有 `super_admin` 能进入“管理员管理”
3. `super_admin` 新增管理员时，创建一条 `staff_invites`
4. 被邀请人首次登录小程序后，在启动页完成手机号绑定
5. 绑定成功后，才真正拥有 `admin` 角色

这样做的好处：

- 不依赖提前知道对方 `openId`
- 符合真实组织管理流程
- 方便回收权限
- 审计更清晰

## 7. 建议的管理员管理入口

你当前已有管理员管理界面，但正式版建议加一个更明确的限制：

- `admin` 只能看合约、门店、券规则
- `super_admin` 才显示“管理员管理”tab 或操作区

建议后续在管理后台页面里增加：

- 当前用户角色展示
- 超管专属入口控制
- 管理员邀请记录
- 角色停用/恢复
- 操作日志查看

## 8. 推荐索引

建议至少建立以下索引：

- `portal_users.openId`
- `portal_roles.openId + status`
- `portal_roles.roleKey + scopeId + status`
- `staff_invites.phone + roleKey + status`
- `contracts.openId + status`
- `coupons.contractId + status`
- `coupons.storeId + status`

## 9. 与当前项目的迁移顺序

建议按下面顺序推进：

1. 接入云环境初始化，但保留 mock 兜底
2. 先替换登录和角色识别
3. 再替换管理员/门店身份绑定
4. 再替换合约与卡券接口
5. 最后关闭 `mock.js`

## 10. 这份方案对应到你当前项目的改造重点

优先级最高的 4 件事：

1. 用云函数替换 `app.js` 里的本地角色判断
2. 用云端角色表替换 `utils/mock.js` 的 `admins` 和 `storeOwners`
3. 把 `packageAdmin/pages/admin/index.js` 的管理员管理，改成调用 `manageAdmin`
4. 为门店核销和合约处理补云函数级权限校验
