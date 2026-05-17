# P1: Permission Adjustment + Admin Binding Simplification

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** (1) Enforce role-based tab visibility in admin panel (super_admin sees all, regular admin sees only contracts), (2) Remove SMS verification from admin/store binding, (3) Auto-bind roles when phone matches on login.

**Architecture:** Frontend tab visibility via `_ensureAdminAccess` flags; backend permission checks already correct for most actions. bindRoleByPhone strips SMS verification, directly checks invites. resolveLaunchContext auto-creates portal_roles when user's phone matches a pending invite.

**Tech Stack:** WeChat Mini-Program + wx-server-sdk + Vant Weapp

---

### Task 1: Admin panel role-based tab enforcement

**Files:**
- Modify: `packageAdmin/pages/admin/index.js`
- Verify: `packageAdmin/pages/admin/index.wxml` (already has `wx:if` conditions)

The WXML already has `wx:if="{{canManageCouponOps}}"` / `wx:if="{{canManageStoreSetup}}"` / `wx:if="{{canManageAdmins}}"` on the coupon, store, and admins tabs. But `_ensureAdminAccess` only sets `canManageStoreSetup` and `canManageCouponOps` — `canManageAdmins` is never set.

- [ ] **Add canManageAdmins flag**

In `_ensureAdminAccess` (around line 212-217), add `canManageAdmins: isSuperAdmin`:

```javascript
const nextData = {
  currentAdmin,
  isCloudMode: !!app.globalData.cloudReady,
  canManageStoreSetup: isSuperAdmin,
  canManageCouponOps: isSuperAdmin,
  canManageAdmins: isSuperAdmin  // Add this line
};
```

- [ ] **Block admins tab in switchTab**

In `switchTab` (around line 250-255), extend the non-super_admin tab block to also block the 'admins' tab:

```javascript
// Before:
if (!isSuperAdmin && (tab === 'coupon' || tab === 'store')) {
  this._showToast('仅超级管理员可管理此模块');
  this.setData({ activeTab: 'contract' });
  return;
}

// After:
if (!isSuperAdmin && (tab === 'coupon' || tab === 'store' || tab === 'admins')) {
  this._showToast('仅超级管理员可管理此模块');
  this.setData({ activeTab: 'contract' });
  return;
}
```

---

### Task 2: Remove SMS verification from bindRoleByPhone

**Files:**
- Rewrite: `cloudfunctions/bindRoleByPhone/index.js`

Strip all SMS verification code. The cloud function should directly check phone against `staff_invites` and create `portal_roles` record. No `sendSmsCode` action, no `verifySmsCode`, no `sms_verifications` collection access.

- [ ] **Rewrite bindRoleByPhone**

Full replacement:

```javascript
const cloud = require('wx-server-sdk');
const { checkRateLimit } = require('../rateLimit');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext();

    const rateCheck = await checkRateLimit(OPENID, 'bindRole');
    if (!rateCheck.allowed) {
      return { code: 429, message: rateCheck.message };
    }

    const now = new Date().toISOString();
    const phone = String(event.phone || '').trim();
    const roleKey = String(event.roleKey || '').trim();

    if (!/^1[3-9]\d{9}$/.test(phone)) {
      return { code: 400, message: '请输入正确的11位手机号' };
    }

    if (!['admin', 'store_owner', 'store_clerk'].includes(roleKey)) {
      return { code: 400, message: '不支持的绑定角色' };
    }

    // 直接查询待绑定邀请
    const inviteRes = await db.collection('staff_invites').where({
      phone,
      roleKey,
      status: 1,
      boundOpenId: ''
    }).limit(1).get();

    const invite = inviteRes.data && inviteRes.data[0];
    if (!invite) {
      return { code: 404, message: '未找到可绑定的角色，请联系管理员配置' };
    }

    const roleCollection = db.collection('portal_roles');
    const existingRoleRes = await roleCollection.where({
      openId: OPENID,
      roleKey,
      scopeType: invite.scopeType,
      scopeId: invite.scopeId,
      status: 1
    }).limit(1).get();

    if (!existingRoleRes.data.length) {
      await roleCollection.add({
        data: {
          openId: OPENID,
          roleKey,
          name: invite.name || '',
          phone: phone,
          scopeType: invite.scopeType,
          scopeId: invite.scopeId,
          scopeName: invite.scopeName || '',
          permissions: invite.permissions || [],
          status: 1,
          boundBy: 'self_bind',
          createdAt: now,
          updatedAt: now
        }
      });
    }

    await db.collection('staff_invites').doc(invite._id).update({
      data: {
        boundOpenId: OPENID,
        boundAt: now,
        updatedAt: now
      }
    });

    return {
      code: 200,
      data: {
        openId: OPENID,
        roleKey,
        scopeType: invite.scopeType,
        scopeId: invite.scopeId
      }
    };
  } catch (error) {
    console.error('bindRoleByPhone 错误:', error);
    return {
      code: 500,
      message: error && error.message ? error.message : '服务异常'
    };
  }
};
```

