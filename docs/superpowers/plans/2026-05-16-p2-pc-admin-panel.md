# P2: PC Admin Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a PC admin panel deployed on WeChat Cloud static hosting with QR scan login, reusing existing portalBiz cloud functions via an adminHttp HTTP-triggered bridge.

**Architecture:** Vue 3 + Element Plus frontend served via cloud static hosting → adminHttp HTTP cloud function (JWT verification + RPC proxy) → portalBiz (existing business logic with _bypassOpenId support) → database (admin SDK).

**Tech Stack:** Vue 3, Vite, Element Plus, Vue Router, Pinia, Axios, wx-server-sdk, jsonwebtoken, qrcode.js

---

### Task 1: Add _bypassOpenId support to portalBiz

**Files:**
- Modify: `cloudfunctions/portalBiz/index.js`

**Context:** portalBiz currently gets OPENID from `cloud.getWXContext()`. When adminHttp calls portalBiz via `cloud.callFunction`, the OPENID in the callee context will be the adminHttp function's identity, not the admin user's. We need to accept a `_bypassOpenId` from the caller.

- [ ] **Step 1: Locate the OPENID assignment**

Find the line at the top of `exports.main`:
```javascript
const { OPENID } = cloud.getWXContext();
```

- [ ] **Step 2: Change to support bypass**

Replace with:
```javascript
const { OPENID: WX_OPENID } = cloud.getWXContext();
const OPENID = event._bypassOpenId || WX_OPENID;
```

This ensures:
- When called from the mini-program directly (no _bypassOpenId), uses the real WX_OPENID
- When called from adminHttp (with _bypassOpenId), uses the admin's openId
- All existing ensureRole/ensureSuperAdmin calls continue to work unchanged

- [ ] **Step 3: Verify the change**

Read around line 190-210 to confirm `ensureRole` and `ensureSuperAdmin` use the `OPENID` variable (not `cloud.getWXContext().OPENID`). They should reference the same `OPENID` const defined at the top.

---

### Task 2: Create adminHttp cloud function

**Files:**
- Create: `cloudfunctions/adminHttp/index.js`
- Create: `cloudfunctions/adminHttp/package.json`
- Create: `cloudfunctions/adminHttp/jwt.js`
- Create: `cloudfunctions/adminHttp/auth.js`
- Create: `cloudfunctions/adminHttp/rpc.js`

**Context:** This is the HTTP-triggered cloud function that serves as the bridge between the browser-based admin panel and the existing portalBiz cloud function. It handles JWT authentication, QR code login flow, and RPC proxying.

- [ ] **Step 1: Create package.json**

```json
{
  "name": "adminHttp",
  "version": "1.0.0",
  "description": "PC admin panel HTTP bridge",
  "main": "index.js",
  "dependencies": {
    "wx-server-sdk": "^3.0.1",
    "jsonwebtoken": "^9.0.2"
  }
}
```

- [ ] **Step 2: Create jwt.js**

```javascript
const cloud = require('wx-server-sdk');
const jwt = require('jsonwebtoken');

function getSecret() {
  // 基于环境 ID 的密钥，不同环境使用不同签名
  const env = cloud.getWXContext().ENV || 'unknown';
  return 'zjh_admin_jwt_' + env;
}

function sign(payload) {
  return jwt.sign(payload, getSecret(), { expiresIn: '12h' });
}

function verify(token) {
  try {
    return jwt.verify(token, getSecret());
  } catch (e) {
    return null;
  }
}

module.exports = { sign, verify };
```

- [ ] **Step 3: Create auth.js**

```javascript
const cloud = require('wx-server-sdk');
const { sign } = require('./jwt');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

async function handleAuth({ action, scene }) {
  const { OPENID } = cloud.getWXContext();

  if (action === 'generateQr') {
    const sceneId = 'login_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
    const now = Date.now();

    await db.collection('login_sessions').add({
      data: {
        scene: sceneId,
        openId: '',
        status: 0,
        createdAt: now,
        updatedAt: now
      }
    });

    // 通过微信云调用生成小程序码
    let qrBase64 = '';
    try {
      const wxRes = await cloud.openapi.wxacode.getUnlimited({
        scene: sceneId,
        page: 'pages/scanner/loginConfirm',
        width: 280
      });
      qrBase64 = wxRes.buffer.toString('base64');
    } catch (e) {
      console.error('getUnlimited error:', e);
    }

    return { code: 200, data: { scene: sceneId, qrBase64 } };
  }

  if (action === 'checkLogin') {
    // 查询是否有已确认的登录会话
    const { data: sessions } = await db.collection('login_sessions')
      .where({ scene, status: 1 }).limit(1).get();

    if (\!sessions.length) {
      return { code: 200, data: { status: 0 } };
    }

    const token = sign({ openId: sessions[0].openId });
    return { code: 200, data: { status: 1, token } };
  }

  if (action === 'confirmLogin') {
    // 验证扫码用户是否为管理员
    const { data: roles } = await db.collection('portal_roles')
      .where({
        openId: OPENID,
        roleKey: _.in(['admin', 'super_admin']),
        status: 1
      }).limit(1).get();

    if (\!roles.length) {
      return { code: 403, message: '仅管理员可登录管理后台' };
    }

    const token = sign({ openId: OPENID, roleKey: roles[0].roleKey });
    await db.collection('login_sessions').where({ scene }).update({
      data: { openId: OPENID, status: 1, updatedAt: Date.now() }
    });

    return { code: 200, data: { token } };
  }

  return { code: 400, message: '未知的 auth 操作' };
}

module.exports = { handleAuth };
```

Note: `auth.js` uses `_.in` which requires `const _ = db.command;` at the top. Add it.

- [ ] **Step 4: Create rpc.js**

