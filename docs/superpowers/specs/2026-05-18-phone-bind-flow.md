# 一键绑定手机号与角色设计文档

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 接入微信 getPhoneNumber，用户首次进入时一键获取手机号并自动匹配管理员/店员角色绑定

**Architecture:** 在 resolveLaunchContext 中检测待绑定邀请但缺手机号时，返回特殊标识。启动页检测到此标识后，显示微信手机号授权按钮。获取加密数据后调用 portalBiz 解密并自动绑定。

**Tech Stack:** 微信小程序 button getPhoneNumber + wx-server-sdk decrypt + portalBiz 绑定逻辑

---

### Task 1: resolveLaunchContext 返回待绑定标识

**Files:**
- Modify: `cloudfunctions/resolveLaunchContext/index.js`

在 `staff_invites` 查询阶段，如果找到待绑定邀请（`roleOptions` 为空且存在 `staff_invites`），检查当前用户是否已有手机号。如果无手机号，返回 `needsPhoneBind: true`。

- [ ] 在 roleOptions 为空、存在待绑定邀请但用户无手机号的场景，返回 `data.needsPhoneBind: true`
- [ ] 如果用户已有手机号，走原有的自动绑定逻辑（不变）
- [ ] 如果已在门户角色中，走原有路由逻辑（不变）

### Task 2: 启动页（launch page）处理 needsPhoneBind

**Files:**
- Modify: `pages/launch/index.js`
- Modify: `pages/launch/index.wxml`

启动页 resolveAndRoute 返回 `needsPhoneBind: true` 时，显示授权按钮区域（隐藏原「已识别身份，点击进入」按钮）。

- [ ] JS: 增加 `needsPhoneBind` 状态 data 字段
- [ ] WXML: 增加授权按钮区域（getPhoneNumber button + 提示文字）
- [ ] 新增 `onGetPhoneNumber` 回调处理授权结果
- [ ] 授权成功后调用 `bindRoleByPhone` 完成绑定
- [ ] 绑定成功后自动路由到对应权限页面

### Task 3: portalBiz 新增 getPhoneNumber 解密逻辑

**Files:**
- Modify: `cloudfunctions/portalBiz/index.js`

新增 `handleBindPhoneAndRole` 处理函数，接收微信加密数据（code/iv/encryptedData），调用 `cloud.getPhoneNumber` 解密，然后执行绑定。

- [ ] 接收 `code` 参数，调用 `cloud.getPhoneNumber({ code })` 解密得到真实手机号
- [ ] 用得到的手机号查询 `staff_invites` 是否存在待绑定邀请
- [ ] 如果存在，创建 `portal_roles` 记录并标记邀请已绑定
- [ ] 返回绑定后的角色信息

### Task 4: admin panel 中清理手机号绑定问题

**Files:**
- No changes needed - admin panel 已通过手机号邀请的方式工作

### Task 5: 端到端验证

- [ ] 新用户（无角色、无手机号）→ 启动页显示授权按钮
- [ ] 用户拒绝授权 → 降级为普通用户
- [ ] 用户授权且匹配邀请 → 自动绑定 → 进入权限页面
- [ ] 已绑定用户 → 直接进入对应页面（无弹窗）
- [ ] 无邀请用户 → 直接进入普通用户页面
