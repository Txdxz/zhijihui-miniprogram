# P0: User Auto-Registration + Coupon Model Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement two P0 items: (1) Complete user auto-registration flow from scan to profile page with contract history, (2) Refactor coupon lifecycle to support pending/active/used/expired states with mobile callback placeholder.

**Architecture:** Fix login data flow (cloud function already creates users, frontend ignores it), add getUserInfo handler, rewrite profile page with contract/coupon history. Modify coupon generation to pre-create with status=0 (待激活), add activateCoupon callback endpoint, update verify flow to only accept active (status=1) coupons.

**Tech Stack:** WeChat Mini-Program + wx-server-sdk + Vant Weapp

---

### Task 1: Fix app.js login flow to store user data

**Files:**
- Modify: `app.js:110-125`

The login cloud function already creates `portal_users` records and returns `{ code, data: { openId, user } }`. But `_loginByCloud()` only extracts `openId` and discards the user record. Need to store user data in `app.globalData.currentUser`.

- [ ] **Fix _loginByCloud to store user data**

In `app.js`, find the `_loginByCloud` method and modify:

```javascript
async _loginByCloud() {
  const res = await callCloudFunction('login');
  if (res && res.code === 200 && res.data) {
    this.globalData.currentUser = res.data.user || null;
    return res.data.openId || '';
  }
  return '';
},
```

Also ensure `app.globalData` has the `currentUser` field declared:

```javascript
globalData: {
  currentUser: null,
  currentStore: null,
  hasUnreadMessages: false
},
```

- [ ] **Verify login works end-to-end**

Run app in devtools, check that after `wx.login` flow completes, `app.globalData.currentUser` contains `_id`, `openId`, `nickName`, `avatarUrl`, `phone`, `createdAt`.

---

### Task 2: Fix resolveLaunchContext to create portal_users if missing

**Files:**
- Modify: `cloudfunctions/resolveLaunchContext/index.js:100-130`

The `resolveLaunchContext` cloud function checks portal_roles by openId but doesn't ensure a `portal_users` record exists. If a user logs in via mini-program first (login cloud function creates the record), then accesses a store-admin deep link, `resolveLaunchContext` runs and should find the existing record. But if somehow the user record doesn't exist (e.g., direct deep link without prior login), we should create one.

- [ ] **Add user creation logic to resolveLaunchContext**

Find the section after role resolution (around line 100) and add:

```javascript
// Ensure portal_users record exists
const usersCollection = db.collection('portal_users');
const existingUser = await usersCollection.where({ openId: OPENID }).limit(1).get();
if (existingUser.data.length === 0) {
  const now = Date.now();
  await usersCollection.add({
    data: {
      openId: OPENID,
      appId: APPID,
      nickName: '',
      avatarUrl: '',
      phone: '',
      status: 1,
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now
    }
  });
}
```

---

### Task 3: Add getUserInfo handler to portalBiz cloud function

**Files:**
- Modify: `cloudfunctions/portalBiz/index.js` (add `getUserInfo` action handler, ~40 lines)
- Modify: `utils/business-api.js` (add `getUserInfo` method)

The profile page needs to display: user info (already available via login), contract list with status, and associated coupon info.

- [ ] **Add getUserInfo action handler**

Find the action dispatch switch in `portalBiz/index.js` and add a new case `'getUserInfo'`. The handler:

