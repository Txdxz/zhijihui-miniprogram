# 智机惠小程序安全加固实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成产品评价报告中第一阶段的安全加固工作，确保小程序上线前的安全性。

**Architecture:** 按照报告中的建议，分6个主要任务进行安全加固，每个任务都是独立可验证的。

**Tech Stack:** 微信小程序 + 微信云开发

---

## 任务清单

### Task 1: 加固 initDatabase 云函数

**Files:**
- Modify: `cloudfunctions/initDatabase/index.js`

**背景：** 当前 initDatabase 云函数无权限校验，任何人都可以调用创建超级管理员。

**目标：** 增加环境判断和权限校验，使其仅能在开发环境或特定条件下使用。

- [ ] **Step 1: 为 initDatabase 添加环境判断和权限校验**

修改 `cloudfunctions/initDatabase/index.js`，在函数开头添加：

```javascript
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  
  // 安全检查：检查是否已有超级管理员
  const existingAdminCheck = await db.collection('portal_roles')
    .where({
      roleKey: 'super_admin',
      status: 1
    })
    .limit(1)
    .get();
  
  // 如果已有超级管理员，禁止再次初始化
  if (existingAdminCheck.data && existingAdminCheck.data.length > 0) {
    return {
      code: 403,
      message: '系统已初始化，禁止重复操作'
    };
  }
  
  const results = {
    collections: [],
    data: [],
    errors: []
  };
  // ... 其余代码保持不变
};
```

---

### Task 2: 统一状态常量定义

**Files:**
- Modify: `utils/business-api.js`
- Modify: `utils/mock.js`
- Modify: `cloudfunctions/portalBiz/index.js`

**背景：** business-api.js 中 REJECTED: 0，而 mock.js 中 WAIT_INPUT: 0，状态值 0 冲突。

**目标：** 统一所有文件中的状态常量定义，保持一致性。

- [ ] **Step 1: 统一 business-api.js 的状态定义**

确认 `utils/business-api.js` 中的 STATES 定义为：

```javascript
const STATES = {
  WAIT_INPUT: 0,       // 等待输入手机号
  REJECTED: 0,         // 已拒绝（保持兼容，实际使用 WAIT_INPUT）
  WAIT_VERIFY: 1,      // 待核验
  QUALIFIED: 2,        // 核验通过
  WAIT_SMSCODE: 3,     // 待短信验证
  CONTRACTING: 4,      // 办理中
  CONTRACT_OK: 5,      // 合约完成
  SHIPPED: 6,          // 已发货
  SIGNED: 7,           // 已签收
  SMS_CODE_REJECTED: 8 // 验证码被驳回
};
```

同时添加注释说明 WAIT_INPUT 和 REJECTED 都是 0，保持向后兼容。

- [ ] **Step 2: 确认 mock.js 状态定义一致**

确保 `utils/mock.js` 中的 STATES 定义与 business-api.js 一致，特别是 WAIT_INPUT: 0。

- [ ] **Step 3: 确认 portalBiz 云函数状态定义一致**

确保 `cloudfunctions/portalBiz/index.js` 中的 STATES 定义保持一致。

---

### Task 3: 统一所有云函数的 wx-server-sdk 版本

**Files:**
- Modify: `cloudfunctions/sendSubscribeMessage/package.json`
- Modify: `cloudfunctions/initDatabase/package.json`
- Modify: `cloudfunctions/portalBiz/package.json`
- Modify: `cloudfunctions/manageAdmin/package.json`
- Modify: `cloudfunctions/login/package.json`
- Modify: `cloudfunctions/bindRoleByPhone/package.json`
- Modify: `cloudfunctions/resolveLaunchContext/package.json`

**背景：** 各云函数使用不同版本的 wx-server-sdk（~2.6.3、latest、^3.0.1）。

**目标：** 统一所有云函数使用相同版本的 wx-server-sdk（^3.0.1）。

- [ ] **Step 1: 更新 sendSubscribeMessage/package.json**

修改 `cloudfunctions/sendSubscribeMessage/package.json`：

```json
{
  "name": "sendSubscribeMessage",
  "version": "1.0.0",
  "description": "发送订阅消息通知管理员",
  "main": "index.js",
  "dependencies": {
    "wx-server-sdk": "^3.0.1"
  }
}
```

- [ ] **Step 2: 更新 initDatabase/package.json**

修改 `cloudfunctions/initDatabase/package.json`：

```json
{
  "name": "initDatabase",
  "version": "1.0.0",
  "description": "初始化数据库集合和示例数据",
  "main": "index.js",
  "dependencies": {
    "wx-server-sdk": "^3.0.1"
  }
}
```

- [ ] **Step 3: 更新 portalBiz/package.json**

修改 `cloudfunctions/portalBiz/package.json`：

```json
{
  "name": "portalBiz",
  "version": "1.0.0",
  "main": "index.js",
  "license": "MIT",
  "dependencies": {
    "wx-server-sdk": "^3.0.1"
  }
}
```

