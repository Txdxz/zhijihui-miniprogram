const cloud = require('wx-server-sdk');
const { checkRateLimit } = require('./rateLimit');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const MAX_PAGE_SIZE = 100; // 微信云开发单次查询上限

// 企业微信群机器人 Webhook
const WECOM_WEBHOOK = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=765dda76-444d-4b98-8d7e-c4d63ca91b58';

/**
 * 给管理员发送企业微信即时通知
 */
function sendWecomNotify(title, fields, link) {
  const https = require('https');
  const url = new URL(WECOM_WEBHOOK);
  const lines = [`## ${title}`];
  fields.forEach(([k, v]) => { lines.push(`> ${k}：<font color="info">${v}</font>`); });
  if (link) lines.push(`[查看详情](${link})`);
  const body = JSON.stringify({ msgtype: 'markdown', markdown: { content: lines.join('\n') } });
  const req = https.request({
    hostname: url.hostname,
    path: url.pathname + url.search,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, (res) => { res.on('data', () => {}); });
  req.on('error', (e) => { console.error('wecom notify error:', e.message); });
  req.write(body);
  req.end();
}

const STATES = {
  REJECTED: 0,
  WAIT_VERIFY: 1,
  QUALIFIED: 2,
  WAIT_SMSCODE: 3,
  CONTRACTING: 4,
  CONTRACT_OK: 5,
  SHIPPED: 6,
  SIGNED: 7,
  SMS_CODE_REJECTED: 8  // 验证码被驳回，需要用户重新输入
};

function nowISO() {
  return new Date().toISOString();
}

function genId(prefix) {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

function normalizeContract(contract = {}) {
  return {
    ...contract,
    id: contract.id || contract.contractId || ''
  };
}

function normalizeCoupon(coupon = {}) {
  return {
    ...coupon,
    id: coupon.id || coupon.couponId || ''
  };
}

function maskPhone(phone) {
  const text = String(phone || '');
  if (text.length < 7) return text || '未知';
  return `${text.slice(0, 3)}****${text.slice(-4)}`;
}

function formatDate(dateLike) {
  const d = new Date(dateLike);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 统一参数验证工具
 * @param {object} params - 待验证的参数对象
 * @param {object} rules - 验证规则 { field: { required, type, min, max, pattern, message } }
 * @returns {object} { valid: boolean, errors: string[] }
 */
function validateParams(params = {}, rules = {}) {
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
 * 发送企业微信通知管理员
 * @param {string} action - 通知类型：notifyVerifyPending / notifySmsCodePending / notifyNewSmsCode
 * @param {object} data - 通知数据
 */
async function notifyAdmins(action, data) {
  try {
    if (action === 'notifyVerifyPending') {
      sendWecomNotify('📱 新客户提交申请', [
        ['手机号', data.phone || ''],
        ['门店', data.storeName || '']
      ]);
    } else if (action === 'notifySmsCodePending') {
      sendWecomNotify('🔐 客户已提交验证码', [
        ['手机号', data.phone || ''],
        ['门店', data.storeName || '']
      ]);
    } else if (action === 'notifyNewSmsCode') {
      sendWecomNotify('🔐 客户重新提交验证码', [
        ['手机号', data.phone || ''],
        ['门店', data.storeName || '']
      ]);
    }
  } catch (error) {
    console.error('发送企业微信通知失败:', error);
  }
}

function formatTime(dateLike) {
  const d = new Date(dateLike);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function ensureRole(openId, roleKeys = []) {
  const res = await db.collection('portal_roles').where({
    openId,
    roleKey: _.in(roleKeys),
    status: 1
  }).limit(1).get();
  return !!(res.data && res.data.length);
}

async function ensureSuperAdmin(openId) {
  const res = await db.collection('portal_roles').where({
    openId,
    roleKey: 'super_admin',
    status: 1
  }).limit(1).get();
  return !!(res.data && res.data.length);
}

async function ensureStoreRole(openId, storeId) {
  const res = await db.collection('portal_roles').where({
    openId,
    roleKey: _.in(['store_owner', 'store_clerk']),
    scopeType: 'store',
    scopeId: storeId,
    status: 1
  }).limit(1).get();
  return !!(res.data && res.data.length);
}

async function getStoreById(storeId) {
  const res = await db.collection('stores').where({
    storeId,
    status: _.neq(0)
  }).limit(1).get();
  return res.data && res.data[0] ? res.data[0] : null;
}

async function setCurrentContractId(openId, contractId) {
  const users = db.collection('portal_users');
  const now = nowISO();
  const existing = await users.where({ openId }).limit(1).get();
  if (existing.data && existing.data.length) {
    await users.doc(existing.data[0]._id).update({
      data: {
        currentContractId: contractId || '',
        updatedAt: now
      }
    });
    return;
  }
  await users.add({
    data: {
      openId,
      status: 1,
      currentContractId: contractId || '',
      createdAt: now,
      updatedAt: now
    }
  });
}

/**
 * 更新用户的手机号
 * 在用户办理业务时自动同步手机号到用户表
 */
async function updateUserPhone(openId, phone) {
  if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
    return;
  }

  const users = db.collection('portal_users');
  const now = nowISO();
  const existing = await users.where({ openId }).limit(1).get();

  if (existing.data && existing.data.length) {
    // 更新现有用户记录的手机号
    await users.doc(existing.data[0]._id).update({
      data: {
        phone,
        updatedAt: now
      }
    });
  } else {
    // 创建新用户记录（兜底，理论上不应该走到这里）
    await users.add({
      data: {
        openId,
        phone,
        nickName: '',
        avatarUrl: '',
        status: 1,
        createdAt: now,
        updatedAt: now
      }
    });
  }
}

async function getCurrentContractId(openId) {
  const users = db.collection('portal_users');
  const existing = await users.where({ openId }).limit(1).get();
  const currentContractId = existing.data && existing.data[0]
    ? String(existing.data[0].currentContractId || '')
    : '';
  if (currentContractId) {
    return currentContractId;
  }

  const contractRes = await db.collection('contracts').where({
    openId,
    status: _.gte(STATES.WAIT_VERIFY)
  }).orderBy('createdAt', 'desc').limit(1).get();
  const contract = contractRes.data && contractRes.data[0];
  return contract ? String(contract.contractId || contract.id || '') : '';
}

/**
 * 自动注册：合约办理完成后，将客户手机号绑定到 openId
 * 用户办理合约时提交的验证码已被中国移动验证通过，手机号真实性有保障
 * 绑定后用户下次使用同一微信登录即可直接查看权益状态
 */
async function bindPhoneToUser(openId, phone) {
  if (!openId || !phone) return;
  try {
    const users = db.collection('portal_users');
    const existing = await users.where({ openId }).limit(1).get();
    if (existing.data && existing.data.length) {
      await users.doc(existing.data[0]._id).update({
        data: { phone, updatedAt: nowISO() }
      });
    }
  } catch (error) {
    console.error('自动注册绑定手机号失败:', error);
  }
}

async function handleUpdateUserProfile(openId, event = {}) {
  const nickName = String(event.nickName || '').trim();
  const avatarUrl = String(event.avatarUrl || '').trim();

  if (!nickName && !avatarUrl) {
    return { code: 400, message: '没有需要更新的信息' };
  }

  const now = nowISO();
  const users = db.collection('portal_users');
  const existing = await users.where({ openId }).limit(1).get();

  if (existing.data && existing.data.length) {
    const updateData = { updatedAt: now };
    if (nickName) updateData.nickName = nickName;
    if (avatarUrl) updateData.avatarUrl = avatarUrl;
    await users.doc(existing.data[0]._id).update({ data: updateData });
  } else {
    await users.add({
      data: { openId, nickName, avatarUrl, status: 1, createdAt: now, updatedAt: now }
    });
  }

  return { code: 200, data: { nickName, avatarUrl } };
}

async function handleGetStores(event = {}) {
  const page = Math.max(1, Number(event.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(event.pageSize) || 50));

  const [res, countRes] = await Promise.all([
    db.collection('stores').where({
      status: _.neq(0)
    }).skip((page - 1) * pageSize).limit(pageSize).get(),
    db.collection('stores').where({ status: _.neq(0) }).count()
  ]);

  return {
    code: 200,
    data: {
      list: (res.data || []).map((item) => ({
        id: item.storeId || item.id || '',
        storeId: item.storeId || item.id || '',
        name: item.name || '',
        province: item.province || '',
        city: item.city || '',
        district: item.district || '',
        address: item.address || '',
        phone: item.phone || '',
        owner: item.owner || '',
        location: item.location || null
      })),
      total: countRes.total,
      page,
      pageSize
    }
  };
}

async function handleGetCurrentContractId(openId) {
  const contractId = await getCurrentContractId(openId);
  return { code: 200, data: { contractId } };
}

async function handleCreateNewContract(openId) {
  // 获取当前合约
  const currentContractId = await getCurrentContractId(openId);
  
  if (currentContractId) {
    // 检查当前合约状态
    const res = await db.collection('contracts').where({
      contractId: currentContractId,
      openId
    }).limit(1).get();
    
    const contract = res.data && res.data[0];
    if (contract) {
      // 已完成状态：CONTRACT_OK(5), SHIPPED(6), SIGNED(7)
      const completedStates = [STATES.CONTRACT_OK, STATES.SHIPPED, STATES.SIGNED];
      if (!completedStates.includes(contract.status)) {
        // 合约还在进行中，不允许新办业务
        return { 
          code: 400, 
          message: '当前还有未完成的业务，请先完成当前业务' 
        };
      }
    }
  }
  
  // 清除当前合约指针，允许创建新合约
  await setCurrentContractId(openId, '');
  
  return { 
    code: 200, 
    data: { 
      canCreate: true,
      message: '可以创建新业务'
    } 
  };
}

async function handleGetContractStatus(openId, event = {}) {
  const contractId = String(event.contractId || '').trim();
  if (!contractId) {
    return { code: 400, message: '缺少合约标识' };
  }

  const res = await db.collection('contracts').where({
    contractId,
    openId
  }).limit(1).get();
  const contract = res.data && res.data[0];
  if (!contract) {
    return { code: 404, message: '合约记录不存在' };
  }

  return { code: 200, data: normalizeContract(contract) };
}

async function handleSubmitPhone(openId, event = {}) {
  const validation = validateParams(event, {
    phone: {
      required: true,
      pattern: /^1[3-9]\d{9}$/,
      message: '手机号格式不正确'
    },
    storeId: {
      required: true,
      message: '缺少门店信息'
    }
  });
  
  if (!validation.valid) {
    return { code: 400, message: validation.errors[0] };
  }
  
  const phone = String(event.phone || '').trim();
  const storeId = String(event.storeId || '').trim();
  
  const store = await getStoreById(storeId);
  if (!store) {
    return { code: 404, message: '门店不存在或已停用' };
  }

  const contractId = genId('C');
  const now = nowISO();
  const contract = {
    contractId,
    id: contractId,
    openId,
    phone,
    storeId,
    storeName: store.name || '',
    status: STATES.WAIT_VERIFY,
    createdAt: now,
    updatedAt: now,
    name: '',
    address: '',
    smsCode: '',
    trackingNo: '',
    logistics: []
  };
  
  // 记录日志
  logger('info', 'submit_phone', {
    openId,
    phone,
    storeId,
    storeName: store.name || '',
    contractId
  });
  
  await db.collection('contracts').add({ data: contract });
  await setCurrentContractId(openId, contractId);

  // 同步手机号到用户表
  await updateUserPhone(openId, phone);

  // 通知管理员：有新客户提交申请
  await notifyAdmins('notifyVerifyPending', {
    phone,
    storeName: store.name || ''
  });

  return { code: 200, data: { contractId, status: STATES.WAIT_VERIFY } };
}

async function handleSubmitOrderInfo(openId, event = {}) {
  const contractId = String(event.contractId || '').trim();
  const info = event.info || {};
  if (!contractId) return { code: 400, message: '缺少合约标识' };

  const res = await db.collection('contracts').where({ contractId, openId }).limit(1).get();
  const contract = res.data && res.data[0];
  if (!contract) return { code: 404, message: '合约记录不存在' };

  if (contract.status !== STATES.QUALIFIED) {
    return { code: 400, message: '当前状态不支持提交收货信息' };
  }

  const name = String(info.name || '').trim();
  const address = String(info.address || '').trim();
  const storeId = String(info.storeId || '').trim() || contract.storeId;
  if (!name || !address || !storeId) {
    return { code: 400, message: '收货信息不完整' };
  }

  const now = nowISO();
  await db.collection('contracts').doc(contract._id).update({
    data: {
      name,
      address,
      storeId,
      storeName: String(info.storeName || contract.storeName || ''),
      status: STATES.WAIT_SMSCODE,
      updatedAt: now
    }
  });

  sendWecomNotify('📋 客户已填写收货信息', [
    ['姓名', name],
    ['门店', String(info.storeName || contract.storeName || '')]
  ]);

  return { code: 200, data: { status: STATES.WAIT_SMSCODE } };
}

async function handleSubmitSmsCode(openId, event = {}) {
  const contractId = String(event.contractId || '').trim();
  const code = String(event.code || '').trim();
  if (!contractId) return { code: 400, message: '缺少合约标识' };
  if (!/^\d{6}$/.test(code)) return { code: 400, message: '验证码格式不正确' };

  const res = await db.collection('contracts').where({ contractId, openId }).limit(1).get();
  const contract = res.data && res.data[0];
  if (!contract) return { code: 404, message: '合约记录不存在' };

  // 检查当前状态
  const isNewSubmission = contract.status === STATES.WAIT_SMSCODE;
  const isResubmission = contract.status === STATES.CONTRACTING && contract.smsCode;
  const isAfterRejection = contract.status === STATES.SMS_CODE_REJECTED;

  if (!isNewSubmission && !isResubmission && !isAfterRejection) {
    return { code: 400, message: '当前状态不支持提交验证码' };
  }

  const now = nowISO();
  await db.collection('contracts').doc(contract._id).update({
    data: {
      smsCode: code,
      status: STATES.CONTRACTING,
      smsCodeRejectedAt: null,  // 清除驳回时间
      smsCodeRejectReason: '',  // 清除驳回原因
      updatedAt: now
    }
  });

  // 通知管理员：验证码待处理 或 新验证码
  if (isResubmission || isAfterRejection) {
    // 用户重新提交了验证码（被驳回后或验证码过期）
    await notifyAdmins('notifyNewSmsCode', {
      phone: contract.phone,
      smsCode: code,
      storeName: contract.storeName || ''
    });
  } else {
    // 首次提交验证码
    await notifyAdmins('notifySmsCodePending', {
      phone: contract.phone,
      smsCode: code,
      storeName: contract.storeName || ''
    });
  }

  return { code: 200, data: { status: STATES.CONTRACTING } };
}

async function handleGetCoupons(openId, event = {}) {
  // 按手机号查询代金券（用户可能多设备/多微信登录，以手机号为主键）
  const userRes = await db.collection('portal_users').where({ openId }).limit(1).get();
  const phone = (userRes.data && userRes.data[0] && userRes.data[0].phone) || '';

  let query = {};
  if (phone) {
    query = { phone };
  } else {
    query = { openId };
  }

  const res = await db.collection('coupons').where(query).orderBy('createdAt', 'desc').get();

  // 懒触发自动结算：查询时检查是否到了结算时间
  for (const c of res.data) {
    if (c.status === 1 && !c.settleType && c.settleAt && new Date(c.settleAt) <= new Date()) {
      tryAutoSettle(c);
    }
  }

  return { code: 200, data: (res.data || []).map(normalizeCoupon) };
}

async function handleGenerateVerifyCode(openId, event = {}) {
  const couponId = String(event.couponId || '').trim();
  if (!couponId) return { code: 400, message: '缺少代金券标识' };

  const couponRes = await db.collection('coupons').where({ couponId }).limit(1).get();
  const coupon = couponRes.data && couponRes.data[0];
  if (!coupon) return { code: 404, message: '代金券不存在' };

  // 权限校验：用户必须绑定与该券相同的手机号
  const userRes = await db.collection('portal_users').where({ openId }).limit(1).get();
  const userPhone = (userRes.data && userRes.data[0] && userRes.data[0].phone) || '';
  if (coupon.phone && userPhone !== coupon.phone) {
    return { code: 403, message: '无权操作该代金券' };
  }

  if (Number(coupon.status) !== 1) return { code: 400, message: '该券不可使用' };

  // 检查是否过期
  if (coupon.expireAt && new Date(coupon.expireAt) < new Date()) {
    await db.collection('coupons').doc(coupon._id).update({
      data: { status: 3, updatedAt: nowISO() }
    });
    return { code: 400, message: '该券已过期' };
  }

  // 懒触发自动结算检查
  if (!coupon.settleType && coupon.settleAt && new Date(coupon.settleAt) <= new Date()) {
    tryAutoSettle(coupon);
  }

  const verifyCode = String(Math.floor(100000 + Math.random() * 900000));
  const expireAt = Date.now() + 3 * 60 * 1000;
  await db.collection('coupons').doc(coupon._id).update({
    data: {
      verifyCode,
      verifyExpireAt: expireAt,
      updatedAt: nowISO()
    }
  });
  return { code: 200, data: { verifyCode, expireAt } };
}

async function handleStoreVerifyCoupon(openId, event = {}) {
  const verifyCode = String(event.verifyCode || '').trim();
  const storeId = String(event.storeId || '').trim();
  if (!verifyCode || !storeId) {
    return { code: 400, message: '参数不完整' };
  }
  const canVerify = await ensureStoreRole(openId, storeId);
  if (!canVerify) {
    return { code: 403, message: '当前账号无门店核销权限' };
  }

  const now = Date.now();
  const res = await db.collection('coupons').where({
    verifyCode
  }).limit(1).get();
  const coupon = res.data && res.data[0];
  if (!coupon) {
    return { code: 400, message: '核销码无效，请检查输入' };
  }
  if (coupon.storeId !== storeId) return { code: 403, message: '该券不属于当前门店' };
  if (Number(coupon.status) === 2) return { code: 400, message: '该券已核销使用' };
  if (Number(coupon.status) === 3) return { code: 400, message: '该券已过期' };
  if (!coupon.verifyExpireAt || Number(coupon.verifyExpireAt) <= now) {
    return { code: 400, message: '核销码已过期，请让客户重新生成' };
  }

  return {
    code: 200,
    data: {
      couponId: coupon.couponId,
      storeName: coupon.storeName,
      amount: coupon.amount || 20,
      contractId: coupon.contractId
    }
  };
}

async function handleStoreConfirmVerify(openId, event = {}) {
  const couponId = String(event.couponId || '').trim();
  if (!couponId) return { code: 400, message: '缺少代金券标识' };

  const res = await db.collection('coupons').where({ couponId }).limit(1).get();
  const coupon = res.data && res.data[0];
  if (!coupon) return { code: 404, message: '代金券不存在' };

  const canVerify = await ensureStoreRole(openId, coupon.storeId);
  if (!canVerify) return { code: 403, message: '当前账号无门店核销权限' };

  if (Number(coupon.status) !== 1) {
    return { code: 400, message: '该券不可核销' };
  }

  // 检查是否过期
  if (coupon.expireAt && new Date(coupon.expireAt) < new Date()) {
    await db.collection('coupons').doc(coupon._id).update({
      data: { status: 3, updatedAt: nowISO() }
    });
    return { code: 400, message: '该券已过期' };
  }

  const now = nowISO();
  await db.collection('coupons').doc(coupon._id).update({
    data: {
      status: 2,
      usedCount: Number(coupon.usedCount || 0) + 1,
      usedAt: now,
      verifyCode: '',
      verifyExpireAt: 0,
      settleType: 'manual',  // 用户主动核销
      settleAt: now,
      updatedAt: now
    }
  });

  const updatedRes = await db.collection('coupons').where({ couponId }).limit(1).get();
  const updated = updatedRes.data && updatedRes.data[0];

  // 核销状态回传中国移动（异步，不阻塞核销结果返回）
  if (updated.mobileBenefitId) {
    notifyMobileSettle(updated, 'manual').catch(err => {
      console.error('手动核销回传移动失败:', err);
    });
  }

  return {
    code: 200,
    data: normalizeCoupon(updated)
  };
}

/**
 * 核销状态回传中国移动
 * TODO: 待移动提供正式接口地址和鉴权方式后补充实现
 */
/**
 * 懒触发自动结算：在查询券或生成核销码时检查是否到了结算时间
 * 到了结算时间且尚未结算 → 自动向移动回传"已核销"状态
 * 结算后券仍可正常使用，settleType='auto' 记录为自动结算
 */
async function tryAutoSettle(coupon) {
  if (!coupon || !coupon._id) return;
  if (coupon.settleType) return; // 已结算，跳过

  const now = nowISO();
  await db.collection('coupons').doc(coupon._id).update({
    data: {
      settleType: 'auto',
      settleAt: now,
      updatedAt: now
    }
  });

  // 异步回传移动（不阻塞主流程）
  notifyMobileSettle(coupon, 'auto').catch(err => {
    console.error('自动结算回传移动失败:', err);
  });
}

/**
 * 回传结算状态给中国移动
 * @param {string} settleType - 'auto'=自动结算, 'manual'=用户核销
 * TODO: 待移动提供正式接口地址和鉴权方式
 */
async function notifyMobileSettle(coupon, settleType = 'auto') {
  console.log('回传移动结算状态:', {
    mobileBenefitId: coupon.mobileBenefitId,
    mobileOrderId: coupon.mobileOrderId,
    couponId: coupon.couponId,
    settleType,
    phone: coupon.phone,
    storeId: coupon.storeId
  });

  // TODO: 移动提供接口后实现 HTTP 请求
  // const body = JSON.stringify({
  //   benefitId: coupon.mobileBenefitId,
  //   orderId: coupon.mobileOrderId,
  //   status: 'used',  // 已核销
  //   phone: coupon.phone,
  //   storeId: coupon.storeId,
  //   settleType: settleType  // auto / manual
  // });

  await db.collection('coupons').doc(coupon._id).update({
    data: { mobileNotifiedAt: nowISO() }
  });
}

async function handleGetStoreVerifyRecords(openId, event = {}) {
  const storeId = String(event.storeId || '').trim();
  if (!storeId) return { code: 200, data: { recordsByMonth: [], todayTotal: 0 } };

  const canVerify = await ensureStoreRole(openId, storeId);
  if (!canVerify) return { code: 403, message: '当前账号无门店核销权限' };

  const couponsRes = await db.collection('coupons').where({
    storeId,
    status: 2
  }).get();
  const usedCoupons = couponsRes.data || [];
  if (!usedCoupons.length) {
    return { code: 200, data: { recordsByMonth: [], todayTotal: 0 } };
  }

  const contractIds = Array.from(new Set(
    usedCoupons.map(item => item.contractId).filter(Boolean)
  ));
  const contractRes = await db.collection('contracts').where({
    contractId: _.in(contractIds)
  }).get();
  const contractMap = new Map((contractRes.data || []).map(item => [item.contractId, item]));

  const monthMap = {};
  usedCoupons.forEach((coupon) => {
    const usedAt = coupon.usedAt || nowISO();
    const month = formatDate(usedAt).slice(0, 7);
    if (!monthMap[month]) {
      monthMap[month] = { month, list: [], total: 0 };
    }
    const contract = contractMap.get(coupon.contractId);
    const phone = maskPhone(contract ? contract.phone : '未知');
    const amount = Number(coupon.amount || 20);
    monthMap[month].list.push({
      amount,
      phone,
      time: formatTime(usedAt),
      date: formatDate(usedAt)
    });
    monthMap[month].total += amount;
  });

  const today = formatDate(nowISO());
  const todayTotal = usedCoupons
    .filter(item => formatDate(item.usedAt || nowISO()) === today)
    .reduce((sum, item) => sum + Number(item.amount || 20), 0);

  return {
    code: 200,
    data: {
      recordsByMonth: Object.values(monthMap).sort((a, b) => b.month.localeCompare(a.month)),
      todayTotal
    }
  };
}

async function handleAdminGetContracts(openId, event = {}) {
  const isAdmin = await ensureRole(openId, ['admin', 'super_admin']);
  if (!isAdmin) {
    return { code: 403, message: '当前账号无管理员权限' };
  }
  const page = Math.max(1, Number(event.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(event.pageSize) || 50));

  const [res, countRes] = await Promise.all([
    db.collection('contracts').orderBy('createdAt', 'desc').skip((page - 1) * pageSize).limit(pageSize).get(),
    db.collection('contracts').count()
  ]);

  return {
    code: 200,
    data: {
      list: (res.data || []).map(normalizeContract),
      total: countRes.total,
      page,
      pageSize
    }
  };
}

async function handleAdminUpdateStatus(openId, event = {}) {
  const isAdmin = await ensureRole(openId, ['admin', 'super_admin']);
  if (!isAdmin) {
    return { code: 403, message: '当前账号无管理员权限' };
  }

  const contractId = String(event.contractId || '').trim();
  const status = event.status !== undefined ? Number(event.status) : undefined;
  const extra = event.extra || {};
  if (!contractId || status === undefined || isNaN(status)) {
    return { code: 400, message: '参数不完整' };
  }

  const contractRes = await db.collection('contracts').where({ contractId }).limit(1).get();
  const contract = contractRes.data && contractRes.data[0];
  if (!contract) return { code: 404, message: '合约记录不存在' };

  const nextData = {
    status,
    updatedAt: nowISO()
  };
  if (typeof extra === 'object' && extra) {
    Object.assign(nextData, extra);
  }
  if (status === STATES.SHIPPED && !nextData.shippedAt) {
    nextData.shippedAt = nowISO();
  }
  if (status === STATES.CONTRACT_OK && !nextData.contractOkAt) {
    nextData.contractOkAt = nowISO();
  }
  if (status === STATES.SIGNED && !nextData.signedAt) {
    nextData.signedAt = nowISO();
  }
  // 验证码驳回时记录驳回时间和原因
  if (status === STATES.SMS_CODE_REJECTED) {
    nextData.smsCodeRejectedAt = nowISO();
    nextData.smsCodeRejectReason = extra.rejectReason || '验证码无效或已过期';
  }

  await db.collection('contracts').doc(contract._id).update({ data: nextData });
  if (status === STATES.CONTRACT_OK) {
    // 合约办理完成，自动将手机号绑定到 openId，完成用户注册
    // 代金券不再由合约触发，统一由移动回调 activateCoupon 生成
    await bindPhoneToUser(contract.openId, contract.phone);
  }

  const updatedRes = await db.collection('contracts').where({ contractId }).limit(1).get();
  const updated = updatedRes.data && updatedRes.data[0];
  return { code: 200, data: normalizeContract(updated || {}) };
}

async function handleGetAdminStats(openId) {
  const isAdmin = await ensureRole(openId, ['admin', 'super_admin']);
  if (!isAdmin) {
    return { code: 403, message: '当前账号无管理员权限' };
  }

  const today = formatDate(nowISO());

  const [contractsCount, pendingCount, couponsCount, storesCount] = await Promise.all([
    db.collection('contracts').count(),
    db.collection('contracts').where({ status: STATES.WAIT_VERIFY }).count(),
    db.collection('coupons').count(),
    db.collection('stores').where({ status: _.neq(0) }).count()
  ]);

  return {
    code: 200,
    data: {
      pendingContracts: pendingCount.total,
      todayContracts: 0,  // 精确的当日统计需要更复杂的日期查询，保持为 0 避免误导
      totalCoupons: couponsCount.total,
      totalStores: storesCount.total
    }
  };
}

// ========== 门店管理 ==========

async function handleAdminGetStores(openId, event = {}) {
  const isAdmin = await ensureRole(openId, ['admin', 'super_admin']);
  if (!isAdmin) {
    return { code: 403, message: '当前账号无管理员权限' };
  }
  return handleGetStores(event);
}

async function handleAdminCreateStore(openId, event = {}) {
  const isSuperAdmin = await ensureSuperAdmin(openId);
  if (!isSuperAdmin) {
    return { code: 403, message: '当前账号无超级管理员权限' };
  }

  const { name, province, city, district, address, owner, phone } = event;
  // 门店名称和省市区为必填，详细地址可选
  if (!name || !province || !city || !district) {
    return { code: 400, message: '请填写门店名称和完整地区信息' };
  }

  const storeId = genId('S');
  const now = nowISO();
  const storeName = String(name).trim();
  const ownerPhone = String(phone || '').trim();
  const ownerName = String(owner || '').trim();

  // 业务规则：一个手机号只能对应一个角色
  // 检查该手机号是否已有待绑定邀请或已绑定角色
  if (ownerPhone && /^1\d{10}$/.test(ownerPhone)) {
    // 检查是否已有待绑定邀请
    const existingInvite = await db.collection('staff_invites').where({
      phone: ownerPhone,
      status: 1
    }).limit(1).get();

    if (existingInvite.data && existingInvite.data.length > 0) {
      const invite = existingInvite.data[0];
      // 如果是当前门店的邀请，允许；否则拒绝
      if (!(invite.roleKey === 'store_owner' && invite.scopeId === storeId)) {
        const roleNames = { admin: '管理员', store_owner: '门店负责人', store_clerk: '店员' };
        return {
          code: 400,
          message: `该手机号已有${roleNames[invite.roleKey] || '角色'}邀请待绑定，无法重复邀请`
        };
      }
    }

    // 检查是否已有绑定角色
    const existingRole = await db.collection('portal_roles').where({
      phone: ownerPhone,
      status: 1
    }).limit(1).get();

    if (existingRole.data && existingRole.data.length > 0) {
      const role = existingRole.data[0];
      const roleNames = { admin: '管理员', store_owner: '门店负责人', store_clerk: '店员', super_admin: '超级管理员' };
      return {
        code: 400,
        message: `该手机号已是${roleNames[role.roleKey] || '角色'}，无法重复绑定`
      };
    }
  }

  const store = {
    storeId,
    id: storeId,
    name: storeName,
    province: String(province).trim(),
    city: String(city).trim(),
    district: String(district).trim(),
    address: String(address || '').trim(), // 可选
    owner: ownerName,
    phone: ownerPhone,
    location: event.location || null,
    status: 1,
    createdAt: now,
    updatedAt: now
  };

  await db.collection('stores').add({ data: store });

  // 如果填写了店长手机号且校验通过，自动创建店长邀请记录
  if (ownerPhone && /^1\d{10}$/.test(ownerPhone)) {
    await db.collection('staff_invites').add({
      data: {
        phone: ownerPhone,
        name: ownerName,
        roleKey: 'store_owner',
        scopeType: 'store',
        scopeId: storeId,
        scopeName: storeName,
        permissions: ['coupon.verify', 'store.record.view'],
        status: 1,
        boundOpenId: '',
        boundAt: '',
        createdBy: openId,
        createdAt: now,
        updatedAt: now
      }
    });
  }

  return { code: 200, data: { storeId, ...store } };
}

async function handleAdminUpdateStore(openId, event = {}) {
  const isSuperAdmin = await ensureSuperAdmin(openId);
  if (!isSuperAdmin) {
    return { code: 403, message: '当前账号无超级管理员权限' };
  }

  const { storeId, name, province, city, district, address, owner, phone } = event;
  if (!storeId) {
    return { code: 400, message: '缺少门店ID' };
  }

  const storeRes = await db.collection('stores').where({ storeId }).limit(1).get();
  if (!storeRes.data || !storeRes.data[0]) {
    return { code: 404, message: '门店不存在' };
  }

  const oldStore = storeRes.data[0];
  const now = nowISO();
  const oldPhone = String(oldStore.phone || '').trim();
  const newPhone = phone !== undefined ? String(phone || '').trim() : oldPhone;
  const newName = owner !== undefined ? String(owner || '').trim() : oldStore.owner;
  const storeName = name !== undefined ? String(name).trim() : oldStore.name;

  // 业务规则：一个手机号只能对应一个角色
  // 如果店长手机号变更，检查新手机号是否已有角色
  if (newPhone && newPhone !== oldPhone && /^1\d{10}$/.test(newPhone)) {
    // 检查是否已有待绑定邀请
    const existingInvite = await db.collection('staff_invites').where({
      phone: newPhone,
      status: 1
    }).limit(1).get();

    if (existingInvite.data && existingInvite.data.length > 0) {
      const invite = existingInvite.data[0];
      const roleNames = { admin: '管理员', store_owner: '门店负责人', store_clerk: '店员' };
      return {
        code: 400,
        message: `该手机号已有${roleNames[invite.roleKey] || '角色'}邀请待绑定，无法重复邀请`
      };
    }

    // 检查是否已有绑定角色
    const existingRole = await db.collection('portal_roles').where({
      phone: newPhone,
      status: 1
    }).limit(1).get();

    if (existingRole.data && existingRole.data.length > 0) {
      const role = existingRole.data[0];
      const roleNames = { admin: '管理员', store_owner: '门店负责人', store_clerk: '店员', super_admin: '超级管理员' };
      return {
        code: 400,
        message: `该手机号已是${roleNames[role.roleKey] || '角色'}，无法重复绑定`
      };
    }
  }

  const updateData = {
    updatedAt: now
  };
  if (name !== undefined) updateData.name = String(name).trim();
  if (province !== undefined) updateData.province = String(province).trim();
  if (city !== undefined) updateData.city = String(city).trim();
  if (district !== undefined) updateData.district = String(district).trim();
  if (address !== undefined) updateData.address = String(address || '').trim();
  if (owner !== undefined) updateData.owner = String(owner || '').trim();
  if (phone !== undefined) updateData.phone = String(phone || '').trim();
  if (event.location !== undefined) updateData.location = event.location || null;

  await db.collection('stores').doc(oldStore._id).update({ data: updateData });

  // 如果店长手机号变更，处理邀请记录
  if (newPhone && newPhone !== oldPhone && /^1\d{10}$/.test(newPhone)) {
    // 作废旧手机号的邀请（如果存在且未绑定）
    if (oldPhone) {
      const oldInviteRes = await db.collection('staff_invites').where({
        phone: oldPhone,
        scopeType: 'store',
        scopeId: storeId,
        boundOpenId: '',  // 未绑定
        status: 1
      }).limit(1).get();

      if (oldInviteRes.data && oldInviteRes.data.length > 0) {
        await db.collection('staff_invites').doc(oldInviteRes.data[0]._id).update({
          data: { status: 0, updatedAt: now }
        });
      }
    }

    // 创建新手机号的邀请记录
    await db.collection('staff_invites').add({
      data: {
        phone: newPhone,
        name: newName,
        roleKey: 'store_owner',
        scopeType: 'store',
        scopeId: storeId,
        scopeName: storeName,
        permissions: ['coupon.verify', 'store.record.view'],
        status: 1,
        boundOpenId: '',
        boundAt: '',
        createdBy: openId,
        createdAt: now,
        updatedAt: now
      }
    });
  } else if (newPhone && newPhone === oldPhone) {
    // 手机号未变，只更新邀请记录中的姓名等信息
    const existingInvite = await db.collection('staff_invites').where({
      phone: newPhone,
      scopeType: 'store',
      scopeId: storeId,
      status: 1
    }).limit(1).get();

    if (existingInvite.data && existingInvite.data.length > 0) {
      await db.collection('staff_invites').doc(existingInvite.data[0]._id).update({
        data: {
          name: newName,
          scopeName: storeName,
          updatedAt: now
        }
      });
    }
  }

  return { code: 200, data: { storeId, updated: true } };
}

async function handleAdminDeleteStore(openId, event = {}) {
  const isSuperAdmin = await ensureSuperAdmin(openId);
  if (!isSuperAdmin) {
    return { code: 403, message: '当前账号无超级管理员权限' };
  }

  const { storeId } = event;
  if (!storeId) {
    return { code: 400, message: '缺少门店ID' };
  }

  const storeRes = await db.collection('stores').where({ storeId }).limit(1).get();
  if (!storeRes.data || !storeRes.data[0]) {
    return { code: 404, message: '门店不存在' };
  }

  // 软删除：标记status为0
  await db.collection('stores').doc(storeRes.data[0]._id).update({
    data: { status: 0, updatedAt: nowISO() }
  });
  return { code: 200, data: { storeId, deleted: true } };
}

// ========== 代金券规则管理 ==========

async function handleGetCouponRules(openId) {
  const isAdmin = await ensureRole(openId, ['admin', 'super_admin']);
  if (!isAdmin) {
    return { code: 403, message: '当前账号无管理员权限' };
  }

  const res = await db.collection('coupon_rules').where({
    status: _.neq(0)
  }).orderBy('createdAt', 'desc').get();

  return { code: 200, data: res.data || [] };
}

async function handleCreateCouponRule(openId, event = {}) {
  const isSuperAdmin = await ensureSuperAdmin(openId);
  if (!isSuperAdmin) {
    return { code: 403, message: '当前账号无超级管理员权限' };
  }

  const { name, amount, totalCount, validMonths, monthlyLimit, storeScope, selectedStores, notes } = event;

  if (!name) return { code: 400, message: '请填写规则名称' };
  if (!amount || amount <= 0) return { code: 400, message: '面额必须大于0' };
  if (!validMonths || validMonths <= 0) return { code: 400, message: '有效期必须大于0' };
  if (!monthlyLimit || monthlyLimit <= 0) return { code: 400, message: '每月限用必须大于0' };
  if (storeScope === 'bound' && (!selectedStores || !selectedStores.length)) {
    return { code: 400, message: '请选择至少一个绑定门店' };
  }

  const now = nowISO();
  const rule = {
    id: genId('R'),
    name: String(name).trim(),
    amount: Number(amount),
    totalCount: Number(totalCount),
    validMonths: Number(validMonths) || 5,
    monthlyLimit: Number(monthlyLimit) || 1,
    storeScope: storeScope || 'all',
    selectedStores: storeScope === 'bound' ? (selectedStores || []) : [],
    notes: String(notes || '').trim(),
    status: 1,
    createdAt: now,
    updatedAt: now
  };

  await db.collection('coupon_rules').add({ data: rule });
  return { code: 200, data: rule };
}

async function handleDeleteCouponRule(openId, event = {}) {
  const isSuperAdmin = await ensureSuperAdmin(openId);
  if (!isSuperAdmin) {
    return { code: 403, message: '当前账号无超级管理员权限' };
  }

  const { ruleId } = event;
  if (!ruleId) return { code: 400, message: '缺少规则ID' };

  const ruleRes = await db.collection('coupon_rules').where({ id: ruleId }).limit(1).get();
  if (!ruleRes.data || !ruleRes.data[0]) {
    return { code: 404, message: '规则不存在' };
  }

  // 软删除
  await db.collection('coupon_rules').doc(ruleRes.data[0]._id).update({
    data: { status: 0, updatedAt: nowISO() }
  });

  return { code: 200, data: { ruleId, deleted: true } };
}

/**
 * 查询待绑定的邀请记录（根据手机号）
 * 用于绑定页面确定用户有哪些角色可以绑定
 */
async function handleQueryPendingInvites(openId, event = {}) {
  const phone = String(event.phone || '').trim();
  if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
    return { code: 400, message: '请输入正确的手机号' };
  }
  
  // 安全检查：只允许管理员或本人查询
  const isAdmin = await ensureRole(openId, ['admin', 'super_admin']);
  
  // 如果不是管理员，检查是否是查询自己的手机号
  if (!isAdmin) {
    // 查询该手机号是否已绑定到当前用户
    const userRes = await db.collection('portal_users').where({
      openId,
      phone
    }).limit(1).get();
    
    if (!userRes.data || userRes.data.length === 0) {
      // 也检查角色表中是否有该手机号绑定到当前用户
      const roleRes = await db.collection('portal_roles').where({
        openId,
        phone
      }).limit(1).get();
      
      if (!roleRes.data || roleRes.data.length === 0) {
        return { 
          code: 403, 
          message: '无权查询该手机号信息' 
        };
      }
    }
  }

  const inviteRes = await db.collection('staff_invites').where({
    phone,
    boundOpenId: '',  // 未绑定
    status: 1
  }).get();

  const invites = (inviteRes.data || []).map(inv => ({
    roleKey: inv.roleKey,
    roleType: inv.roleKey === 'store_owner' ? '门店负责人' :
              inv.roleKey === 'store_clerk' ? '店员' :
              inv.roleKey === 'admin' ? '管理员' : inv.roleKey,
    scopeType: inv.scopeType,
    scopeId: inv.scopeId,
    scopeName: inv.scopeName || ''
  }));

  return { code: 200, data: invites };
}

/**
 * 获取当前用户关联的门店信息
 */
async function handleGetMyStore(openId) {
  // 查询用户的角色记录
  const roleRes = await db.collection('portal_roles').where({
    openId,
    status: 1
  }).get();

  const roles = roleRes.data || [];

  // 找到门店相关角色
  const storeRole = roles.find(r =>
    r.roleKey === 'store_owner' || r.roleKey === 'store_clerk'
  );

  if (!storeRole || !storeRole.scopeId) {
    return { code: 404, message: '未分配门店' };
  }

  // 查询门店详情
  const storeRes = await db.collection('stores').where({
    storeId: storeRole.scopeId
  }).limit(1).get();

  const store = storeRes.data && storeRes.data[0];

  if (!store) {
    return { code: 404, message: '门店不存在' };
  }

  return {
    code: 200,
    data: {
      storeId: store.storeId || store.id,
      name: store.name || '',
      address: store.address || '',
      province: store.province || '',
      city: store.city || '',
      district: store.district || '',
      phone: store.phone || '',
      owner: store.owner || ''
    }
  };
}

/**
 * 获取当前用户资料、合约列表和代金券统计
 */
async function handleGetUserInfo(openId, event = {}) {
  try {
    // 1. 获取用户资料
    const usersCollection = db.collection('portal_users');
    const userRes = await usersCollection.where({ openId }).limit(1).get();
    if (userRes.data.length === 0) {
      return { code: 404, message: '用户不存在' };
    }
    const user = userRes.data[0];

    // 2. 获取用户的合约列表
    let contracts = [];
    if (user.phone) {
      const contractsCollection = db.collection('contracts');
      const contractRes = await contractsCollection.where({ phone: user.phone }).orderBy('createdAt', 'desc').get();
      contracts = (contractRes.data || []).map(c => ({
        _id: c._id,
        contractId: c.contractId || c.id || '',
        phone: c.phone || '',
        name: c.name || '',
        idCard: c.idCard || '',
        address: c.address || '',
        status: c.status !== undefined ? c.status : 0,
        storeId: c.storeId || '',
        storeName: c.storeName || '',
        createdAt: c.createdAt,
        updatedAt: c.updatedAt
      }));
    }

    // 3. 获取代金券统计
    let totalCoupons = 0;
    let activeCoupons = 0;
    let usedCoupons = 0;
    let pendingCoupons = 0;

    if (contracts.length > 0) {
      const contractIds = contracts.map(c => c._id);
      const couponsCollection = db.collection('coupons');
      const couponRes = await couponsCollection.where({
        contractId: _.in(contractIds)
      }).get();
      const allCoupons = couponRes.data || [];
      totalCoupons = allCoupons.length;
      activeCoupons = allCoupons.filter(c => Number(c.status) === 1).length;
      usedCoupons = allCoupons.filter(c => Number(c.status) === 2).length;
      pendingCoupons = allCoupons.filter(c => Number(c.status) === 0).length;
    }

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
        contracts,
        couponStats: {
          total: totalCoupons,
          pending: pendingCoupons,
          active: activeCoupons,
          used: usedCoupons
        }
      }
    };
  } catch (e) {
    console.error('handleGetUserInfo error:', e);
    return { code: 500, message: e.message || '获取用户信息失败' };
  }
}

async function handleExportContracts(openId) {
  const isAdmin = await ensureRole(openId, ['admin', 'super_admin']);
  if (!isAdmin) {
    return { code: 403, message: '当前账号无管理员权限' };
  }

  const res = await db.collection('contracts').orderBy('createdAt', 'desc').get();
  const contracts = res.data || [];

  return {
    code: 200,
    data: contracts.map(contract => ({
      contractId: contract.contractId || contract.id,
      phone: contract.phone || '',
      storeName: contract.storeName || '',
      status: contract.status || 0,
      statusText: {
        0: '已拒绝',
        1: '待核验',
        2: '核验通过',
        3: '待验证码',
        4: '办理中',
        5: '合约已办',
        6: '已发货',
        7: '已完成',
        8: '验证码被驳回'
      }[contract.status] || '未知',
      createdAt: contract.createdAt || '',
      updatedAt: contract.updatedAt || '',
      name: contract.name || '',
      address: contract.address || '',
      trackingNo: contract.trackingNo || ''
    }))
  };
}

/**
 * 移动回调：用户在移动平台领取权益后激活代金券
 * 由中国移动权益优选小程序在用户领取后回调
 * @param {string} contractId - 合约ID
 * @param {string} mobileBenefitId - 移动权益ID
 * @param {string} mobileOrderId - 移动订单ID
 * @param {string} authToken - 接口鉴权令牌
 */
/**
 * 中国移动权益回调：用户在移动平台领取权益后，智机惠生成代金券
 * 券生成即激活（status=1），30天有效期
 * 按手机号匹配门店：有合约记录则绑定门店，无合约记录则为通用券
 */
async function handleActivateCoupon(openId, event = {}) {
  const { phone, mobileBenefitId, mobileOrderId, authToken } = event;

  // 接口鉴权（移动对接时替换为正式令牌）
  if (!authToken || authToken !== 'zjh_callback_2024') {
    return { code: 403, message: 'unauthorized' };
  }

  if (!phone) {
    return { code: 400, message: '缺少参数 phone' };
  }

  // 检查该手机号是否已有可用代金券（避免重复领取）
  const existingRes = await db.collection('coupons').where({
    phone,
    status: _.in([1])  // 可使用
  }).limit(1).get();
  if (existingRes.data && existingRes.data.length > 0) {
    return { code: 400, message: '该手机号已有可用代金券，请先使用或等待过期' };
  }

  const now = nowISO();

  // 按手机号匹配最近合约，获取门店信息
  let storeId = '';
  let storeName = '';
  let contractId = '';
  try {
    const contractRes = await db.collection('contracts').where({
      phone,
      status: _.gte(STATES.CONTRACT_OK)  // 已完成的合约
    }).orderBy('createdAt', 'desc').limit(1).get();
    if (contractRes.data && contractRes.data.length > 0) {
      const c = contractRes.data[0];
      storeId = c.storeId || '';
      storeName = c.storeName || '';
      contractId = c.contractId || '';
    }
  } catch (e) {
    console.error('匹配合约门店失败:', e);
  }

  // 查询代金券面额规则
  let amount = 20;
  let ruleId = '';
  try {
    const rulesRes = await db.collection('coupon_rules').where({ status: 1 }).get();
    const rules = rulesRes.data || [];
    for (const r of rules) {
      if (r.storeScope === 'all') { amount = r.amount || 20; ruleId = r.id || r._id || ''; break; }
      if (r.storeScope === 'bound' && storeId && r.selectedStores && r.selectedStores.includes(storeId)) {
        amount = r.amount || 20; ruleId = r.id || r._id || ''; break;
      }
    }
  } catch (e) { /* use default */ }

  // 30天有效期
  const expireAt = new Date(now);
  expireAt.setDate(expireAt.getDate() + 30);

  // 随机结算时间：在有效期内随机一个白天时间自动回传移动
  const settleRandomDays = Math.floor(Math.random() * 25) + 1; // 1~25天后
  const settleAt = new Date(now);
  settleAt.setDate(settleAt.getDate() + settleRandomDays);
  // 随机白天时间 9:00~18:00
  settleAt.setHours(9 + Math.floor(Math.random() * 9), Math.floor(Math.random() * 60), 0, 0);

  const couponData = {
    couponId: genId('CP'),
    contractId,
    openId: '',  // 用户登录绑定手机号后填充
    phone,
    storeId,
    storeName,
    amount,
    ruleId,
    status: 1,  // 生成即激活，可直接使用
    activateDate: now,
    expireAt: expireAt.toISOString(),
    usedCount: 0,
    verifyCode: '',
    verifyExpireAt: 0,
    usedAt: '',
    mobileBenefitId: mobileBenefitId || '',
    mobileOrderId: mobileOrderId || '',
    settleType: '',    // auto=自动结算, manual=用户核销
    settleAt: settleAt.toISOString(),  // 计划自动结算时间
    mobileNotifiedAt: '',
    createdAt: now,
    updatedAt: now
  };

  await db.collection('coupons').add({ data: couponData });

  return {
    code: 200,
    message: 'ok',
    data: {
      couponId: couponData.couponId,
      phone,
      storeId: storeId || null,
      storeName: storeName || null,
      amount,
      expireAt: expireAt.toISOString()
    }
  };
}

/**
 * 生成管理员扫码登录的小程序码
 */
/**
 * 管理员在小程序中确认登录（管理员打开 loginConfirm 页面后点击确认按钮）
 * 通过云函数直接调用，getWXContext() 可获取真实 OPENID
 */
async function handleAdminConfirmLogin(OPENID, event) {
  const scene = String(event.scene || '').trim();

  // 验证当前用户是否为管理员
  const { data: roles } = await db.collection('portal_roles')
    .where({
      openId: OPENID,
      roleKey: _.in(['admin', 'super_admin']),
      status: 1
    }).limit(1).get();

  if (!roles.length) {
    return { code: 403, message: '仅管理员可登录管理后台' };
  }

  // 更新登录 session 状态
  const query = scene ? { scene } : { status: 0 };
  let sessionQuery = db.collection('login_sessions').where(query);
  if (!scene) {
    sessionQuery = sessionQuery.orderBy('createdAt', 'desc');
  }
  const update = await sessionQuery.limit(1).update({
    data: { openId: OPENID, status: 1, updatedAt: Date.now() }
  });

  if (update.stats.updated === 0) {
    return { code: 404, message: '未找到待确认的登录请求' };
  }

  return { code: 200, data: { openId: OPENID } };
}

/**
 * 通过微信 getPhoneNumber 获取手机号并自动绑定角色
 * 调用方式：用户点击 getPhoneNumber 按钮 → 拿到 code → 调此接口
 */
async function handleBindPhoneByWechat(OPENID, event) {
  const code = String(event.code || '').trim();
  if (!code) {
    return { code: 400, message: '缺少微信授权 code' };
  }

  // 1. 解密手机号
  let phone = '';
  try {
    const phoneRes = await cloud.getPhoneNumber({ code });
    phone = (phoneRes.phoneInfo && phoneRes.phoneInfo.phoneNumber) || '';
  } catch (e) {
    console.error('getPhoneNumber error:', e);
    return { code: 400, message: '获取手机号失败，请重试' };
  }
  if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
    return { code: 400, message: '未获取到有效手机号' };
  }

  const now = new Date().toISOString();

  // 2. 查找该手机号的所有待绑定邀请
  const inviteRes = await db.collection('staff_invites').where({
    phone,
    status: 1,
    boundOpenId: ''
  }).get();
  const invites = inviteRes.data || [];
  if (!invites.length) {
    return { code: 404, message: '该手机号暂无待绑定角色' };
  }

  // 3. 逐一绑定角色
  const boundRoles = [];
  for (const invite of invites) {
    const roleKey = invite.roleKey;
    // 检查是否已绑定
    const existing = await db.collection('portal_roles').where({
      openId: OPENID,
      roleKey,
      scopeType: invite.scopeType,
      scopeId: invite.scopeId,
      status: 1
    }).limit(1).get();

    if (!existing.data.length) {
      await db.collection('portal_roles').add({
        data: {
          openId: OPENID,
          roleKey,
          name: invite.name || '',
          phone,
          scopeType: invite.scopeType,
          scopeId: invite.scopeId,
          scopeName: invite.scopeName || '',
          permissions: invite.permissions || [],
          status: 1,
          boundBy: 'wechat_bind',
          createdAt: now,
          updatedAt: now
        }
      });
    }

    // 标记邀请已绑定
    await db.collection('staff_invites').doc(invite._id).update({
      data: { boundOpenId: OPENID, boundAt: now, updatedAt: now }
    });

    boundRoles.push({ roleKey, scopeType: invite.scopeType, scopeName: invite.scopeName });
  }

  return { code: 200, data: { openId: OPENID, phone, roles: boundRoles } };
}