```javascript
async function handleGetUserInfo(data, context) {
  const { OPENID } = cloud.getWXContext();
  
  // 1. Get user profile
  const usersCollection = db.collection('portal_users');
  const userRes = await usersCollection.where({ openId: OPENID }).limit(1).get();
  if (userRes.data.length === 0) {
    return { code: 404, message: '用户不存在' };
  }
  const user = userRes.data[0];
  
  // 2. Get contracts for this user (by phone)
  let contracts = [];
  if (user.phone) {
    const contractsCollection = db.collection('contracts');
    const contractRes = await contractsCollection.where({ phone: user.phone }).orderBy('createdAt', 'desc').get();
    contracts = contractRes.data || [];
  }
  
  // 3. Get coupon count by status per contract
  const couponsCollection = db.collection('coupons');
  let totalCoupons = 0;
  let activeCoupons = 0;
  let usedCoupons = 0;
  let pendingCoupons = 0;
  
  if (contracts.length > 0) {
    const contractIds = contracts.map(c => c._id);
    const couponRes = await couponsCollection.where({
      contractId: db.command.in(contractIds)
    }).get();
    const allCoupons = couponRes.data || [];
    totalCoupons = allCoupons.length;
    activeCoupons = allCoupons.filter(c => c.status === 1).length;
    usedCoupons = allCoupons.filter(c => c.status === 2).length;
    pendingCoupons = allCoupons.filter(c => c.status === 0).length;
  }
  
  // Filter sensitive fields
  const safeContracts = contracts.map(c => ({
    _id: c._id,
    contractId: c.contractId,
    phone: c.phone,
    name: c.name,
    idCard: c.idCard,
    address: c.address,
    status: c.status,
    storeId: c.storeId,
    storeName: c.storeName,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt
  }));
  
  return {
    code: 200,
    data: {
      user: {
        _id: user._id,
        openId: user.openId,
        nickName: user.nickName || '',
        avatarUrl: user.avatarUrl || '',
        phone: user.phone || '',
        createdAt: user.createdAt
      },
      contracts: safeContracts,
      couponStats: {
        total: totalCoupons,
        pending: pendingCoupons,
        active: activeCoupons,
        used: usedCoupons
      }
    }
  };
}
```

- [ ] **Add getUserInfo to business-api.js**

Add to `utils/business-api.js`:

```javascript
getUserInfo() {
  return callCloudFunction('portalBiz', { action: 'getUserInfo' });
},
```

---

### Task 4: Rewrite profile page with contract history and coupon records

**Files:**
- Create: `pages/profile/index.js` (full rewrite, ~250 lines)
- Modify: `pages/profile/index.wxml` (contract list + coupon stats sections)
- Modify: `pages/profile/index.wxss` (styles for new sections)
- Modify: `app.json` (add profile page to tabBar if not already)

- [ ] **Write profile page JavaScript**

`pages/profile/index.js` — full replacement:

