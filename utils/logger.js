/**
 * 日志工具函数
 */

/**
 * 获取当前时间的 ISO 格式字符串
 */
function nowISO() {
  return new Date().toISOString();
}

/**
 * 脱敏处理敏感信息（用于日志）
 * @param {string} text - 原始文本
 * @param {string} type - 脱敏类型: phone, idcard, name, address
 * @returns {string} 脱敏后的文本
 */
function sanitizeForLog(text, type = 'default') {
  const str = String(text || '');
  if (str.length < 4) return '***';
  
  switch (type) {
    case 'phone':
      return str.length >= 7 ? `${str.slice(0, 3)}****${str.slice(-4)}` : '***';
    case 'idcard':
      return str.length >= 10 ? `${str.slice(0, 4)}**********${str.slice(-4)}` : '***';
    case 'name':
      return str.length <= 2 ? '*' : `${str[0]}${'*'.repeat(str.length - 1)}`;
    case 'address':
      return str.length > 10 ? `${str.slice(0, 6)}...${str.slice(-4)}` : '***';
    default:
      return str.length > 8 ? `${str.slice(0, 3)}***${str.slice(-3)}` : '***';
  }
}

/**
 * 日志记录工具
 * @param {string} level - 日志级别: info, warn, error
 * @param {string} action - 操作类型
 * @param {object} data - 日志数据
 */
function logger(level, action, data = {}) {
  const logData = {
    timestamp: nowISO(),
    level,
    action,
    data: {
      ...data,
      // 脱敏处理敏感信息
      phone: data.phone ? sanitizeForLog(data.phone, 'phone') : undefined,
      contractId: data.contractId ? sanitizeForLog(data.contractId) : undefined,
      couponId: data.couponId ? sanitizeForLog(data.couponId) : undefined
    }
  };
  
  switch (level) {
    case 'error':
      console.error('ERROR:', logData);
      break;
    case 'warn':
      console.warn('WARN:', logData);
      break;
    default:
      console.log('INFO:', logData);
  }
}

module.exports = {
  nowISO,
  sanitizeForLog,
  logger
};