// utils/util.js - 工具函数

/**
 * 格式化日期时间
 */
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 格式化手机号（脱敏）
 */
function maskPhone(phone) {
  if (!phone || phone.length < 7) return phone;
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}

/**
 * 校验手机号
 */
function validatePhone(phone) {
  return /^1[3-9]\d{9}$/.test(phone);
}

/**
 * 倒计时格式化（秒数 → mm:ss）
 */
function formatCountdown(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * 获取状态显示文本
 */
function getStatusText(status) {
  const map = {
    0: '待提交',
    1: '核验中',
    2: '核验通过',
    3: '待验证码',
    4: '办理中',
    5: '合约已办',
    6: '已发货',
    7: '已签收'
  };
  return map[status] || '未知状态';
}

/**
 * 获取代金券状态文本
 */
function getCouponStatusText(status) {
  const map = {
    0: '未激活',
    1: '可使用',
    2: '已使用',
    3: '已过期'
  };
  return map[status] || '';
}

/**
 * 生成带前缀的唯一ID
 */
function genId(prefix) {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

/**
 * 标准化合约对象
 */
function normalizeContract(contract = {}) {
  return {
    ...contract,
    id: contract.id || contract.contractId || ''
  };
}

/**
 * 标准化代金券对象
 */
function normalizeCoupon(coupon = {}) {
  return {
    ...coupon,
    id: coupon.id || coupon.couponId || ''
  };
}

module.exports = {
  formatDate,
  maskPhone,
  validatePhone,
  formatCountdown,
  getStatusText,
  getCouponStatusText,
  genId,
  normalizeContract,
  normalizeCoupon
};