```javascript
const { businessAPI } = require('../../utils/business-api');
const ToastLib = require('@vant/weapp/toast/toast');
const Toast = ToastLib.default || ToastLib;

// Contract status display mapping
const CONTRACT_STATUS_MAP = {
  0: { label: '已驳回', cls: 'rejected' },
  1: { label: '待审核', cls: 'pending' },
  2: { label: '已通过', cls: 'qualified' },
  3: { label: '待短信', cls: 'pending' },
  4: { label: '办理中', cls: 'processing' },
  5: { label: '已办理', cls: 'completed' },
  6: { label: '已发货', cls: 'shipped' },
  7: { label: '已签收', cls: 'signed' },
  8: { label: '短信驳回', cls: 'rejected' }
};

// Coupon status display mapping
const COUPON_STATUS_MAP = {
  0: { label: '待激活', cls: 'pending' },
  1: { label: '可使用', cls: 'active' },
  2: { label: '已使用', cls: 'used' },
  3: { label: '已过期', cls: 'expired' }
};

Page({
  data: {
    pageLoading: true,
    pageError: '',
    
    // User profile
    userInfo: null,
    nickName: '',
    avatarUrl: '',
    phone: '',
    
    // Editing state
    editing: false,
    saving: false,
    
    // Contracts
    contracts: [],
    
    // Coupon stats
    couponStats: {
      total: 0,
      pending: 0,
      active: 0,
      used: 0
    },
    
    // Contract status helpers for template
    _CONTRACT_STATUS_MAP: CONTRACT_STATUS_MAP,
    _COUPON_STATUS_MAP: COUPON_STATUS_MAP,
    
    _countdownTimer: null
  },

  onLoad() {
    Toast.setDefaultOptions({ selector: '#van-toast' });
    this.loadProfile();
  },

  onShow() {
    // Refresh when coming back from other pages
    this.loadProfile();
  },

  async loadProfile() {
    this.setData({ pageLoading: true, pageError: '' });
    try {
      const res = await businessAPI.getUserInfo();
      
      if (res.code === 200 && res.data) {
        const { user, contracts, couponStats } = res.data;
        this.setData({
          userInfo: user,
          nickName: user.nickName || '',
          avatarUrl: user.avatarUrl || '',
          phone: user.phone || '',
          contracts: contracts || [],
          couponStats: couponStats || { total: 0, pending: 0, active: 0, used: 0 },
          pageLoading: false
        });
      } else {
        this.setData({ pageError: '加载失败', pageLoading: false });
      }
    } catch (e) {
      console.error('loadProfile error:', e);
      this.setData({ pageError: '网络异常，请下拉刷新重试', pageLoading: false });
    }
  },

  onPullDownRefresh() {
    this.loadProfile().finally(() => wx.stopPullDownRefresh());
  },

  _showToast(msg) {
    wx.showToast({ title: msg, icon: 'none', duration: 2000 });
  },

  // ========== Profile editing ==========

  startEdit() {
    this.setData({
      editing: true,
      nickName: this.data.userInfo.nickName || '',
      avatarUrl: this.data.userInfo.avatarUrl || ''
    });
  },

  cancelEdit() {
    this.setData({
      editing: false,
      nickName: this.data.userInfo.nickName || '',
      avatarUrl: this.data.userInfo.avatarUrl || ''
    });
  },

  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    if (avatarUrl) {
      this.setData({ avatarUrl });
    }
  },

  onNicknameInput(e) {
    const value = (e.detail && e.detail.value) || '';
    this.setData({ nickName: value });
  },

  onNicknameChange(e) {
    const value = (e.detail && e.detail.value) || '';
    this.setData({ nickName: value });
  },

  async saveProfile() {
    if (this.data.saving) return;
    this.setData({ saving: true });
    
    try {
      const { nickName, avatarUrl } = this.data;
      
      // Upload avatar if changed
      let finalAvatarUrl = this.data.userInfo.avatarUrl || '';
      if (avatarUrl && avatarUrl !== finalAvatarUrl) {
        finalAvatarUrl = await this._uploadAvatar(avatarUrl);
      }
      
      const res = await businessAPI.updateUserProfile({
        nickName: nickName,
        avatarUrl: finalAvatarUrl
      });
      
      if (res.code === 200) {
        wx.showToast({ title: '保存成功', icon: 'success', duration: 1500 });
        this.setData({
          editing: false,
          userInfo: {
            ...this.data.userInfo,
            nickName,
            avatarUrl: finalAvatarUrl
          }
        });
        // Update global user info
        const app = getApp();
        if (app.globalData.currentUser) {
          app.globalData.currentUser.nickName = nickName;
          app.globalData.currentUser.avatarUrl = finalAvatarUrl;
        }
      } else {
        this._showToast(res.message || '保存失败');
      }
    } catch (e) {
      console.error('saveProfile error:', e);
      this._showToast('网络异常');
    } finally {
      this.setData({ saving: false });
    }
  },

  async _uploadAvatar(tempPath) {
    try {
      const cloudPath = `avatars/${Date.now()}.png`;
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath,
        filePath: tempPath
      });
      return uploadRes.fileID;
    } catch (e) {
      console.error('uploadAvatar error:', e);
      return tempPath;
    }
  },

  // ========== Contract and coupon helpers ==========

  _formatDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  },

  getContractStatusLabel(status) {
    return CONTRACT_STATUS_MAP[status]?.label || '未知';
  },

  getContractStatusClass(status) {
    return CONTRACT_STATUS_MAP[status]?.cls || '';
  },

  getCouponStatusLabel(status) {
    return COUPON_STATUS_MAP[status]?.label || '未知';
  },

  getCouponStatusClass(status) {
    return COUPON_STATUS_MAP[status]?.cls || '';
  },

  viewContract(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/contract/detail?id=${id}` });
  },

  viewCoupons() {
    wx.switchTab({ url: '/pages/coupon/coupon' });
  }
});
```

- [ ] **Add updateUserProfile to portalBiz cloud function**

Add handler in portalBiz:

```javascript
async function handleUpdateUserProfile(data, context) {
  const { OPENID } = cloud.getWXContext();
  const { nickName, avatarUrl } = data;
  
  const updateData = { updatedAt: Date.now() };
  if (nickName !== undefined) updateData.nickName = nickName;
  if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;
  
  await db.collection('portal_users').where({ openId: OPENID }).limit(1).update({
    data: updateData
  });
  
  return { code: 200, message: 'ok' };
}
```

Add dispatch case `'updateUserProfile'` and business-api method.

- [ ] **Add updateUserProfile to business-api.js**

```javascript
updateUserProfile(data) {
  return callCloudFunction('portalBiz', { action: 'updateUserProfile', ...data });
},
```

- [ ] **Rewrite profile WXML**

`pages/profile/index.wxml`:

```xml
<view class="page">
  <!-- Loading skeleton -->
  <skeleton wx:if="{{pageLoading}}" loading="{{pageLoading}}" type="card" item-count="2" />

  <!-- Error state -->
  <view wx:elif="{{pageError}}" class="error-state">
    <text class="error-state__text">{{pageError}}</text>
    <button class="retry-btn" bindtap="loadProfile" size="mini">重试</button>
  </view>

  <block wx:else>
  
  <!-- ===== Profile Card ===== -->
  <view class="profile-card">
    <view class="avatar-section">
      <button
        class="avatar-btn"
        open-type="{{editing ? 'chooseAvatar' : ''}}"
        bindchooseavatar="onChooseAvatar"
        disabled="{{!editing}}"
      >
        <image class="avatar-img" src="{{avatarUrl || '/images/default-avatar.png'}}" mode="aspectFill" />
      </button>
      <text class="avatar-hint" wx:if="{{editing}}">点击更换头像</text>
    </view>

    <view class="nickname-section">
      <text class="section-label">昵称</text>
      <input
        wx:if="{{editing}}"
        class="nickname-input"
        type="nickname"
        value="{{nickName}}"
        placeholder="请输入昵称"
        bindchange="onNicknameChange"
        bindinput="onNicknameInput"
      />
      <text wx:else class="nickname-text">{{nickName || '未设置'}}</text>
    </view>

    <view class="phone-section" wx:if="{{phone}}">
      <text class="section-label">手机号</text>
      <text class="phone-text">{{phone}}</text>
    </view>
  </view>

  <!-- Profile action bar -->
  <view class="action-bar">
    <block wx:if="{{editing}}">
      <van-button type="primary" block round loading="{{saving}}" bind:click="saveProfile">保存</van-button>
      <van-button type="default" block round class="cancel-btn" bind:click="cancelEdit">取消</van-button>
    </block>
    <van-button wx:else type="primary" block round bind:click="startEdit">编辑资料</van-button>
  </view>

  <!-- ===== Coupon Stats Summary ===== -->
  <view class="sheet">
    <view class="section-header" bindtap="viewCoupons">
      <text class="section-title">我的代金券</text>
      <text class="section-arrow">›</text>
    </view>
    <view class="stats-grid">
      <view class="stats-col">
        <text class="stats-num num-total">{{couponStats.total}}</text>
        <text class="stats-label">共 {{couponStats.total}} 张</text>
      </view>
      <view class="stats-col">
        <text class="stats-num num-pending">{{couponStats.pending}}</text>
        <text class="stats-label">待激活</text>
      </view>
      <view class="stats-col">
        <text class="stats-num num-active">{{couponStats.active}}</text>
        <text class="stats-label">可使用</text>
      </view>
      <view class="stats-col">
        <text class="stats-num num-used">{{couponStats.used}}</text>
        <text class="stats-label">已使用</text>
      </view>
    </view>
  </view>

  <!-- ===== Contract History ===== -->
  <view class="sheet">
    <view class="section-header">
      <text class="section-title">办理记录</text>
    </view>
    <view wx:if="{{contracts.length === 0}}" class="empty-state">
      <text class="empty-text">暂无办理记录</text>
    </view>
    <view wx:else class="contract-list">
      <view class="contract-item" wx:for="{{contracts}}" wx:key="_id" bindtap="viewContract" data-id="{{item._id}}">
        <view class="contract-top">
          <text class="contract-name">{{item.name || '未填写'}}</text>
          <text class="contract-status tag-{{_CONTRACT_STATUS_MAP[item.status]?.cls || 'default'}}">{{_CONTRACT_STATUS_MAP[item.status]?.label || '未知'}}</text>
        </view>
        <view class="contract-info">
          <text class="contract-meta">编号：{{item.contractId || item._id.slice(-8)}}</text>
          <text class="contract-meta">门店：{{item.storeName || '未知'}}</text>
        </view>
        <text class="contract-date">{{_formatDate(item.createdAt)}}</text>
      </view>
    </view>
  </view>

  <view class="tabbar-spacer" />
  <van-toast id="van-toast" />
  </block>
