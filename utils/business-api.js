const { callCloudFunction } = require('./cloud');

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

function _isCloudReady() {
  try {
    const app = getApp();
    return !!(app && app.globalData && app.globalData.cloudReady);
  } catch (error) {
    return false;
  }
}

function _cloudNotReadyResponse() {
  return {
    code: 503,
    message: '云开发未初始化，请先配置 CLOUD_ENV_ID 并部署云函数'
  };
}

async function _callPortalBiz(action, data = {}) {
  if (!_isCloudReady()) {
    return _cloudNotReadyResponse();
  }
  const res = await callCloudFunction('portalBiz', { action, ...data });
  if (!res) {
    return { code: 500, message: '云函数无返回' };
  }
  return res;
}

// 归一化分页响应：将 { data: { list, total, page, pageSize } } 归一化为 { data: [...] }
// 同时保留 total/page 信息供需要分页的调用方使用
function _normalizePaginatedRes(res, listKey) {
  if (res.code === 200 && res.data && typeof res.data === 'object' && Array.isArray(res.data.list)) {
    return {
      ...res,
      data: res.data.list,
      _total: res.data.total,
      _page: res.data.page,
      _pageSize: res.data.pageSize
    };
  }
  return res;
}

const businessAPI = {
  STATES,

  async getStores(page = 1, pageSize = 50) {
    const res = await _callPortalBiz('getStores', { page, pageSize });
    return _normalizePaginatedRes(res, 'stores');
  },

  async getCurrentContractId() {
    const res = await _callPortalBiz('getCurrentContractId');
    return (res.code === 200 && res.data && res.data.contractId) ? res.data.contractId : '';
  },

  /**
   * 创建新业务（仅当当前业务已完成时允许）
   */
  createNewContract() {
    return _callPortalBiz('createNewContract');
  },

  getContractStatus(contractId) {
    return _callPortalBiz('getContractStatus', { contractId });
  },

  submitPhone(phone, storeId) {
    return _callPortalBiz('submitPhone', { phone, storeId });
  },

  submitOrderInfo(contractId, info) {
    return _callPortalBiz('submitOrderInfo', { contractId, info });
  },

  submitSmsCode(contractId, code) {
    return _callPortalBiz('submitSmsCode', { contractId, code });
  },

  async adminGetContracts(page = 1, pageSize = 50) {
    const res = await _callPortalBiz('adminGetContracts', { page, pageSize });
    return _normalizePaginatedRes(res);
  },

  adminUpdateStatus(contractId, status, extra = {}) {
    return _callPortalBiz('adminUpdateStatus', { contractId, status, extra });
  },

  getCoupons() {
    return _callPortalBiz('getCoupons', {});
  },

  activateCoupon(phone, mobileBenefitId, mobileOrderId, authToken) {
    return _callPortalBiz('activateCoupon', { phone, mobileBenefitId, mobileOrderId, authToken });
  },

  generateVerifyCode(couponId) {
    return _callPortalBiz('generateVerifyCode', { couponId });
  },

  storeVerifyCoupon(verifyCode, storeId) {
    return _callPortalBiz('storeVerifyCoupon', { verifyCode, storeId });
  },

  storeConfirmVerify(couponId) {
    return _callPortalBiz('storeConfirmVerify', { couponId });
  },

  getStoreVerifyRecords(storeId) {
    return _callPortalBiz('getStoreVerifyRecords', { storeId });
  },

  getAdminStats() {
    return _callPortalBiz('getAdminStats');
  },

  // ========== 门店管理 ==========

  async adminGetStores(page = 1, pageSize = 50) {
    const res = await _callPortalBiz('adminGetStores', { page, pageSize });
    return _normalizePaginatedRes(res);
  },

  adminCreateStore(storeData) {
    return _callPortalBiz('adminCreateStore', storeData);
  },

  adminUpdateStore(storeId, storeData) {
    return _callPortalBiz('adminUpdateStore', { storeId, ...storeData });
  },

  adminDeleteStore(storeId) {
    return _callPortalBiz('adminDeleteStore', { storeId });
  },

  // 代金券规则
  getCouponRules() {
    return _callPortalBiz('getCouponRules');
  },

  createCouponRule(ruleData) {
    return _callPortalBiz('createCouponRule', ruleData);
  },

  deleteCouponRule(ruleId) {
    return _callPortalBiz('deleteCouponRule', { ruleId });
  },

  exportContracts() {
    return _callPortalBiz('exportContracts');
  },

  // 用户资料
  getUserInfo() {
    return _callPortalBiz('getUserInfo');
  },

  updateUserProfile(profile) {
    return _callPortalBiz('updateUserProfile', profile);
  }
};

module.exports = {
  businessAPI,
  STATES
};