```javascript
const cloud = require('wx-server-sdk');
const { verify } = require('./jwt');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

async function handleRpc({ headers, body }) {
  const parsed = JSON.parse(body || '{}');

  // 从 Authorization header 或 body 中取 token
  const authHeader = headers && headers.Authorization ? headers.Authorization : '';
  const token = parsed.token || authHeader.replace('Bearer ', '');

  const decoded = verify(token);
  if (\!decoded) {
    return { code: 401, message: '登录已过期，请重新登录' };
  }

  const result = await cloud.callFunction({
    name: 'portalBiz',
    data: {
      action: parsed.action,
      ...(parsed.params || {}),
      _bypassOpenId: decoded.openId
    }
  });

  return result.result;
}

module.exports = { handleRpc };
```

- [ ] **Step 5: Create index.js**

```javascript
const cloud = require('wx-server-sdk');
const { handleAuth } = require('./auth');
const { handleRpc } = require('./rpc');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

exports.main = async (event = {}) => {
  const { path, httpMethod, headers, body } = event;

  // 处理 OPTIONS 预检请求
  if (httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS };
  }

  try {
    let result;

    if (path === '/api/auth/generateQr') {
      result = await handleAuth({ action: 'generateQr' });
    } else if (path === '/api/auth/checkLogin') {
      const { scene } = JSON.parse(body || '{}');
      result = await handleAuth({ action: 'checkLogin', scene });
    } else if (path === '/api/auth/confirmLogin') {
      const { scene } = JSON.parse(body || '{}');
      result = await handleAuth({ action: 'confirmLogin', scene });
    } else if (path === '/api/rpc') {
      result = await handleRpc({ headers, body });
    } else {
      result = { code: 404, message: '未知接口' };
    }

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(result) };
  } catch (err) {
    console.error('adminHttp error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ code: 500, message: '服务异常' })
    };
  }
};
```

- [ ] **Step 6: Install dependencies**

```bash
cd cloudfunctions/adminHttp
npm install
```

- [ ] **Step 7: Add adminHttp to project config**

Edit `project.config.json` to ensure the `cloudfunctions` root includes `adminHttp`, or if using the newer config format, add it to `cloudfunctionRoot`.

- [ ] **Step 8: Upload and configure HTTP trigger**

In WeChat DevTools:
1. Right-click `cloudfunctions/adminHttp` → Upload and Deploy
2. Go to WeChat Cloud Console → Cloud Function → adminHttp → HTTP Trigger
3. Enable HTTP trigger with path: `/adminHttp`
4. Note the public URL (e.g., `https://<env-id>.service.tcloudbase.com/adminHttp`)


### Task 3: Create scanner loginConfirm mini-program page

**Files:**
- Create: `pages/scanner/loginConfirm/index.js`
- Create: `pages/scanner/loginConfirm/index.wxml`
- Create: `pages/scanner/loginConfirm/index.wxss`
- Create: `pages/scanner/loginConfirm/index.json`
- Modify: `app.json` (add route)

**Context:** When a WeChat user scans the QR code from the PC admin panel, WeChat opens this page with the scene parameter. The page shows user info and a confirm button. On confirm, it calls adminHttp to mark the login session as confirmed.

- [ ] **Step 1: Create index.json**

```json
{
  "navigationBarTitleText": "登录管理后台",
  "navigationBarBackgroundColor": "#ffffff",
  "usingComponents": {}
}
```

- [ ] **Step 2: Create index.wxml**

```xml
<view class="page">
  <view class="card">
    <view class="header-icon">
      <image class="avatar" src="{{userInfo.avatarUrl || '/images/default-avatar.png'}}" />
    </view>
    <view class="nickname">{{userInfo.nickName || '微信用户'}}</view>
    <view class="hint">确认登录 PC 管理后台</view>

    <button class="confirm-btn" type="primary" loading="{{loading}}" bindtap="onConfirm">
      {{loading ? '确认中...' : '确认登录'}}
    </button>

    <view class="error" wx:if="{{error}}">{{error}}</view>

    <view class="tip">非管理员请勿确认，确认后将授予管理后台访问权限</view>
  </view>
</view>
```

- [ ] **Step 3: Create index.wxss**

```css
.page {
  min-height: 100vh;
  background: #f5f6fa;
  display: flex;
  justify-content: center;
  padding-top: 80rpx;
}
.card {
  background: #fff;
  border-radius: 24rpx;
  padding: 60rpx 48rpx;
  width: 600rpx;
  text-align: center;
  box-shadow: 0 4rpx 20rpx rgba(0,0,0,0.06);
}
.header-icon { margin-bottom: 24rpx; }
.avatar {
  width: 128rpx;
  height: 128rpx;
  border-radius: 50%;
}
.nickname {
  font-size: 36rpx;
  font-weight: 600;
  color: #333;
  margin-bottom: 16rpx;
}
.hint {
  font-size: 28rpx;
  color: #666;
  margin-bottom: 48rpx;
}
.confirm-btn {
  width: 100%;
  margin-bottom: 24rpx;
}
.error {
  color: #ee0a24;
  font-size: 26rpx;
  margin-bottom: 16rpx;
}
.tip {
  font-size: 24rpx;
  color: #999;
}
```

- [ ] **Step 4: Create index.js**