</view>
```

- [ ] **Write profile page styles**

`pages/profile/index.wxss` — full replacement:

```css
.page {
  min-height: 100vh;
  background: #f5f5f5;
  padding-bottom: 20px;
}

.profile-card {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 40px 24px 24px;
  border-radius: 0 0 24px 24px;
  color: #fff;
}

.avatar-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 16px;
}

.avatar-btn {
  width: 80px;
  height: 80px;
  padding: 0;
  line-height: 80px;
  background: rgba(255,255,255,0.2);
  border-radius: 50%;
  border: 3px solid rgba(255,255,255,0.6);
  overflow: hidden;
}

.avatar-img {
  width: 100%;
  height: 100%;
  display: block;
}

.avatar-hint {
  font-size: 12px;
  margin-top: 8px;
  opacity: 0.8;
}

.nickname-section,
.phone-section {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.section-label {
  font-size: 14px;
  opacity: 0.8;
}

.nickname-input {
  font-size: 16px;
  color: #fff;
  text-align: center;
  background: rgba(255,255,255,0.15);
  border-radius: 16px;
  padding: 6px 16px;
  min-width: 120px;
}

.nickname-text,
.phone-text {
  font-size: 16px;
  font-weight: 500;
}

/* Action bar */
.action-bar {
  padding: 16px 24px;
}

.cancel-btn {
  margin-top: 8px;
  --button-default-color: #666;
  --button-default-border-color: #ddd;
}

/* Sheet */
.sheet {
  background: #fff;
  margin: 12px 16px;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.04);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: #333;
}

