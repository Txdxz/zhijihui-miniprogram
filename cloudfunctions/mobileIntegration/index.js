/**
 * 世纪恒通荟采平台权益接入 API
 *
 * 接口清单：
 *   1. /order/create  — 世纪恒通调用，创建权益充值订单（生成代金券）
 *   2. /order/query   — 世纪恒通调用，查询订单详情
 *
 * 鉴权方式：appId + appSecret + MD5签名
 * 加密方式：3DES-ECB/PKCS5Padding
 *
 * 角色定义：
 *   服务提供方 = 智机惠（我们）
 *   接入方     = 世纪恒通
 */

const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const https = require('https');
const config = require('./config');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 合约状态（与 portalBiz 保持一致）
const STATES = {
  REJECTED: 0,
  WAIT_VERIFY: 1,
  QUALIFIED: 2,
  WAIT_SMSCODE: 3,
  CONTRACTING: 4,
  CONTRACT_OK: 5,
  SHIPPED: 6,
  SIGNED: 7,
  SMS_CODE_REJECTED: 8
};

// ============================================================
// 工具函数
// ============================================================

function nowISO() {
  return new Date().toISOString();
}

function genId(prefix) {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

/**
 * 格式化时间为 yyyy-MM-dd HH:mm:ss（世纪恒通API要求的时间格式）
 */
function formatDateTime(dateLike) {
  const d = new Date(dateLike);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 计算当月最后一天 23:59:59.999
 * 规则：代金券自领取到账之日起当月有效
 */
function getEndOfMonth() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1, 0); // 下个月的第0天 = 当月最后一天
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * 生成随机结算时间：1~25天内的随机白天时间（9:00~18:00）
 */
function getRandomSettleTime() {
  const now = new Date();
  const days = Math.floor(Math.random() * 25) + 1;
  now.setDate(now.getDate() + days);
  now.setHours(9 + Math.floor(Math.random() * 9), Math.floor(Math.random() * 60), 0, 0);
  return now;
}

// ============================================================
// 签名 & 加解密
// ============================================================

/**
 * 生成签名（MD5 32位小写）
 * 算法：appId + traceId + timestamp + nonceStr + 业务参数(字典排序) + appSecret
 */
function generateSign(params, appId, traceId, timestamp, nonceStr, appSecret) {
  const sortedKeys = Object.keys(params).sort();
  let paramStr = '';
  for (const key of sortedKeys) {
    const val = params[key];
    if (val !== '' && val !== null && val !== undefined) {
      paramStr += key + val;
    }
  }
  const signStr = appId + traceId + timestamp + nonceStr + paramStr + appSecret;
  return crypto.createHash('md5').update(signStr, 'utf8').digest('hex');
}

/**
 * 验证签名
 */
function verifySign(params, headers) {
  const { appId, traceId, timestamp, nonceStr, sign } = headers;
  if (!appId || !traceId || !timestamp || !nonceStr || !sign) return false;
  if (appId !== config.appId) return false;
  const expectedSign = generateSign(params, appId, traceId, timestamp, nonceStr, config.appSecret);
  return expectedSign === sign;
}

/**
 * 3DES-ECB 加密（PKCS5Padding，输出hex）
 */
function encrypt3DES(plaintext, key) {
  if (!key) return plaintext; // 未配置密钥时明文传输（仅开发阶段）
  const cipher = crypto.createCipheriv('des-ede3', Buffer.from(key, 'utf8'), null);
  cipher.setAutoPadding(true);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

/**
 * 3DES-ECB 解密
 */
function decrypt3DES(ciphertext, key) {
  if (!key) return ciphertext; // 未配置密钥时明文传输（仅开发阶段）
  const decipher = crypto.createDecipheriv('des-ede3', Buffer.from(key, 'utf8'), null);
  decipher.setAutoPadding(true);
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ============================================================
// HTTP 响应工具
// ============================================================

function jsonResponse(code, msg, data) {
  return {
    code,
    msg,
    data: data || null
  };
}

function encryptResponse(obj) {
  const plaintext = JSON.stringify(obj);
  const ciphertext = encrypt3DES(plaintext, config.desKey);
  return { ciphertext };
}

// ============================================================
// /order/create — 创建权益充值订单
// ============================================================

async function handleCreateOrder(body, headers) {
  // 验证签名
  if (!verifySign(body, headers)) {
    return jsonResponse(401, '签名验证失败');
  }

  const { orderNo, rechargeAccount, skuId, notifyUrl, expandData, number } = body;

  if (!orderNo || !rechargeAccount) {
    return jsonResponse(400, '缺少必填参数 orderNo 或 rechargeAccount');
  }

  // 幂等检查：按 orderNo 查重
  const existRes = await db.collection('coupons').where({
    hengtongOrderNo: orderNo
  }).limit(1).get();

  if (existRes.data && existRes.data.length > 0) {
    // 已存在，返回已有订单信息
    const existing = existRes.data[0];
    const expireAt = existing.expireAt || '';
    return jsonResponse(200, '成功', {
      orderNo,
      spOrderNo: existing.couponId,
      rechargeStatus: 1,
      cards: [{
        cardNo: existing.couponId,
        cardPassword: '',
        cardDeadline: formatDateTime(expireAt)
      }]
    });
  }

  const now = nowISO();
  const phone = rechargeAccount;

  // 按手机号匹配最近合约，获取门店信息
  let storeId = '';
  let storeName = '';
  let contractId = '';
  try {
    const contractRes = await db.collection('contracts').where({
      phone,
      status: _.gte(STATES.CONTRACT_OK)
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

  // 有效期：当月最后一天 23:59:59
  const expireAt = getEndOfMonth();

  // 随机结算时间
  const settleAt = getRandomSettleTime();

  const couponId = genId('CP');

  const couponData = {
    couponId,
    contractId,
    openId: '',
    phone,
    storeId,
    storeName,
    amount,
    ruleId,
    status: 1,  // 生成即激活
    activateDate: now,
    expireAt: expireAt.toISOString(),
    usedCount: 0,
    verifyCode: '',
    verifyExpireAt: 0,
    usedAt: '',
    // 世纪恒通对接字段
    hengtongOrderNo: orderNo,
    notifyUrl: notifyUrl || '',
    expandData: expandData || '',
    skuId: skuId || '',
    cardNo: couponId,
    // 兼容字段
    mobileBenefitId: '',
    mobileOrderId: orderNo,
    // 结算字段
    settleType: '',
    settleAt: settleAt.toISOString(),
    mobileNotifiedAt: '',
    createdAt: now,
    updatedAt: now
  };

  await db.collection('coupons').add({ data: couponData });

  return jsonResponse(200, '成功', {
    orderNo,
    spOrderNo: couponId,
    rechargeStatus: 1,
    cards: [{
      cardNo: couponId,
      cardPassword: '',
      cardDeadline: formatDateTime(expireAt)
    }]
  });
}

// ============================================================
// /order/query — 订单详情查询
// ============================================================

async function handleQueryOrder(body, headers) {
  if (!verifySign(body, headers)) {
    return jsonResponse(401, '签名验证失败');
  }

  const { spOrderNo, orderNo } = body;
  if (!spOrderNo && !orderNo) {
    return jsonResponse(400, '缺少参数 spOrderNo 或 orderNo');
  }

  // 按 couponId 或 hengtongOrderNo 查询
  let query = {};
  if (spOrderNo) query.couponId = spOrderNo;
  else query.hengtongOrderNo = orderNo;

  const res = await db.collection('coupons').where(query).limit(1).get();
  if (!res.data || res.data.length === 0) {
    return jsonResponse(404, '订单不存在');
  }

  const c = res.data[0];
  const verifyStatus = c.status === 2 ? 1 : 0;

  return jsonResponse(200, '查询成功', {
    orderNo: c.hengtongOrderNo || c.mobileOrderId || '',
    spOrderNo: c.couponId,
    rechargeAccount: c.phone,
    rechargeStatus: 1,
    orderCreateTime: c.createdAt ? formatDateTime(c.createdAt) : '',
    rechargeCompleteTime: c.activateDate ? formatDateTime(c.activateDate) : '',
    rechargeFailMessage: '',
    expandData: c.expandData || '',
    cards: [{
      cardNo: c.couponId,
      cardPassword: '',
      cardDeadline: c.expireAt ? formatDateTime(c.expireAt) : '',
      verifyStatus,
      verifyTime: c.usedAt ? formatDateTime(c.usedAt) : ''
    }]
  });
}

// ============================================================
// 回调世纪恒通 notifyUrl（核销状态回传）
// ============================================================

/**
 * 单次回传核销状态给世纪恒通（不含重试）
 * @param {Object} coupon - 代金券记录
 * @param {string} settleType - 'auto' | 'manual'
 * @returns {Promise<{success: boolean, statusCode?: number, error?: string, data?: string}>}
 */
async function _doNotifyOnce(coupon, settleType) {
  const verifyStatus = 1;
  const verifyTime = settleType === 'manual' ? (coupon.usedAt || nowISO()) : nowISO();

  const body = {
    orderNo: coupon.hengtongOrderNo || coupon.mobileOrderId || '',
    spOrderNo: coupon.couponId,
    rechargeAccount: coupon.phone,
    rechargeStatus: 1,
    orderCreateTime: coupon.createdAt ? formatDateTime(coupon.createdAt) : '',
    rechargeCompleteTime: coupon.activateDate ? formatDateTime(coupon.activateDate) : '',
    expandData: coupon.expandData || '',
    cards: [{
      cardNo: coupon.couponId,
      cardPassword: '',
      cardDeadline: coupon.expireAt ? formatDateTime(coupon.expireAt) : '',
      verifyStatus,
      verifyTime: formatDateTime(verifyTime)
    }]
  };

  // 生成签名
  const traceId = crypto.randomBytes(16).toString('hex');
  const timestamp = String(Date.now());
  const nonceStr = String(Math.floor(Math.random() * 1e10)).padStart(10, '0');
  const sign = generateSign(body, config.appId, traceId, timestamp, nonceStr, config.appSecret);

  // 加密请求体
  const encryptedBody = encrypt3DES(JSON.stringify(body), config.desKey);
  const postData = JSON.stringify({ ciphertext: encryptedBody });

  return new Promise((resolve) => {
    const url = new URL(coupon.notifyUrl);
    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'appId': config.appId,
        'traceId': traceId,
        'timestamp': timestamp,
        'nonceStr': nonceStr,
        'sign': sign
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        console.log('世纪恒通回传响应:', res.statusCode, data);
        if (res.statusCode === 200) {
          resolve({ success: true });
        } else {
          resolve({ success: false, statusCode: res.statusCode, data });
        }
      });
    });

    req.on('error', (e) => {
      console.error('回传世纪恒通单次请求失败:', e.message);
      resolve({ success: false, error: e.message });
    });

    req.write(postData);
    req.end();
  });
}

/**
 * 回传核销状态给世纪恒通（含重试机制）
 * API文档2.2节要求：服务提供方需支持在通知失败时进行状态补推
 * 重试策略：最多3次重试，间隔1秒/3秒/5秒
 * @param {Object} coupon - 代金券记录
 * @param {string} settleType - 'auto' | 'manual'
 */
async function notifyHengtongSettle(coupon, settleType = 'auto') {
  if (!coupon.notifyUrl) {
    console.log('无notifyUrl，跳过回传:', coupon.couponId);
    return { success: false, reason: 'no_notify_url' };
  }

  const maxRetries = 3;
  const retryDelays = [1000, 3000, 5000]; // 1秒、3秒、5秒

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await _doNotifyOnce(coupon, settleType);
    if (result.success) {
      // 成功，更新回传时间
      await db.collection('coupons').doc(coupon._id).update({
        data: { mobileNotifiedAt: nowISO() }
      }).catch(() => {});
      console.log('回传世纪恒通成功:', coupon.couponId, '第', attempt + 1, '次');
      return result;
    }

    console.warn(`回传世纪恒通第${attempt + 1}次失败:`, result.error || result.statusCode);

    if (attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]));
    }
  }

  console.error('回传世纪恒通最终失败，需人工排查或等待定时补推:', coupon.couponId);
  return { success: false, reason: 'max_retries_exceeded' };
}

// ============================================================
// 云函数入口
// ============================================================

exports.main = async (event, context) => {
  // HTTP 触发模式：event 包含 headers, body, httpMethod, path
  // 云函数调用模式：event 包直接是业务参数

  const httpMethod = event.httpMethod || 'POST';
  const path = event.path || '/order/create';
  const headers = event.headers || {};
  const body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || event);

  // 如果是加密请求，先解密
  let businessParams = body;
  if (body.ciphertext) {
    try {
      const decrypted = decrypt3DES(body.ciphertext, config.desKey);
      businessParams = JSON.parse(decrypted);
    } catch (e) {
      return encryptResponse(jsonResponse(400, '解密失败'));
    }
  }

  // 路由分发
  let result;
  if (path.includes('/order/create')) {
    result = await handleCreateOrder(businessParams, headers);
  } else if (path.includes('/order/query')) {
    result = await handleQueryOrder(businessParams, headers);
  } else {
    result = jsonResponse(404, '接口不存在');
  }

  // 加密响应
  return encryptResponse(result);
};

// 导出供 portalBiz 调用
exports.notifyHengtongSettle = notifyHengtongSettle;
