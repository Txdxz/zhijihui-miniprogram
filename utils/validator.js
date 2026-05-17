/**
 * 验证工具函数
 */

/**
 * 验证手机号格式
 * @param {string} phone - 手机号
 * @returns {boolean}
 */
export function validatePhone(phone) {
  return /^1[3-9]\d{9}$/.test(phone);
}

/**
 * 验证验证码格式
 * @param {string} code - 验证码
 * @returns {boolean}
 */
export function validateSmsCode(code) {
  return /^\d{6}$/.test(code);
}

/**
 * 验证字符串长度
 * @param {string} str - 字符串
 * @param {number} min - 最小长度
 * @param {number} max - 最大长度
 * @returns {boolean}
 */
export function validateLength(str, min, max) {
  const length = (str || '').length;
  return length >= min && length <= max;
}

/**
 * 统一参数验证工具
 * @param {object} params - 待验证的参数对象
 * @param {object} rules - 验证规则 { field: { required, type, min, max, pattern, message } }
 * @returns {object} { valid: boolean, errors: string[] }
 */
export function validateParams(params = {}, rules = {}) {
  const errors = [];
  for (const [field, rule] of Object.entries(rules)) {
    const value = params[field];
    
    // 必填检查
    if (rule.required && (value === undefined || value === null || value === '')) {
      errors.push(rule.message || `缺少必填字段: ${field}`);
      continue;
    }
    
    // 非必填且为空则跳过后续验证
    if (value === undefined || value === null || value === '') continue;
    
    // 类型检查
    if (rule.type) {
      const actualType = typeof value;
      if (rule.type === 'array' && !Array.isArray(value)) {
        errors.push(rule.message || `字段 ${field} 类型错误，应为数组`);
      } else if (rule.type !== 'array' && actualType !== rule.type) {
        errors.push(rule.message || `字段 ${field} 类型错误，应为 ${rule.type}`);
      }
    }
    
    // 数值范围检查
    if (rule.type === 'number' || typeof value === 'number') {
      if (rule.min !== undefined && value < rule.min) {
        errors.push(rule.message || `字段 ${field} 不能小于 ${rule.min}`);
      }
      if (rule.max !== undefined && value > rule.max) {
        errors.push(rule.message || `字段 ${field} 不能大于 ${rule.max}`);
      }
    }
    
    // 字符串长度检查
    if (typeof value === 'string') {
      if (rule.minLength !== undefined && value.length < rule.minLength) {
        errors.push(rule.message || `字段 ${field} 长度不能少于 ${rule.minLength} 个字符`);
      }
      if (rule.maxLength !== undefined && value.length > rule.maxLength) {
        errors.push(rule.message || `字段 ${field} 长度不能超过 ${rule.maxLength} 个字符`);
      }
    }
    
    // 正则匹配检查
    if (rule.pattern && typeof value === 'string') {
      if (!rule.pattern.test(value)) {
        errors.push(rule.message || `字段 ${field} 格式不正确`);
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}