.section-arrow {
  font-size: 20px;
  color: #999;
}

/* Coupon stats */
.stats-grid {
  display: flex;
  text-align: center;
  gap: 0;
}

.stats-col {
  flex: 1;
  position: relative;
}

.stats-col + .stats-col::before {
  content: '';
  position: absolute;
  left: 0;
  top: 10%;
  height: 80%;
  width: 1px;
  background: #eee;
}

.stats-num {
  display: block;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.3;
}

.num-total { color: #333; }
.num-pending { color: #999; }
.num-active { color: #07c160; }
.num-used { color: #1989fa; }

.stats-label {
  display: block;
  font-size: 12px;
  color: #999;
  margin-top: 4px;
}

/* Contract list */
.empty-state {
  text-align: center;
  padding: 32px 0;
}

.empty-text {
  font-size: 14px;
  color: #999;
}

.contract-item {
  padding: 12px 0;
  border-bottom: 1px solid #f0f0f0;
  position: relative;
}

.contract-item:last-child {
  border-bottom: none;
}

.contract-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.contract-name {
  font-size: 15px;
  font-weight: 500;
  color: #333;
}

.contract-status {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: #f0f0f0;
  color: #666;
}

.tag-pending { background: #fff3e0; color: #e65100; }
.tag-processing { background: #e3f2fd; color: #1565c0; }
.tag-completed { background: #e8f5e9; color: #2e7d32; }
.tag-shipped { background: #e8f5e9; color: #2e7d32; }
.tag-signed { background: #e8f5e9; color: #2e7d32; }
.tag-qualified { background: #e8f5e9; color: #2e7d32; }
.tag-rejected { background: #fbe9e7; color: #c62828; }
.tag-default { background: #f0f0f0; color: #666; }

.contract-info {
  display: flex;
  gap: 16px;
  margin-bottom: 4px;
}

.contract-meta {
  font-size: 12px;
  color: #999;
}

.contract-date {
  font-size: 11px;
  color: #bbb;
}

/* Error state */
.error-state {
  text-align: center;
  padding: 80px 24px;
}

.error-state__text {
  display: block;
  font-size: 14px;
  color: #999;
  margin-bottom: 16px;
}

.retry-btn {
  background: #07c160;
  color: #fff;
  border: none;
  border-radius: 16px;
  padding: 8px 24px;
  font-size: 14px;
}

/* Tab bar spacer */
.tabbar-spacer {
  height: 100px;
}
```

---

### Task 5: Refactor ensureCouponsForContract to generate status=0 coupons

**Files:**
- Modify: `cloudfunctions/portalBiz/index.js` (`ensureCouponsForContract` function)

Currently generates coupons with `status: 1`. Change to `status: 0` so coupons start as 待激活 (pending activation).

- [ ] **Change coupon initial status from 1 to 0**

Find the coupon data object in `ensureCouponsForContract` (around where coupon rules are iterated):

```javascript
// Before:
const couponData = {
  contractId: contractId,
  ruleId: rule._id,
  amount: rule.amount,
  period: periodIndex + 1,
  periodMonth: monthStr,
  storeId: rule.storeId || '',
  storeName: rule.storeName || '',
  status: 1,  // used to mean 可使用, now means 已激活
  activateDate: db.serverDate(),
  monthlyLimit: rule.monthlyLimit || 1,
  usedTimes: 0,
  createdAt: now,
  updatedAt: now
};

// After:
const couponData = {
  contractId: contractId,
  ruleId: rule._id,
  amount: rule.amount,
  period: periodIndex + 1,
  periodMonth: monthStr,
  storeId: rule.storeId || '',
  storeName: rule.storeName || '',
  status: 0,  // 待激活 — activated later by Hebei Mobile callback
  activateDate: db.serverDate(),
  monthlyLimit: rule.monthlyLimit || 1,
  usedTimes: 0,
  createdAt: now,
  updatedAt: now
};
```

---

### Task 6: Add handleActivateCoupon callback placeholder

**Files:**
- Modify: `cloudfunctions/portalBiz/index.js` (add `handleActivateCoupon` action, ~50 lines)
- Modify: `utils/business-api.js` (add `activateCoupon` method for testing)

External callback endpoint (called by Hebei Mobile system when a contract is processed in their system). Activates all coupons for a given contract + period from status=0 to status=1.

- [ ] **Add handleActivateCoupon handler**

```javascript
async function handleActivateCoupon(data, context) {
  const { contractId, period, authToken } = data;
  
  // Simple auth check (placeholder — enhance for production)
  if (!authToken || authToken !== 'zjh_callback_2024') {
    return { code: 403, message: 'unauthorized' };
  }
  
  if (!contractId || !period) {
    return { code: 400, message: '缺少参数' };
  }
  
  const now = Date.now();
  
  // Find coupons for this contract + period with status=0
  const couponsCollection = db.collection('coupons');
  const res = await couponsCollection.where({
    contractId,
    period,
    status: 0
  }).get();
  
  if (res.data.length === 0) {
    return { code: 404, message: '未找到待激活的券或已激活' };
  }
  
  // Activate all matching coupons
  const batch = db.command;
  const couponIds = res.data.map(c => c._id);
  
  // Update each coupon
  const updatePromises = couponIds.map(id => {
    return couponsCollection.doc(id).update({
      data: {
        status: 1,
        activateDate: now,
        updatedAt: now
      }
    });
  });
  
  await Promise.all(updatePromises);
  
  return {
    code: 200,
    message: 'ok',
    data: {
      activatedCount: couponIds.length,
      period,
      contractId
    }
  };
}
```

Add dispatch case `'activateCoupon'`.

- [ ] **Add activateCoupon to business-api.js**

```javascript
activateCoupon(contractId, period, authToken) {
  return callCloudFunction('portalBiz', {
    action: 'activateCoupon',
    contractId,
    period,
    authToken
  });
},
```

---

### Task 7: Update verify code generation for status=1 only

**Files:**
- Modify: `cloudfunctions/portalBiz/index.js` (`handleGenerateVerifyCode` ~5 lines changed)

The existing check `if (coupon.status !== 1)` needs to remain valid — in the new model, status=1 means "已激活" (previously "可使用"), which is still the correct state for allowing verify code generation.

- [ ] **Verify the existing status check is correct**

Find `handleGenerateVerifyCode`:

```javascript
// Current code (likely already correct):
if (coupon.status !== 1) {
  return { code: 400, message: '该券不可使用' };
}
```

This check is correct for the new model because:
- status=0 (待激活) → cannot generate code. Correct.
- status=1 (已激活/可使用) → can generate code. Correct.
- status=2 (已使用) → cannot generate code. Correct.
- status=3 (已过期) → cannot generate code. Correct.

No changes needed. Just verify this is already in place.

---

### Task 8: Update coupon frontend for pending state display

**Files:**
- Modify: `pages/coupon/coupon.js` (`_getStatusClass` method, ~5 lines)
- Verify: `pages/coupon/coupon.wxml` (status=0 display is already there)

The WXML already has conditional rendering for `item.status === 0` showing "未激活" text. Need to update the status class mapping and possibly the display text/behavior.

- [ ] **Update status class in coupon.js**

Find `_getStatusClass`:

```javascript
// Before:
if (status === 0) return 'inactive';

// After:
if (status === 0) return 'pending';
```

Also add `pending` CSS class in the WXSS for visual distinction (greyed out, with a "待激活" label style).

- [ ] **Update WXML status=0 display text**

In `coupon.wxml`, find the `item.status === 0` section (around line 55-58):

```xml
<!-- Update from: -->
<view class="coupon-status-box inactive" wx:if="{{item.status === 0}}">
  <text class="status-text">未激活</text>
  <text class="status-hint">{{item.activateDate}} 激活</text>
</view>

<!-- To: -->
<view class="coupon-status-box pending" wx:if="{{item.status === 0}}">
  <text class="status-text">待激活</text>
  <text class="status-hint">办理完成后由系统自动激活</text>
</view>
```

- [ ] **Add pending status styles to coupon.wxss**

```css
.coupon-item.pending {
  opacity: 0.7;
}

.coupon-status-box.pending .status-text {
  color: #999;
}

.coupon-status-box.pending .status-hint {
  color: #bbb;
  font-size: 11px;
}
```
