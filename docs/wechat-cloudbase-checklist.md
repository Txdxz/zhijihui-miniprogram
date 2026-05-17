# 微信云开发落地清单

这份清单按“你一个人维护、尽量省心”的目标整理，默认你使用微信官方的云开发能力，而不是自建服务器。

## 1. 这个方案是否合理

结论：合理，而且很适合你当前阶段。

原因：

- 不需要购买和运维传统服务器
- 小程序、云函数、云数据库、云存储都在同一套体系里
- 小程序身份天然基于 `OPENID`，很适合做角色识别
- 对单人开发和初期试运营更省心

更适合你的前提：

- 业务主要发生在微信生态内
- 用户量处于早期到中早期
- 你希望优先把业务跑通，而不是先搭后端基础设施

## 2. 当前项目建议的正式路线

建议明确分 3 个阶段：

1. 先把登录、角色识别、身份绑定切到微信云开发
2. 再把管理员管理、门店核销、合约流转切到云函数
3. 最后再下线 `utils/mock.js`

当前仓库已经完成到第 1 阶段的骨架准备。

## 3. 你现在要做的实际操作

### 第一步：创建云开发环境

在微信开发者工具里：

1. 打开项目
2. 点击“云开发”
3. 开通环境
4. 记录环境 ID

然后修改 `utils/cloud-env.js`：

```js
module.exports = {
  USE_CLOUD: false,
  CLOUD_ENV_ID: '你的环境ID',
  TRACE_USER: true
};
```

建议先填 `CLOUD_ENV_ID`，暂时保持 `USE_CLOUD: false`。

### 第二步：部署云函数

当前已准备的云函数：

- `login`
- `resolveLaunchContext`
- `bindRoleByPhone`
- `manageAdmin`

建议在微信开发者工具中逐个部署，并勾选“云端安装依赖”。

### 第三步：创建基础集合

先创建这 4 个集合：

- `portal_users`
- `portal_roles`
- `staff_invites`
- `stores`

后续再补：

- `contracts`
- `coupons`
- `audit_logs`

### 第四步：初始化门店数据

先把当前 mock 里的门店录入 `stores`。

建议字段：

```json
{
  "storeId": "S001",
  "name": "爱宠汪汪宠物店",
  "address": "太原市迎泽区解放路88号",
  "phone": "13800001111",
  "location": { "lat": 37.857, "lng": 112.548 },
  "status": 1,
  "createdAt": "2026-04-08T00:00:00.000Z",
  "updatedAt": "2026-04-08T00:00:00.000Z"
}
```

### 第五步：创建第一个超级管理员

这是最关键的一步。

推荐方式：

1. 先部署 `login`
2. 把 `utils/cloud-env.js` 临时改成 `USE_CLOUD: true`
3. 打开小程序并点击“微信授权登录”
4. 登录成功后，在本地缓存或控制台确认当前 `openId`
5. 手工在 `portal_roles` 中插入一条 `super_admin` 记录

示例：

```json
{
  "openId": "这里填你的openId",
  "roleKey": "super_admin",
  "scopeType": "system",
  "scopeId": "portal",
  "scopeName": "智机惠管理后台",
  "permissions": [
    "admin.manage",
    "contract.manage",
    "store.manage",
    "coupon.rules.manage"
  ],
  "status": 1,
  "boundBy": "system_init",
  "createdAt": "2026-04-08T00:00:00.000Z",
  "updatedAt": "2026-04-08T00:00:00.000Z"
}
```

### 第六步：创建待绑定人员

管理员和门店人员建议都先写入 `staff_invites`，再由本人首次登录绑定。

管理员示例：

```json
{
  "phone": "13800000001",
  "name": "运营管理员",
  "roleKey": "admin",
  "scopeType": "system",
  "scopeId": "portal",
  "scopeName": "智机惠管理后台",
  "permissions": ["contract.manage", "store.manage", "coupon.rules.manage"],
  "status": 1,
  "boundOpenId": "",
  "boundAt": "",
  "createdBy": "super_admin_openid",
  "createdAt": "2026-04-08T00:00:00.000Z",
  "updatedAt": "2026-04-08T00:00:00.000Z"
}
```

门店负责人示例：

```json
{
  "phone": "13800001111",
  "name": "张老板",
  "roleKey": "store_owner",
  "scopeType": "store",
  "scopeId": "S001",
  "scopeName": "爱宠汪汪宠物店",
  "permissions": ["coupon.verify", "store.record.view"],
  "status": 1,
  "boundOpenId": "",
  "boundAt": "",
  "createdBy": "super_admin_openid",
  "createdAt": "2026-04-08T00:00:00.000Z",
  "updatedAt": "2026-04-08T00:00:00.000Z"
}
```

### 第七步：打开云开发身份链路

确认前面都完成后，再把 `utils/cloud-env.js` 改为：

```js
module.exports = {
  USE_CLOUD: true,
  CLOUD_ENV_ID: '你的环境ID',
  TRACE_USER: true
};
```

此时启动页会优先走云函数进行：

- 登录
- 角色识别
- 管理员绑定
- 门店绑定

## 4. 当前代码已经接好的位置

### 云环境初始化

- `utils/cloud.js`
- `utils/cloud-env.js`

### 启动登录与角色识别

- `app.js`
- `pages/launch/index.js`

### 云函数骨架

- `cloudfunctions/login/index.js`
- `cloudfunctions/resolveLaunchContext/index.js`
- `cloudfunctions/bindRoleByPhone/index.js`
- `cloudfunctions/manageAdmin/index.js`

## 5. 你现在先不要做的事

在你还没把 `contracts`、`coupons`、管理员管理页面迁到云函数之前，不建议马上把所有业务都切成正式环境。

原因：

- 当前身份链路已经可以云开发化
- 但合约、卡券、后台业务数据目前仍主要依赖 mock
- 一次性全切，容易让你单人维护时排错成本过高

更稳妥的做法是：

1. 先验证“登录和角色分流”正确
2. 再迁移管理员管理
3. 再迁移合约和券

## 6. 最适合你的实施节奏

如果你没有技术团队，我建议按这个节奏推进：

1. 本周先打通云登录、角色识别、首个超管
2. 下周迁移管理员管理和门店绑定
3. 再迁移合约、卡券、核销

这样每一阶段都能独立验证，不容易把小程序整体拖垮。