```javascript
const API_BASE = 'https://<env-id>.service.tcloudbase.com/adminHttp';

Page({
  data: {
    scene: '',
    userInfo: {},
    loading: false,
    error: ''
  },

  onLoad(options) {
    // scene 参数从扫码进入时自动携带
    const scene = decodeURIComponent(options.scene || '');
    this.setData({ scene });

    // 获取当前用户信息
    const app = getApp();
    if (app.globalData.currentUser) {
      this.setData({ userInfo: app.globalData.currentUser });
    } else {
      // 从本地存储或重新登录获取
      wx.getUserProfile({
        desc: '用于确认登录身份',
        success: (res) => {
          this.setData({ userInfo: res.userInfo });
        },
        fail: () => {
          // 降级处理
          this.setData({
            userInfo: { nickName: '微信用户', avatarUrl: '' }
          });
        }
      });
    }
  },

  async onConfirm() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });

    try {
      const res = await new Promise((resolve, reject) => {
        wx.request({
          url: API_BASE + '/api/auth/confirmLogin',
          method: 'POST',
          data: { scene: this.data.scene },
          success: resolve,
          fail: reject
        });
      });

      const result = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;

      if (result.code === 200) {
        wx.showToast({ title: '登录成功', icon: 'success' });
        // 延迟关闭，让用户看到成功提示
        setTimeout(() => wx.navigateBack(), 1500);
      } else {
        this.setData({ error: result.message || '确认失败' });
      }
    } catch (e) {
      this.setData({ error: '网络错误，请重试' });
    } finally {
      this.setData({ loading: false });
    }
  }
});
```

- [ ] **Step 5: Register the page in app.json**

Find the `"pages"` array in `app.json` and add:
```json
"pages/scanner/loginConfirm/index"
```


### Task 4: Scaffold Vue 3 frontend project

**Files:**
- Create: `pc-admin/package.json`
- Create: `pc-admin/vite.config.js`
- Create: `pc-admin/index.html`
- Create: `pc-admin/src/main.js`
- Create: `pc-admin/src/App.vue`
- Create: `pc-admin/src/router/index.js`
- Create: `pc-admin/src/api/index.js`
- Create: `pc-admin/src/stores/user.js`
- Create: `pc-admin/src/layouts/AdminLayout.vue`
- Create: `pc-admin/.env`

**Context:** The Vue 3 frontend is the PC admin panel UI. It's a separate project from the mini-program, deployed to WeChat Cloud static hosting.

- [ ] **Step 1: Create package.json**

```json
{
  "name": "pc-admin",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "vue": "^3.4.0",
    "vue-router": "^4.3.0",
    "pinia": "^2.1.0",
    "axios": "^1.7.0",
    "element-plus": "^2.7.0",
    "qrcode": "^1.5.4"
  },
  "devDependencies": {
    "vite": "^5.4.0",
    "@vitejs/plugin-vue": "^5.1.0",
    "element-plus": "^2.7.0"
  }
}
```

- [ ] **Step 2: Create .env**

```
VITE_API_BASE=https://your-env-id.service.tcloudbase.com/adminHttp
```

Leave placeholder — developer replaces with actual URL after enabling HTTP trigger.

- [ ] **Step 3: Create vite.config.js**

```javascript
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_BASE || 'http://localhost',
        changeOrigin: true
      }
    }
  }
});
```

- [ ] **Step 4: Create index.html**

```html
<\!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>智机惠 - 管理后台</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.js"></script>
</body>
</html>
```

- [ ] **Step 5: Create src/main.js**

```javascript
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import App from './App.vue';
import router from './router';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(ElementPlus, { locale: zhCn }); // 引入 ElementPlus 中文
app.mount('#app');
```

Note: `zhCn` needs importing:
```javascript
import zhCn from 'element-plus/es/locale/lang/zh-cn';
```

- [ ] **Step 6: Create src/App.vue**

```vue
<template>
  <router-view />
</template>
```

- [ ] **Step 7: Create src/router/index.js**

```javascript
import { createRouter, createWebHashHistory } from 'vue-router';

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/Login.vue'),
    meta: { public: true }
  },
  {
    path: '/',
    component: () => import('@/layouts/AdminLayout.vue'),
    meta: { requiresAuth: true },
    redirect: '/dashboard',
    children: [
      {
        path: 'dashboard',
        name: 'Dashboard',
        component: () => import('@/views/Dashboard.vue'),
        meta: { title: '数据概览' }
      },
      {
        path: 'contracts',
        name: 'Contracts',
        component: () => import('@/views/Contracts.vue'),
        meta: { title: '合约管理' }
      },
      {
        path: 'stores',
        name: 'Stores',
        component: () => import('@/views/Stores.vue'),
        meta: { title: '门店管理', role: 'super_admin' }
      },
      {
        path: 'coupons',
        name: 'Coupons',
        component: () => import('@/views/Coupons.vue'),
        meta: { title: '代金券管理', role: 'super_admin' }
      },
      {
        path: 'admins',
        name: 'Admins',
        component: () => import('@/views/Admins.vue'),
        meta: { title: '管理员管理', role: 'super_admin' }
      }
    ]
  }
];

const router = createRouter({
  history: createWebHashHistory(),
  routes
});

router.beforeEach((to, from, next) => {
  const token = localStorage.getItem('adminToken');
  const roleKey = localStorage.getItem('adminRoleKey');

  if (to.meta.public) {
    next();
    return;
  }

  if (\!token) {
    next('/login');
    return;
  }

  // 角色路由守卫
  if (to.meta.role && to.meta.role === 'super_admin' && roleKey \!== 'super_admin') {
    next('/dashboard');
    return;
  }

  next();
});

export default router;
```

- [ ] **Step 8: Create src/api/index.js**

```javascript
import axios from 'axios';
import { ElMessage } from 'element-plus';
import router from '@/router';

const API_BASE = import.meta.env.VITE_API_BASE || '';

const api = axios.create({ baseURL: API_BASE, timeout: 15000 });

api.interceptors.request.use(config => {
  const token = localStorage.getItem('adminToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  res => res.data,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('adminToken');
      localStorage.removeItem('adminRoleKey');
      router.push('/login');
      ElMessage.error('登录已过期，请重新登录');
    }
    return Promise.reject(err);
  }
);

export function rpc(action, params = {}) {
  return api.post('/api/rpc', { action, params });
}

export default api;
```