exports.main = async (event = {}) => {
  const { OPENID: WX_OPENID } = cloud.getWXContext();
  const OPENID = event._bypassOpenId || WX_OPENID;
  const action = String(event.action || '').trim();

  // 频率限制检查
  if (action) {
    const rateCheck = await checkRateLimit(OPENID, action);
    if (!rateCheck.allowed) {
      return { code: 429, message: rateCheck.message };
    }
  }

  try {
    if (action === 'updateUserProfile') return handleUpdateUserProfile(OPENID, event);
    if (action === 'getStores') return handleGetStores(event);
    if (action === 'getCurrentContractId') return handleGetCurrentContractId(OPENID);
    if (action === 'createNewContract') return handleCreateNewContract(OPENID);
    if (action === 'getContractStatus') return handleGetContractStatus(OPENID, event);
    if (action === 'submitPhone') return handleSubmitPhone(OPENID, event);
    if (action === 'submitOrderInfo') return handleSubmitOrderInfo(OPENID, event);
    if (action === 'submitSmsCode') return handleSubmitSmsCode(OPENID, event);
    if (action === 'getCoupons') return handleGetCoupons(OPENID, event);
    if (action === 'activateCoupon') return handleActivateCoupon(OPENID, event);
    if (action === 'generateVerifyCode') return handleGenerateVerifyCode(OPENID, event);
    if (action === 'storeVerifyCoupon') return handleStoreVerifyCoupon(OPENID, event);
    if (action === 'storeConfirmVerify') return handleStoreConfirmVerify(OPENID, event);
    if (action === 'getStoreVerifyRecords') return handleGetStoreVerifyRecords(OPENID, event);
    if (action === 'adminGetContracts') return handleAdminGetContracts(OPENID, event);
    if (action === 'adminUpdateStatus') return handleAdminUpdateStatus(OPENID, event);
    if (action === 'getAdminStats') return handleGetAdminStats(OPENID);
    if (action === 'adminGetStores') return handleAdminGetStores(OPENID, event);
    if (action === 'adminCreateStore') return handleAdminCreateStore(OPENID, event);
    if (action === 'adminUpdateStore') return handleAdminUpdateStore(OPENID, event);
    if (action === 'adminDeleteStore') return handleAdminDeleteStore(OPENID, event);
    if (action === 'getCouponRules') return handleGetCouponRules(OPENID);
    if (action === 'createCouponRule') return handleCreateCouponRule(OPENID, event);
    if (action === 'deleteCouponRule') return handleDeleteCouponRule(OPENID, event);
    if (action === 'queryPendingInvites') return handleQueryPendingInvites(OPENID, event);
    if (action === 'getMyStore') return handleGetMyStore(OPENID);
    if (action === 'getUserInfo') return handleGetUserInfo(OPENID, event);
    if (action === 'exportContracts') return handleExportContracts(OPENID);
    if (action === 'adminConfirmLogin') return handleAdminConfirmLogin(OPENID, event);
    if (action === 'bindPhoneAndRole') return handleBindPhoneByWechat(OPENID, event);

    return { code: 400, message: '不支持的操作类型' };
  } catch (error) {
    console.error('portalBiz 错误:', error);
    return {
      code: 500,
      message: error && error.message ? error.message : '服务异常'
    };
  }
};
