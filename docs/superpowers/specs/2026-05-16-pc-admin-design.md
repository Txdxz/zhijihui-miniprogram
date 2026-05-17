# P2: PC Admin Panel Design

## Architecture

```
┌──────────────────┐      ┌───────────────────┐      ┌──────────────────┐
│  Vue 3 + Element  │─────▶│  静态托管 (HTML/JS) │─────▶│  adminHttp (HTTP) │
│  浏览器管理面板     │      │   cloud static     │      │  云函数 HTTP触发   │
└──────────────────┘      └───────────────────┘      └────────┬─────────┘
                                                               │
                                                    ┌──────────▼─────────┐
                                                    │  portalBiz (原有)    │
                                                    │  cloud.callFunction │
                                                    └──────────┬─────────┘
                                                               │
                                                    ┌──────────▼─────────┐
                                                    │  数据库 (admin SDK)  │
                                                    └────────────────────┘
```

- **adminHttp**: HTTP 触发的云函数，接收浏览器所有请求，解析 JWT，通过 `cloud.callFunction` 调用 portalBiz
- **portalBiz 修改**: 支持 `_bypassOpenId` 参数，允许 adminHttp 凭 JWT 中的 openId 以指定身份调用
- **不做双重权限检查**: adminHttp 只验证 JWT 有效性（身份），具体权限逻辑全部交给 portalBiz 的 `ensureRole`/`ensureSuperAdmin`
- **JWT**: adminHttp 用 `jsonwebtoken` 签发/验证，payload 包含 `openId`, `roleKey`

## Login Flow

1. 用户打开管理面板
2. 检查 localStorage 是否有 JWT
   - 有效 → 进入管理面板
   - 过期 → 清除 JWT，显示登录页
   - 无 JWT → 显示登录页
3. 登录页加载时调用 adminHttp `/api/auth/generateQr`
4. 后端生成 uuid scene，写入 `login_sessions` 集合（status=0），生成小程序码图片返回给前端
5. 前端显示二维码，轮询 `/api/auth/checkLogin(scene)`，每秒一次
6. 管理员扫码 → 跳转小程序 → 小程序解析 scene 参数
7. 小程序确认页检查用户角色（必须是 admin/super_admin）
8. 管理员点击确认 → 调用 adminHttp `/api/auth/confirmLogin(scene)`
9. adminHttp 验证角色 → 生成 JWT → 更新 `login_sessions` 为已确认
10. 前端轮询到 status=1 → 获取 JWT → 存入 localStorage → 进入管理面板

非管理员扫码提示无权限。

## adminHttp 云函数

### 端点

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/generateQr` | 生成二维码 scene，返回小程序码 base64 |
| POST | `/api/auth/checkLogin` | 轮询登录状态，status=1 时返回 JWT |
| POST | `/api/auth/confirmLogin` | 管理员确认登录，生成 JWT |
| POST | `/api/rpc` | 统一业务 RPC 入口 |

### 文件结构

```
cloudfunctions/adminHttp/
├── index.js          # 主入口，按 path 路由
├── package.json      # 依赖: wx-server-sdk, jsonwebtoken
├── jwt.js            # JWT 签发与验证
├── auth.js           # 登录相关: generateQr/checkLogin/confirmLogin
└── rpc.js            # RPC 中转, 调用 portalBiz
```

### RPC 核心逻辑

```
浏览器 → POST /api/rpc (带 JWT + action + params)
  → adminHttp 验证 JWT
  → 解析出 openId, roleKey
  → adminHttp 调用 cloud.callFunction('portalBiz', { action, params, _bypassOpenId: openId })
  → portalBiz 执行原有逻辑（ensureRole 等）
  → 结果逐层返回
```

## portalBiz 修改

入口处（`index.js`）修改 OPENID 获取逻辑：

```javascript
const { OPENID: WX_OPENID } = cloud.getWXContext();
const OPENID = event._bypassOpenId || WX_OPENID;
```

`_bypassOpenId` 仅 adminHttp 传入，小程序端调用不受影响。

## 小程序确认页

**`pages/scanner/loginConfirm`**
- 通过 scene 参数接收登录请求标识
- 显示管理员头像、昵称、"确认登录管理后台" 按钮
- 点击确认 → 检查角色（admin/super_admin）→ 调用 adminHttp confirmLogin
- 非管理员提示无权限

## 前端页面

### 技术栈
- Vue 3 + Vite + Element Plus + Vue Router (hash) + Pinia + Axios
- 构建产物部署到微信云托管静态托管

### 页面结构

```
/login                扫码登录页（二维码 + 轮询）
/dashboard            数据概览（统计卡片）
/contracts            合约管理（列表 + 详情弹窗 + 审核）
/stores               门店管理（列表 + 新建/删除，仅 super_admin）
/coupons              代金券管理（列表 + 新建/配置，仅 super_admin）
/admins               管理员管理（列表 + 邀请链接，仅 super_admin）
```

### 布局

左侧 el-menu（可折叠）+ 右侧内容区 + 顶部栏（用户信息 + 退出）

### 权限控制

- 前端：路由守卫 + 菜单根据 roleKey 显示/隐藏
  - super_admin: 全部可见
  - admin: 仅 dashboard + contracts
- 后端：portalBiz 的 ensureRole 兜底

### 文件结构

```
pc-admin/
├── vite.config.js
├── package.json
├── index.html
├── src/
│   ├── main.js
│   ├── App.vue
│   ├── router/index.js         # 路由 + 守卫
│   ├── api/index.js            # axios 实例 + JWT 拦截器
│   ├── stores/user.js          # Pinia 用户状态
│   ├── views/
│   │   ├── Login.vue
│   │   ├── Dashboard.vue
│   │   ├── Contracts.vue
│   │   ├── Stores.vue
│   │   ├── Coupons.vue
│   │   └── Admins.vue
│   ├── layouts/AdminLayout.vue
│   └── components/
│       ├── StatCard.vue
│       └── ContractDetail.vue
```

## API 映射

前端通过 adminHttp RPC 调用，映射到 portalBiz 现有 action：

| 前端操作 | action | 说明 |
|---------|--------|------|
| 获取统计数据 | getAdminStats | 已有 |
| 合约列表 | adminGetContracts | 已有 |
| 合约审核 | auditContract | 已有 |
| 门店列表 | adminGetStores | 已有 |
| 新建门店 | adminCreateStore | 已有 |
| 删除门店 | adminDeleteStore | 已有 |
| 代金券列表 | adminGetCoupons | 已有 |
| 新建代金券 | adminCreateCoupon | 已有 |
| 管理员列表 | adminGetRoles | 已有 |
| 邀请管理员 | adminInviteRole | 已有 |

所有接口均已存在于 portalBiz，无需新增业务逻辑。