- [ ] **Step 9: Create src/stores/user.js**

```javascript
import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useUserStore = defineStore('user', () => {
  const token = ref(localStorage.getItem('adminToken') || '');
  const roleKey = ref(localStorage.getItem('adminRoleKey') || '');
  const openId = ref(localStorage.getItem('adminOpenId') || '');

  function setAuth(t, r, o) {
    token.value = t;
    roleKey.value = r;
    openId.value = o;
    localStorage.setItem('adminToken', t);
    localStorage.setItem('adminRoleKey', r);
    localStorage.setItem('adminOpenId', o);
  }

  function clearAuth() {
    token.value = '';
    roleKey.value = '';
    openId.value = '';
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminRoleKey');
    localStorage.removeItem('adminOpenId');
  }

  function isSuperAdmin() {
    return roleKey.value === 'super_admin';
  }

  return { token, roleKey, openId, setAuth, clearAuth, isSuperAdmin };
});
```

- [ ] **Step 10: Create src/layouts/AdminLayout.vue**

```vue
<template>
  <el-container style="height: 100vh">
    <el-aside :width="isCollapse ? '64px' : '220px'">
      <div class="logo">{{ isCollapse ? '智' : '智机惠管理' }}</div>
      <el-menu
        :default-active="activeMenu"
        :collapse="isCollapse"
        background-color="#001529"
        text-color="#fff"
        active-text-color="#409eff"
        router
      >
        <el-menu-item index="/dashboard">
          <el-icon><DataAnalysis /></el-icon>
          <span>数据概览</span>
        </el-menu-item>
        <el-menu-item index="/contracts">
          <el-icon><Document /></el-icon>
          <span>合约管理</span>
        </el-menu-item>
        <el-menu-item index="/stores" v-if="isSuperAdmin">
          <el-icon><Shop /></el-icon>
          <span>门店管理</span>
        </el-menu-item>
        <el-menu-item index="/coupons" v-if="isSuperAdmin">
          <el-icon><Ticket /></el-icon>
          <span>代金券管理</span>
        </el-menu-item>
        <el-menu-item index="/admins" v-if="isSuperAdmin">
          <el-icon><User /></el-icon>
          <span>管理员管理</span>
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header>
        <div class="header-left">
          <el-icon style="cursor:pointer" @click="isCollapse = \!isCollapse">
            <Fold />
          </el-icon>
        </div>
        <div class="header-right">
          <el-dropdown trigger="click">
            <span class="user-info">
              {{ roleKey === 'super_admin' ? '超级管理员' : '管理员' }}
              <el-icon><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-item @click="handleLogout">退出登录</el-dropdown-item>
            </template>
          </el-dropdown>
        </div>
      </el-header>
      <el-main>
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useUserStore } from '@/stores/user';
import { DataAnalysis, Document, Shop, Ticket, User, Fold, ArrowDown } from '@element-plus/icons-vue';

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();

const isCollapse = ref(false);
const isSuperAdmin = computed(() => userStore.isSuperAdmin());
const roleKey = computed(() => userStore.roleKey);
const activeMenu = computed(() => route.path);

function handleLogout() {
  userStore.clearAuth();
  router.push('/login');
}
</script>

<style scoped>
.el-aside { background: #001529; transition: width 0.3s; }
.logo {
  height: 60px; line-height: 60px; text-align: center;
  color: #fff; font-size: 18px; font-weight: bold;
  border-bottom: 1px solid rgba(255,255,255,0.1);
  overflow: hidden; white-space: nowrap;
}
.el-menu { border-right: none; }
.el-header {
  display: flex; align-items: center; justify-content: space-between;
  background: #fff; border-bottom: 1px solid #eee; padding: 0 20px;
}
.header-left { display: flex; align-items: center; }
.header-right { display: flex; align-items: center; }
.user-info { cursor: pointer; display: flex; align-items: center; gap: 4px; }
.el-main { background: #f5f6fa; }
</style>
```

- [ ] **Step 11: Install dependencies and verify dev server starts**

```bash
cd pc-admin
npm install
npm run dev
```

Expected: Dev server starts on http://localhost:5173 with no errors.


### Task 5: Create Login + Dashboard views

**Files:**
- Create: `pc-admin/src/views/Login.vue`
- Create: `pc-admin/src/views/Dashboard.vue`
- Create: `pc-admin/src/components/StatCard.vue`

- [ ] **Step 1: Create StatCard.vue**

```vue
<template>
  <el-card shadow="hover" class="stat-card">
    <div class="stat-value">{{ value }}</div>
    <div class="stat-label">{{ label }}</div>
  </el-card>
</template>

<script setup>
defineProps({
  value: { type: [String, Number], default: '0' },
  label: { type: String, default: '' }
});
</script>

<style scoped>
.stat-card { text-align: center; cursor: default; }
.stat-value {
  font-size: 36px; font-weight: bold; color: #409eff;
  line-height: 1.2; margin-bottom: 8px;
}
.stat-label { font-size: 14px; color: #666; }
</style>
```

- [ ] **Step 2: Create Login.vue**

