# 云函数骨架说明

当前目录用于承接智机惠正式上线后的云开发能力。

## 推荐函数列表

- `login`
  用于建立用户会话，返回当前 `openId`
- `resolveLaunchContext`
  用于识别当前用户可进入的角色和页面
- `bindRoleByPhone`
  用于根据手机号完成管理员或门店身份绑定
- `manageAdmin`
  用于超管管理管理员邀请和角色回收

## 推荐集合

- `portal_users`
- `portal_roles`
- `staff_invites`
- `stores`
- `contracts`
- `coupons`
- `audit_logs`

## 迁移原则

- 所有敏感权限判断都放到云函数
- 小程序前端只做界面展示和交互控制
- 现有 `utils/mock.js` 仅保留开发演示用途

## 当前状态

本目录下提供了基础示例函数，便于你后续继续扩展。
