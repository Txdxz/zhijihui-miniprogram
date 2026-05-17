# 智机惠小程序（微信云开发正式版）

本项目已按微信云开发为主路径整理：

- 首次登录后按云端角色自动分流（客户 / 管理员 / 门店）
- 合约、卡包、核销、管理员识别走云函数
- 首页物流仅展示快递单号，不再做轨迹模拟

## 1. 本地配置

编辑 `utils/cloud-env.js`：

```js
module.exports = {
  USE_CLOUD: true,
  CLOUD_ENV_ID: '你的云环境ID',
  TRACE_USER: true
};
```

> 不填 `CLOUD_ENV_ID` 时，业务接口会提示“云开发未初始化”。

## 2. 需部署的云函数

在微信开发者工具中，分别右键上传并部署：

- `cloudfunctions/login`
- `cloudfunctions/resolveLaunchContext`
- `cloudfunctions/bindRoleByPhone`
- `cloudfunctions/manageAdmin`
- `cloudfunctions/portalBiz`

## 3. 需准备的云数据库集合

请在云开发控制台创建集合：

- `portal_users`
- `portal_roles`
- `staff_invites`
- `stores`
- `contracts`
- `coupons`

建议先录入至少 1 条门店数据到 `stores`（字段含 `storeId`, `name`, `address`, `status`）。

## 4. 超级管理员初始化

1. 先用你的微信打开小程序一次（触发 `login` 云函数入库）。
2. 在 `portal_roles` 新增一条记录：
   - `openId`: 你的 openid
   - `roleKey`: `super_admin`
   - `scopeType`: `system`
   - `scopeId`: `portal`
   - `status`: `1`
3. 重新进入小程序，即可进入管理后台。

## 5. 上线发布（微信云开发）

1. 开发者工具中点击“上传”，填写版本号与备注。
2. 登录微信公众平台小程序后台，进入“版本管理”提交审核。
3. 审核通过后点击“发布”。
4. 发布后在“云开发”确认生产环境数据库与云函数版本一致。

## 6. 当前业务说明

- 首页 Logo 已调整为“智机惠”。
- 登录页已移除物流插件联调入口等模拟测试入口。
- 合约进度卡片已去掉“已签收/已完成”状态条展示，避免与成功区块重复。
- 物流信息仅保留“快递公司 + 快递单号 + 复制单号”。