```vue
<template>
  <div class="login-page">
    <div class="login-card">
      <h2 class="title">智机惠管理后台</h2>
      <p class="subtitle">请使用微信扫描二维码登录</p>
      <div class="qr-wrapper">
        <canvas ref="qrCanvas"></canvas>
        <el-icon v-if="\!qrReady" class="loading-icon" :size="48"><Loading /></el-icon>
      </div>
      <p class="status">{{ statusText }}</p>
      <el-alert v-if="error" type="error" :description="error" show-icon :closable="false" />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useUserStore } from '@/stores/user';
import { Loading } from '@element-plus/icons-vue';
import QRCode from 'qrcode';
import api from '@/api';

const router = useRouter();
const userStore = useUserStore();
const qrCanvas = ref(null);
const qrReady = ref(false);
const error = ref('');
const statusText = ref('正在获取二维码...');

let scene = '';
let pollTimer = null;

onMounted(async () => {
  // 如果已有有效 token，直接跳转
  if (userStore.token) {
    router.push('/dashboard');
    return;
  }

  try {
    const res = await api.post('/api/auth/generateQr');
    const result = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;

    if (result.code \!== 200 || \!result.data) {
      error.value = '获取二维码失败';
      statusText.value = '请刷新页面重试';
      return;
    }

    scene = result.data.scene;
    statusText.value = '请使用微信扫码登录';

    if (result.data.qrBase64) {
      // 后端返回了小程序码 base64
      const img = new Image();
      img.onload = () => {
        const ctx = qrCanvas.value.getContext('2d');
        qrCanvas.value.width = 200;
        qrCanvas.value.height = 200;
        ctx.drawImage(img, 0, 0, 200, 200);
        qrReady.value = true;
      };
      img.src = 'data:image/png;base64,' + result.data.qrBase64;
    } else {
      // 降级：用 qrcode.js 生成二维码（内容为登录页面 URL）
      const loginUrl = window.location.origin + window.location.pathname + '#/login?scene=' + scene;
      QRCode.toCanvas(qrCanvas.value, loginUrl, { width: 200 }, () => {
        qrReady.value = true;
      });
    }

    startPolling();
  } catch (e) {
    error.value = '网络错误，请检查网络连接';
    statusText.value = '加载失败';
  }
});

function startPolling() {
  pollTimer = setInterval(async () => {
    try {
      const res = await api.post('/api/auth/checkLogin', { scene });
      const result = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
      if (result.code === 200 && result.data?.status === 1) {
        clearInterval(pollTimer);
        userStore.setAuth(result.data.token, 'admin', '');
        statusText.value = '登录成功，正在跳转...';
        setTimeout(() => router.push('/dashboard'), 500);
      }
    } catch (e) {
      // 轮询失败静默处理
    }
  }, 1000);
}

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<style scoped>
.login-page {
  height: 100vh; display: flex; justify-content: center;
  align-items: center; background: #f5f6fa;
}
.login-card {
  background: #fff; border-radius: 12px; padding: 48px 40px;
  text-align: center; box-shadow: 0 2px 12px rgba(0,0,0,0.08);
  width: 400px;
}
.title { font-size: 24px; margin: 0 0 8px; color: #333; }
.subtitle { font-size: 14px; color: #999; margin-bottom: 32px; }
.qr-wrapper {
  position: relative; width: 200px; height: 200px;
  margin: 0 auto 24px; display: flex; align-items: center; justify-content: center;
}
.loading-icon { position: absolute; color: #409eff; }
.status { font-size: 14px; color: #666; margin-bottom: 16px; }
</style>
```

- [ ] **Step 3: Create Dashboard.vue**

```vue
<template>
  <div class="dashboard">
    <h3 class="page-title">数据概览</h3>
    <el-row :gutter="20" class="stat-row">
      <el-col :span="6"><StatCard :value="stats.pendingContracts" label="待审核合约" /></el-col>
      <el-col :span="6"><StatCard :value="stats.todayContracts" label="今日新增合约" /></el-col>
      <el-col :span="6"><StatCard :value="stats.totalCoupons" label="代金券总数" /></el-col>
      <el-col :span="6"><StatCard :value="stats.totalStores" label="门店总数" /></el-col>
    </el-row>

    <el-card class="recent-card">
      <template #header>最近合约</template>
      <el-table :data="recentContracts" v-loading="loading" stripe style="width: 100%">
        <el-table-column prop="contractNo" label="合约编号" width="180" />
        <el-table-column prop="storeName" label="门店" width="150" />
        <el-table-column prop="customerName" label="客户" width="120" />
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" width="180" />
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import StatCard from '@/components/StatCard.vue';
import { rpc } from '@/api';

const loading = ref(false);
const stats = ref({ pendingContracts: 0, todayContracts: 0, totalCoupons: 0, totalStores: 0 });
const recentContracts = ref([]);

const STATES = {
  0: { label: '已驳回', type: 'danger' },
  1: { label: '待审核', type: 'warning' },
  2: { label: '已通过', type: 'success' },
  3: { label: '待验证码', type: '' },
  4: { label: '办理中', type: '' },
  5: { label: '办理完成', type: 'success' },
  6: { label: '已发货', type: '' },
  7: { label: '已签约', type: 'success' },
  8: { label: '验证码拒绝', type: 'danger' }
};

function statusType(s) { return STATES[s]?.type || ''; }
function statusLabel(s) { return STATES[s]?.label || '未知'; }

async function loadData() {
  loading.value = true;
  try {
    const statsRes = await rpc('getAdminStats');
    if (statsRes.code === 200) {
      stats.value = statsRes.data;
    }

    const contractsRes = await rpc('adminGetContracts', { pageSize: 10, page: 1 });
    if (contractsRes.code === 200) {
      recentContracts.value = (contractsRes.data?.list || []).map(c => ({
        ...c,
        storeName: c.storeName || '--',
        customerName: c.customerName || '--'
      }));
    }
  } catch (e) {
    console.error('load dashboard error:', e);
  } finally {
    loading.value = false;
  }
}

onMounted(loadData);
</script>

<style scoped>
.page-title { font-size: 18px; margin: 0 0 20px; color: #333; }
.stat-row { margin-bottom: 24px; }
.recent-card { margin-top: 16px; }
</style>
```


