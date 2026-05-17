/**
 * 云函数频率限制工具
 * 基于云数据库实现，限制每个 OPENID 对特定 action 的调用频率
 *
 * 规则：
 *   - 默认每 IP(OPENID) 每分钟最多调用 60 次
 *   - 敏感操作(短信验证码、门店创建)每分钟最多 5 次
 *   - 查询类接口每分钟最多 120 次
 */

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

// 频率限制配置（每分钟最大调用次数）
const LIMITS = {
  default: 60,
  // 查询操作：宽松
  getStores: 120,
  getCurrentContractId: 120,
  getContractStatus: 120,
  getCoupons: 120,
  getStoreVerifyRecords: 120,
  getAdminStats: 120,
  getMyStore: 120,
  exportContracts: 120,
  adminGetContracts: 120,
  adminGetStores: 120,
  getCouponRules: 120,
  queryPendingInvites: 60,
  // 写入操作：收紧
  submitPhone: 10,
  submitOrderInfo: 10,
  submitSmsCode: 10,
  createNewContract: 5,
  adminUpdateStatus: 30,
  adminCreateStore: 5,
  adminUpdateStore: 5,
  adminDeleteStore: 3,
  createCouponRule: 5,
  deleteCouponRule: 3,
  storeVerifyCoupon: 30,
  storeConfirmVerify: 20,
  generateVerifyCode: 10,
  // 身份绑定
  bindRole: 5,
  sendSmsCode: 3,
  // 管理员管理
  manageAdmin_default: 10,
  manageAdmin_invite: 5,
  manageAdmin_disableRole: 3,
  manageAdmin_update: 10,
  manageAdmin_list: 60
};

const WINDOW_MS = 60 * 1000; // 1 分钟窗口

/**
 * 检查调用频率
 * @param {string} openId - 用户的 openId
 * @param {string} action - 操作类型
 * @returns {{ allowed: boolean, message?: string }}
 */
async function checkRateLimit(openId, action) {
  if (!openId) {
    return { allowed: false, message: '无法识别用户身份' };
  }

  const maxCalls = LIMITS[action] || LIMITS.default;
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  const key = `${openId}_${action}`;

  try {
    // 清理过期记录
    const rateCollection = db.collection('rate_limits');

    // 查询当前窗口内的调用次数
    const records = await rateCollection.where({
      key,
      timestamp: _.gte(windowStart)
    }).count();

    const count = records.total;

    if (count >= maxCalls) {
      // 计算重置时间
      const latestRes = await rateCollection.where({
        key,
        timestamp: _.gte(windowStart)
      }).orderBy('timestamp', 'desc').limit(1).get();

      let resetIn = 60;
      if (latestRes.data && latestRes.data.length) {
        const oldestInWindow = latestRes.data[0].timestamp;
        resetIn = Math.ceil((oldestInWindow + WINDOW_MS - now) / 1000);
        if (resetIn < 1) resetIn = 60;
      }

      return {
        allowed: false,
        message: `操作过于频繁，请 ${resetIn} 秒后重试`
      };
    }

    // 记录本次调用
    await rateCollection.add({
      data: {
        key,
        openId,
        action,
        timestamp: now
      }
    }).catch(() => {
      // 插入失败不影响主流程（可能是集合不存在）
    });

    return { allowed: true };
  } catch (error) {
    // 限流检查失败时放行，避免影响正常业务
    console.warn('频率限制检查失败，放行:', error && error.message);
    return { allowed: true };
  }
}

module.exports = { checkRateLimit };