---

### Task 3: Auto-bind role when phone matches on resolveLaunchContext

**Files:**
- Modify: `cloudfunctions/resolveLaunchContext/index.js`

When `resolveLaunchContext` finds a pending `staff_invites` entry and the user's `portal_users` phone matches, auto-create the `portal_roles` record directly — no need to send the user to the bind page.

- [ ] **Add auto-bind logic to resolveLaunchContext**

After the pending invite check (around line 100-123), instead of immediately returning the bind target, first check if the user's phone matches:

```javascript
  // 用户没有任何已绑定角色时，检查是否有待绑定的邀请
  if (!roleOptions.length) {
    // 检查 staff_invites 表是否有待绑定的邀请（boundOpenId 为空）
    const inviteRes = await db.collection('staff_invites').where({
      boundOpenId: '',
      status: 1
    }).limit(1).get();

    const pendingInvite = inviteRes.data && inviteRes.data[0];
    if (pendingInvite) {
      // 尝试自动绑定：检查用户手机号是否匹配邀请手机号
      const usersCollection = db.collection('portal_users');
      const userRes = await usersCollection.where({ openId: OPENID }).limit(1).get();
      const user = userRes.data && userRes.data[0];
      
      if (user && user.phone && user.phone === pendingInvite.phone) {
        // 手机号匹配，自动创建角色记录
        try {
          const existingRole = await db.collection('portal_roles').where({
            openId: OPENID,
            roleKey: pendingInvite.roleKey,
            status: 1
          }).limit(1).get();
          
          if (existingRole.data.length === 0) {
            await db.collection('portal_roles').add({
              data: {
                openId: OPENID,
                roleKey: pendingInvite.roleKey,
                name: pendingInvite.name || '',
                phone: user.phone,
                scopeType: pendingInvite.scopeType,
                scopeId: pendingInvite.scopeId,
                scopeName: pendingInvite.scopeName || '',
                permissions: pendingInvite.permissions || [],
                status: 1,
                boundBy: 'auto_bind',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              }
            });
          }
          
          // 标记邀请为已绑定
          await db.collection('staff_invites').doc(pendingInvite._id).update({
            data: {
              boundOpenId: OPENID,
              boundAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          });
          
          // 角色已创建，重新走角色解析流程
          // Fall through to re-check roles
        } catch (e) {
          console.error('auto-bind error:', e);
          // 自动绑定失败，引导用户去绑定页面
        }
      }
      
      if (!pendingInvite.boundOpenId) {
        // 仍然未绑定，引导用户去绑定页面
        return {
          code: 200,
          data: {
            openId: OPENID,
            role: 'bind',
            target: buildBindTarget(pendingInvite.roleKey),
            roleOptions: [],
            needsChoice: false,
            pendingInvite: {
              roleKey: pendingInvite.roleKey,
              name: pendingInvite.name || ''
            }
          }
        };
      }
    }
    
    // 没有待绑定邀请 → 普通客户
    // ... (existing code continues)
```

Important: Since we already blocked the role creation with `limit(1)` on the invite query, and the invite is now bound, we need to re-query roles after auto-binding. The simplest approach: after successful auto-bind, re-run the entire role query logic (skip down to the roleOptions building code).

Actually, let me simplify. After auto-binding, just set a flag and re-run the role query:

```javascript
    if (pendingInvite) {
      // 尝试自动绑定
      const usersCollection = db.collection('portal_users');
      const userRes = await usersCollection.where({ openId: OPENID }).limit(1).get();
      const user = userRes.data && userRes.data[0];
      
      if (user && user.phone && user.phone === pendingInvite.phone) {
        // Auto-bind logic...
        // After successful auto-bind, re-query roles
        const roleRes = await db.collection('portal_roles').where({
          openId: OPENID,
          status: 1
        }).get();
        // ... build roleOptions from the fresh roles
      }
    }
```

This is cleaner. Let me structure it as: if auto-bind succeeds, re-run the role query and build roleOptions. If roleOptions exists after auto-bind, continue to the role resolution logic below instead of returning the bind target.