### Task 6: Create Contracts + Stores + Coupons + Admins views

**Files:**
- Create: `pc-admin/src/views/Contracts.vue`
- Create: `pc-admin/src/views/Stores.vue`
- Create: `pc-admin/src/views/Coupons.vue`
- Create: `pc-admin/src/views/Admins.vue`
- Create: `pc-admin/src/components/ContractDetail.vue`

- [ ] **Step 1: Create ContractDetail.vue**

```vue
<template>
  <el-dialog v-model="visible" title="合约详情" width="640px">
    <el-descriptions :column="2" border v-if="contract">
      <el-descriptions-item label="合约编号">{{ contract.contractNo }}</el-descriptions-item>
      <el-descriptions-item label="状态">
        <el-tag :type="statusType(contract.status)" size="small">{{ statusLabel(contract.status) }}</el-tag>
      </el-descriptions-item>
      <el-descriptions-item label="客户姓名">{{ contract.customerName || '--' }}</el-descriptions-item>
      <el-descriptions-item label="客户手机号">{{ contract.customerPhone || '--' }}</el-descriptions-item>
      <el-descriptions-item label="门店">{{ contract.storeName || '--' }}</el-descriptions-item>
      <el-descriptions-item label="商品">{{ contract.productName || '--' }}</el-descriptions-item>
      <el-descriptions-item label="金额">{{ contract.amount || '--' }}</el-descriptions-item>
      <el-descriptions-item label="创建时间">{{ contract.createdAt || '--' }}</el-descriptions-item>
    </el-descriptions>
  </el-dialog>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  modelValue: Boolean,
  contract: { type: Object, default: null }
});
const emit = defineEmits(['update:modelValue']);
const visible = computed({ get: () => props.modelValue, set: v => emit('update:modelValue', v) });

const STATES = {
  0: { label: '已驳回', type: 'danger' },
  1: { label: '待审核', type: 'warning' },
  2: { label: '已通过', type: 'success' },
  3: { label: '待验证码', type: '' },
  4: { label: '办理中', type: '' },
  5: { label: '办理完成', type: 'success' },
  6: { label: '已发货', type: '' },
  7: { label: '已签约', type: 'success' },
  8: { label: '验证码拒绝', type: 'danger' }
};
function statusType(s) { return STATES[s]?.type || ''; }
function statusLabel(s) { return STATES[s]?.label || '未知'; }
</script>
```

- [ ] **Step 2: Create Contracts.vue**

```vue
<template>
  <div class="contracts-page">
    <h3 class="page-title">合约管理</h3>

    <el-card class="search-card">
      <el-form :inline="true" :model="query">
        <el-form-item label="合约编号">
          <el-input v-model="query.contractNo" placeholder="搜索合约编号" clearable style="width:180px" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="query.status" placeholder="全部状态" clearable style="width:140px">
            <el-option label="待审核" :value="1" />
            <el-option label="已通过" :value="2" />
            <el-option label="已签约" :value="7" />
            <el-option label="已驳回" :value="0" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="search">查询</el-button>
          <el-button @click="resetSearch">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="table-card">
      <el-table :data="contracts" v-loading="loading" stripe @row-click="viewDetail" style="width:100%">
        <el-table-column prop="contractNo" label="合约编号" width="180" />
        <el-table-column prop="storeName" label="门店" width="140" />
        <el-table-column prop="customerName" label="客户" width="120" />
        <el-table-column prop="customerPhone" label="手机号" width="130" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 1" type="success" size="small" @click.stop="auditPass(row)">通过</el-button>
            <el-button v-if="row.status === 1" type="danger" size="small" @click.stop="auditReject(row)">驳回</el-button>
            <el-button size="small" @click.stop="viewDetail(row)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="query.page"
          :page-size="query.pageSize"
          :total="total"
          layout="prev, pager, next, total"
          @current-change="loadContracts"
        />
      </div>
    </el-card>

    <ContractDetail v-model="detailVisible" :contract="selectedContract" />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { rpc } from '@/api';
import ContractDetail from '@/components/ContractDetail.vue';

const loading = ref(false);
const contracts = ref([]);
const total = ref(0);
const detailVisible = ref(false);
const selectedContract = ref(null);

const STATES = {
  0: { label: '已驳回', type: 'danger' },
  1: { label: '待审核', type: 'warning' },
  2: { label: '已通过', type: 'success' },
  5: { label: '办理完成', type: 'success' },
  6: { label: '已发货', type: '' },
  7: { label: '已签约', type: 'success' }
};
function statusType(s) { return STATES[s]?.type || ''; }
function statusLabel(s) { return STATES[s]?.label || '未知'; }

const query = ref({
  contractNo: '',
  status: null,
  page: 1,
  pageSize: 20
});

async function loadContracts() {
  loading.value = true;
  try {
    const params = { page: query.value.page, pageSize: query.value.pageSize };
    if (query.value.contractNo) params.contractNo = query.value.contractNo;
    if (query.value.status \!== null && query.value.status \!== '') params.status = query.value.status;

    const res = await rpc('adminGetContracts', params);
    if (res.code === 200) {
      contracts.value = res.data?.list || [];
      total.value = res.data?.total || 0;
    }
  } catch (e) {
    ElMessage.error('加载合约列表失败');
  } finally {
    loading.value = false;
  }
}

function search() { query.value.page = 1; loadContracts(); }
function resetSearch() {
  query.value = { contractNo: '', status: null, page: 1, pageSize: 20 };
  loadContracts();
}

function viewDetail(row) {
  selectedContract.value = row;
  detailVisible.value = true;
}

async function auditPass(row) {
  try {
    await ElMessageBox.confirm(`确认合约 ${row.contractNo} 审核通过？`, '提示');
    const res = await rpc('auditContract', { contractNo: row.contractNo, action: 'approve' });
    if (res.code === 200) {
      ElMessage.success('审核通过');
      loadContracts();
    } else {
      ElMessage.error(res.message || '操作失败');
    }
  } catch (e) {
    if (e \!== 'cancel') ElMessage.error('操作失败');
  }
}

async function auditReject(row) {
  try {
    const { value } = await ElMessageBox.prompt('请输入驳回原因', '驳回合约', {
      confirmButtonText: '确定', cancelButtonText: '取消'
    });
    const res = await rpc('auditContract', { contractNo: row.contractNo, action: 'reject', reason: value });
    if (res.code === 200) {
      ElMessage.success('已驳回');
      loadContracts();
    } else {
      ElMessage.error(res.message || '操作失败');
    }
  } catch (e) {
    if (e \!== 'cancel') ElMessage.error('操作失败');
  }
}

onMounted(loadContracts);
</script>

<style scoped>
.page-title { font-size: 18px; margin: 0 0 16px; color: #333; }
.search-card { margin-bottom: 16px; }
.table-card { min-height: 400px; }
.pagination-wrap { margin-top: 20px; display: flex; justify-content: flex-end; }
</style>
```

