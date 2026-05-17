/**
 * 数据分析SDK工具类
 * 封装微信小程序数据分析SDK的埋点方法
 */

const Analytics = {
  /**
   * 初始化SDK（在 app.js onLaunch 中调用）
   */
  async init() {
    try {
      if (typeof wx !== 'undefined' && wx.obs && typeof wx.obs.setup === 'function') {
        const result = await wx.obs.setup({});
        console.log('[Analytics] SDK初始化成功', result);
        return result;
      }
    } catch (error) {
      console.error('[Analytics] SDK初始化失败', error);
    }
    return null;
  },

  /**
   * 上报用户身份信息
   * @param {Object} user 用户信息
   * @param {string} user.userId 用户唯一标识
   * @param {string} user.userType 用户类型 (customer/admin/store_owner)
   * @param {string} user.phone 手机号（明文）
   * @param {string} user.role 角色标识（管理员用）
   */
  setUser(user) {
    try {
      if (wx.obs && typeof wx.obs.setUser === 'function') {
        wx.obs.setUser(user);
        console.log('[Analytics] 上报用户身份', user.userType, user.userId);
      }
    } catch (error) {
      console.error('[Analytics] setUser 失败', error);
    }
  },

  /**
   * 上报自定义事件
   * @param {string} eventName 事件名称
   * @param {Object} properties 事件属性
   */
  track(eventName, properties = {}) {
    try {
      if (wx.obs && typeof wx.obs.track === 'function') {
        wx.obs.track(eventName, properties);
        console.log('[Analytics] 事件上报', eventName, properties);
      }
    } catch (error) {
      console.error('[Analytics] track 失败', error);
    }
  }
};

/**
 * 业务事件定义
 */
const AnalyticsEvents = {
  // ========== 用户登录相关 ==========
  LOGIN_SUCCESS: 'login_success',           // 登录成功
  LOGIN_FAILED: 'login_failed',             // 登录失败
  USER_INFO_AUTHORIZED: 'user_info_authorized', // 授权用户信息

  // ========== 合约办理流程 ==========
  CONTRACT_START: 'contract_start',         // 开始办理合约
  CONTRACT_SUBMIT: 'contract_submit',       // 提交合约申请
  CONTRACT_VERIFY_SMS: 'contract_verify_sms', // 验证码回填
  CONTRACT_SUCCESS: 'contract_success',     // 合约办理成功
  
  // ========== 管理员审核流程 ==========
  ADMIN_LOGIN: 'admin_login',               // 管理员登录
  ADMIN_APPROVE: 'admin_approve',           // 审核通过
  ADMIN_REJECT: 'admin_reject',             // 审核拒绝
  
  // ========== 代金券流程 ==========
  COUPON_ACTIVATED: 'coupon_activated',     // 代金券激活
  COUPON_USED: 'coupon_used',               // 代金券核销
  
  // ========== 门店管理 ==========
  STORE_CREATE: 'store_create',             // 创建门店
  STORE_BIND_COUPON: 'store_bind_coupon',   // 门店绑定代金券
  
  // ========== 角色管理 ==========
  ADMIN_INVITE_CREATE: 'admin_invite_create', // 创建管理员邀请
  ADMIN_BIND_SUCCESS: 'admin_bind_success',   // 管理员绑定成功
  STORE_OWNER_BIND_SUCCESS: 'store_owner_bind_success' // 门店负责人绑定成功
};

module.exports = {
  Analytics,
  AnalyticsEvents
};
