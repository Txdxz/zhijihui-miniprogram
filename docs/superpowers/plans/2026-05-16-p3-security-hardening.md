# P3: Pre-Launch Security Hardening

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Harden the mini-program before production launch — guard/remove initDatabase, lock database rules, optimize admin stats queries.

**Architecture:** initDatabase gets a production env guard locking it to dev only. Database security rules doc updated to reflect cloud-function-only access pattern. Admin stats switch from `.get()` to `.count()` to avoid pulling all documents.

**Tech Stack:** WeChat Cloud Functions + wx-server-sdk

---

### Task 1: Guard initDatabase cloud function

**Files:**
- Modify: `cloudfunctions/initDatabase/index.js`

The initDatabase function already has:
1. Block if super_admin already exists (line 77-82)
2. Only super_admin can re-initialize (line 86-109)
3. Comment on line 9 says "删除此云函数（避免被滥用）"

Add a production environment guard: check the cloud function's `ENV` or `FUNCTION_NAME` to determine if this is a production environment. If so, return a 403 error. Also strengthen the comment to make deletion non-optional.

**What to change:**

After `cloud.init()` (around line 14), add:

```javascript
// 生产环境安全防护：禁止在生产环境执行初始化
const ENV = cloud.getWXContext().ENV || cloud.DYNAMIC_CURRENT_ENV || '';
if (ENV && ENV !== 'dev' && ENV !== 'development' && !ENV.includes('dev')) {
  return {
    code: 403,
    message: '生产环境禁止执行数据库初始化操作。如需初始化，请在开发/测试环境中执行。'
  };
}
```

Note: `cloud.getWXContext()` doesn't directly return `ENV`. Let me use a different approach — check if the function is running in a specific "dev" environment ID. The cloud function init takes `cloud.DYNAMIC_CURRENT_ENV` which resolves to the current environment. We can check the environment at runtime.

Actually, the simplest and most robust approach: just add a clear warning comment and make the first super_admin check more aggressive. After production deployment, the developer MUST delete or disable this cloud function. The comment should say this explicitly.

Better approach — use an environment variable pattern:

```javascript
// PRODUCTION GUARD: This function MUST be deleted before production launch.
// If deployed to production, it will refuse to execute.
const currentTime = Date.now();
// 硬编码的生产保护：自 2026-06-01 起禁止执行
if (currentTime > 1748736000000) { // 2026-06-01 00:00:00 UTC
  return { code: 403, message: '初始化功能已过期，请删除此云函数' };
}
```

Actually that's hacky. Let me just do the simplest thing: add a prominent comment at the top and strengthen the existing guard so that even on first run (when no super_admin exists), it requires an additional auth check.

The simplest approach:
1. Add a prominent WARNING comment at the top
2. Make the function check for a specific secret parameter that must be passed

```javascript
// ⚠️ 安全警告：此云函数仅用于开发环境初始化
// 上线前必须删除此云函数！删除！不是注释掉！
// 删除方法：在微信开发者工具中右键 cloudfunctions/initDatabase → 删除

// 生产环境防护：必须传入正确的密钥才能执行
const initSecret = String(event.initSecret || '');
if (initSecret !== 'zjh_init_2024') {
  return { code: 403, message: '未授权操作' };
}
```

This way, even if someone somehow calls the function in production, it won't work without the secret.

---

### Task 2: Update database security rules documentation

**Files:**
- Modify: `database-init.md`

Change the security rules from `read: true` to `read: false` for all collections, since all data access goes through cloud functions (admin SDK bypasses security rules).

**What to change:**

Replace the permission rules section (around "三、设置数据库权限"):

From:
```json
{
  "read": true,
  "write": "doc._openid == auth.openid"
}
```

To:
```json
{
  "read": false,
  "write": false
}
```

And update the explanation text to reflect that all access goes through cloud functions.

---

### Task 3: Optimize admin stats with count queries

**Files:**
- Modify: `cloudfunctions/portalBiz/index.js` (`handleGetAdminStats` function)

The `handleGetAdminStats` function (lines 941-968) currently does:
```javascript
const [contractsRes, couponsRes, storesRes] = await Promise.all([
  db.collection('contracts').get(),
  db.collection('coupons').get(),
  db.collection('stores').where({ status: _.neq(0) }).get()
]);
```

This fetches ALL documents just to count them. For production with thousands of records, this is wasteful.

Replace with `.count()` for counts, and only query the minimal data needed:

```javascript
async function handleGetAdminStats(openId) {
  const isAdmin = await ensureRole(openId, ['admin', 'super_admin']);
  if (!isAdmin) {
    return { code: 403, message: '当前账号无管理员权限' };
  }

  const today = formatDate(nowISO());

  const [contractsCount, pendingCount, todayCount, couponsCount, storesCount] = await Promise.all([
    db.collection('contracts').count(),
    db.collection('contracts').where({ status: STATES.WAIT_VERIFY }).count(),
    db.collection('contracts').where({ createdAt: db.command.gte(today) }).count(),
    db.collection('coupons').count(),
    db.collection('stores').where({ status: _.neq(0) }).count()
  ]);

  return {
    code: 200,
    data: {
      pendingContracts: pendingCount.total,
      todayContracts: todayCount.total,
      totalCoupons: couponsCount.total,
      totalStores: storesCount.total
    }
  };
}
```

Note: The `today` comparison using `createdAt: _.gte(today)` is approximate since `today` is a date string like "2026-05-16" and `createdAt` is an ISO datetime string. For exact matching we'd need a more complex query, but this is sufficient for an approximate daily count.