- [ ] **Step 3: Create Stores.vue**

```vue
<template>
  <div class="stores-page">
    <h3 class="page-title">门店管理</h3>

    <el-card>
      <div class="toolbar">
        <el-button type="primary" @click="showCreate = true">新建门店</el-button>
      </div>

      <el-table :data="stores" v-loading="loading" stripe style="width:100%">
        <el-table-column prop="name" label="门店名称" />
        <el-table-column prop="address" label="地址" />
        <el-table-column prop="phone" label="联系电话" width="140" />
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button type="danger" size="small" @click="deleteStore(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="showCreate" title="新建门店" width="500px">
      <el-form :model="form" label-width="80px">
        <el-form-item label="门店名称">
          <el-input v-model="form.name" placeholder="请输入门店名称" />
        </el-form-item>
        <el-form-item label="地址">
          <el-input v-model="form.address" placeholder="请输入门店地址" />
        </el-form-item>
        <el-form-item label="联系电话">
          <el-input v-model="form.phone" placeholder="请输入联系电话" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" @click="createStore" :loading="creating">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { rpc } from '@/api';

const loading = ref(false);
const creating = ref(false);
const showCreate = ref(false);
const stores = ref([]);

const form = ref({ name: '', address: '', phone: '' });

async function loadStores() {
  loading.value = true;
  try {
    const res = await rpc('adminGetStores');
    if (res.code === 200) {
      stores.value = res.data?.list || res.data || [];
    }
  } catch (e) {
    ElMessage.error('加载门店列表失败');
  } finally {
    loading.value = false;
  }
}

async function createStore() {
  if (\!form.value.name) { ElMessage.warning('请输入门店名称'); return; }
  creating.value = true;
  try {
    const res = await rpc('adminCreateStore', { ...form.value });
    if (res.code === 200) {
      ElMessage.success('创建成功');
      showCreate.value = false;
      form.value = { name: '', address: '', phone: '' };
      loadStores();
    } else {
      ElMessage.error(res.message || '创建失败');
    }
  } catch (e) {
    ElMessage.error('创建失败');
  } finally {
    creating.value = false;
  }
}

async function deleteStore(row) {
  try {
    await ElMessageBox.confirm(`确定删除门店「${row.name}」？`, '警告', {
      confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning'
    });
    const res = await rpc('adminDeleteStore', { storeId: row.storeId });
    if (res.code === 200) {
      ElMessage.success('删除成功');
      loadStores();
    } else {
      ElMessage.error(res.message || '删除失败');
    }
  } catch (e) {
    if (e \!== 'cancel') ElMessage.error('删除失败');
  }
}

onMounted(loadStores);
</script>

<style scoped>
.page-title { font-size: 18px; margin: 0 0 16px; color: #333; }
.toolbar { margin-bottom: 16px; }
</style>
```

- [ ] **Step 4: Create Coupons.vue**

```vue
<template>
  <div class="coupons-page">
    <h3 class="page-title">代金券管理</h3>

    <el-card>
      <div class="toolbar">
        <el-button type="primary" @click="showCreate = true">新建代金券</el-button>
      </div>

      <el-table :data="coupons" v-loading="loading" stripe style="width:100%">
        <el-table-column prop="name" label="名称" />
        <el-table-column prop="value" label="面值" width="100" />
        <el-table-column prop="quantity" label="数量" width="80" />
        <el-table-column prop="availableDays" label="可用天数" width="100" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">
              {{ row.status === 1 ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" width="180" />
      </el-table>
    </el-card>

    <el-dialog v-model="showCreate" title="新建代金券" width="500px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="名称">
          <el-input v-model="form.name" placeholder="如：50元代金券" />
        </el-form-item>
        <el-form-item label="面值（元）">
          <el-input-number v-model="form.value" :min="1" :max="99999" />
        </el-form-item>
        <el-form-item label="数量">
          <el-input-number v-model="form.quantity" :min="1" :max="99999" />
        </el-form-item>
        <el-form-item label="可用天数">
          <el-input-number v-model="form.availableDays" :min="1" :max="365" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" @click="createCoupon" :loading="creating">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { rpc } from '@/api';

const loading = ref(false);
const creating = ref(false);
const showCreate = ref(false);
const coupons = ref([]);

const form = ref({ name: '', value: 50, quantity: 100, availableDays: 30 });

async function loadCoupons() {
  loading.value = true;
  try {
    const res = await rpc('adminGetCoupons');
    if (res.code === 200) {
      coupons.value = res.data?.list || res.data || [];
    }
  } catch (e) {
    ElMessage.error('加载代金券列表失败');
  } finally {
    loading.value = false;
  }
}

async function createCoupon() {
  if (\!form.value.name) { ElMessage.warning('请输入代金券名称'); return; }
  creating.value = true;
  try {
    const res = await rpc('adminCreateCoupon', { ...form.value });
    if (res.code === 200) {
      ElMessage.success('创建成功');
      showCreate.value = false;
      form.value = { name: '', value: 50, quantity: 100, availableDays: 30 };
      loadCoupons();
    } else {
      ElMessage.error(res.message || '创建失败');
    }
  } catch (e) {
    ElMessage.error('创建失败');
  } finally {
    creating.value = false;
  }
}

onMounted(loadCoupons);
</script>

<style scoped>
.page-title { font-size: 18px; margin: 0 0 16px; color: #333; }
.toolbar { margin-bottom: 16px; }
</style>
```