---

### Task 4: 为 queryPendingInvites 增加调用者身份校验

**Files:**
- Modify: `cloudfunctions/portalBiz/index.js`

**背景：** 任何人输入手机号就能查询该手机号的待绑定角色邀请，存在信息泄露风险。

**目标：** 增加调用者身份校验，只允许授权用户查询。

- [ ] **Step 1: 修改 handleQueryPendingInvites 函数**

在 `cloudfunctions/portalBiz/index.js` 中，修改 `handleQueryPendingInvites` 函数：

```javascript
async function handleQueryPendingInvites(openId, event = {}) {
  const phone = String(event.phone || '').trim();
  if (!phone || !/^1\d{10}$/.test(phone)) {
    return { code: 400, message: '请输入正确的手机号' };
  }
  
  // 安全检查：只允许管理员或本人查询
  const isAdmin = await ensureRole(openId, ['admin', 'super_admin']);
  
  // 如果不是管理员，检查是否是查询自己的手机号
  if (!isAdmin) {
    // 查询该手机号是否已绑定到当前用户
    const userRes = await db.collection('portal_users').where({
      openId,
      phone
    }).limit(1).get();
    
    if (!userRes.data || userRes.data.length === 0) {
      // 也检查角色表中是否有该手机号绑定到当前用户
      const roleRes = await db.collection('portal_roles').where({
        openId,
        phone
      }).limit(1).get();
      
      if (!roleRes.data || roleRes.data.length === 0) {
        return { 
          code: 403, 
          message: '无权查询该手机号信息' 
        };
      }
    }
  }

  const inviteRes = await db.collection('staff_invites').where({
    phone,
    boundOpenId: '',
    status: 1
  }).get();

  const invites = (inviteRes.data || []).map(inv => ({
    roleKey: inv.roleKey,
    roleType: inv.roleKey === 'store_owner' ? '门店负责人' :
              inv.roleKey === 'store_clerk' ? '店员' :
              inv.roleKey === 'admin' ? '管理员' : inv.roleKey,
    scopeType: inv.scopeType,
    scopeId: inv.scopeId,
    scopeName: inv.scopeName || ''
  }));

  return { code: 200, data: invites };
}
```

- [ ] **Step 2: 更新 exports.main 中的调用**

修改 `cloudfunctions/portalBiz/index.js` 中的 exports.main，传递 openId：

```javascript
if (action === 'queryPendingInvites') return handleQueryPendingInvites(OPENID, event);
```

---

### Task 5: 配置微信隐私协议

**Files:**
- Create: `miniprogram/__privacy__.json`

**背景：** 项目涉及手机号收集、位置信息获取等敏感操作，但缺少微信隐私协议配置。

**目标：** 创建微信小程序隐私协议配置文件。

- [ ] **Step 1: 创建隐私协议配置文件**

创建 `miniprogram/__privacy__.json`：

```json
{
  "ownerSetting": {
    "contactEmail": "",
    "contactPhone": "",
    "contactQQ": "",
    "contactWeixin": "",
    "storeExpireTimestamp": "",
    "storeMethod": "存储到云服务器",
    "storeRegion": "中国大陆"
  },
  "privacyItems": [
    {
      "itemId": "userInfo",
      "itemName": "用户信息",
      "itemDescription": "用于完善用户资料"
    },
    {
      "itemId": "location",
      "itemName": "位置信息",
      "itemDescription": "用于匹配附近门店"
    },
    {
      "itemId": "address",
      "itemName": "地址",
      "itemDescription": "用于合约商品配送"
    },
    {
      "itemId": "phoneNumber",
      "itemName": "手机号",
      "itemDescription": "用于身份验证和联系用户"
    },
    {
      "itemId": "camera",
      "itemName": "摄像头",
      "itemDescription": "用于扫码核销代金券"
    }
  ]
}
```

---

### Task 6: 清理敏感调试日志

**Files:**
- Check: `pages/verify/index.js` (或相关有 console.log 的文件)
- Check: `pages/admin/index.js`
- Check: 其他可能包含敏感日志的文件

**背景：** 多处 console.log 调试日志残留在代码中，包括敏感数据打印。

**目标：** 清理或注释掉敏感的调试日志。

- [ ] **Step 1: 查找并清理敏感日志**

搜索项目中的 console.log，特别是打印敏感数据的地方，进行清理或注释。

---

## 验证清单

完成以上任务后，请验证：

- [ ] initDatabase 云函数在已有超级管理员时返回 403
- [ ] 所有文件中的状态常量定义一致
- [ ] 所有云函数的 package.json 中 wx-server-sdk 版本统一为 ^3.0.1
- [ ] queryPendingInvites 只能由管理员或本人查询
- [ ] __privacy__.json 文件已创建
- [ ] 敏感调试日志已清理