- [ ] **Step 5: Create Admins.vue**

```vue
<template>
  <div class="admins-page">
    <h3 class="page-title">管理员管理</h3>

    <el-card>
      <div class="toolbar">
        <el-button type="primary" @click="showInvite = true">邀请管理员</el-button>
      </div>

      <el-table :data="admins" v-loading="loading" stripe style="width:100%">
        <el-table-column prop="name" label="姓名" />
        <el-table-column prop="phone" label="手机号" width="140" />
        <el-table-column prop="roleKey" label="角色" width="120">
          <template #default="{ row }">
            <el-tag :type="row.roleKey === 'super_admin' ? 'danger' : 'warning'" size="small">
              {{ row.roleKey === 'super_admin' ? '超级管理员' : '管理员' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">
              {{ row.status === 1 ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="showInvite" title="邀请管理员" width="500px">
      <el-form :model="inviteForm" label-width="100px">
        <el-form-item label="手机号">
          <el-input v-model="inviteForm.phone" placeholder="输入管理员手机号" maxlength="11" />
        </el-form-item>
        <el-form-item label="角色">
          <el-radio-group v-model="inviteForm.roleKey">
            <el-radio value="admin">管理员</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showInvite = false">取消</el-button>
        <el-button type="primary" @click="inviteAdmin" :loading="inviting">邀请</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { rpc } from '@/api';

const loading = ref(false);
const inviting = ref(false);
const showInvite = ref(false);
const admins = ref([]);

const inviteForm = ref({ phone: '', roleKey: 'admin' });

async function loadAdmins() {
  loading.value = true;
  try {
    const res = await rpc('adminGetRoles', { scopeType: 'platform' });
    if (res.code === 200) {
      // Filter to admin roles
      const all = res.data?.list || res.data || [];
      const SUPER_ADMIN_OPENID = ''; // May need to be configured
      admins.value = all.filter(r => r.roleKey === 'admin' || r.roleKey === 'super_admin');
    }
  } catch (e) {
    ElMessage.error('加载管理员列表失败');
  } finally {
    loading.value = false;
  }
}

async function inviteAdmin() {
  if (\!/^1[3-9]\d{9}$/.test(inviteForm.value.phone)) {
    ElMessage.warning('请输入正确的手机号');
    return;
  }
  inviting.value = true;
  try {
    const res = await rpc('adminInviteRole', {
      phone: inviteForm.value.phone,
      roleKey: inviteForm.value.roleKey,
      scopeType: 'platform',
      name: inviteForm.value.phone
    });
    if (res.code === 200) {
      ElMessage.success('邀请成功，管理员登录时将自动绑定');
      showInvite.value = false;
      inviteForm.value = { phone: '', roleKey: 'admin' };
      loadAdmins();
    } else {
      ElMessage.error(res.message || '邀请失败');
    }
  } catch (e) {
    ElMessage.error('邀请失败');
  } finally {
    inviting.value = false;
  }
}

onMounted(loadAdmins);
</script>

<style scoped>
.page-title { font-size: 18px; margin: 0 0 16px; color: #333; }
.toolbar { margin-bottom: 16px; }
</style>
```


### Task 7: Deploy configuration and verification

**Files:**
- Modify: `pc-admin/.env` (set actual API URL)
- Modify: `project.config.json` (add static hosting config)

- [ ] **Step 1: Build the frontend**

```bash
cd pc-admin
npm run build
```

Expected: `dist/` directory created with index.html, assets/

- [ ] **Step 2: Configure cloud static hosting**

In WeChat Cloud Console:
1. Go to 云开发 → 静态托管
2. Enable static hosting if not already enabled
3. Upload the contents of `pc-admin/dist/` to the static hosting root
4. Note the static hosting domain (e.g., `https://<env-id>.tcloudbaseapp.com`)

- [ ] **Step 3: Configure adminHttp HTTP trigger**

In WeChat DevTools:
1. Deploy `cloudfunctions/adminHttp` (right-click → Upload and Deploy)
2. Go to WeChat Cloud Console → Cloud Function → adminHttp
3. Enable HTTP trigger → note the URL

- [ ] **Step 4: Update .env with production URL**

```
VITE_API_BASE=https://<env-id>.service.tcloudbase.com/adminHttp
```

Replace `<env-id>` with actual environment ID.

- [ ] **Step 5: Rebuild and redeploy frontend**

```bash
cd pc-admin
npm run build
```

Re-upload `dist/` to static hosting.

- [ ] **Step 6: Verify end-to-end**

1. Open the static hosting URL in a browser
2. Verify the login page shows with QR code
3. Scan with WeChat → mini-program confirm page opens
4. Confirm login → browser polls successfully → enters admin panel
5. Navigate between pages, verify data loads
6. Test contract audit (approve/reject)
7. Test store/coupon/admin management (if super_admin)

