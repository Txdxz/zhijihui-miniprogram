/**
 * notifyRetry - 世纪恒通回传补推定时任务
 *
 * 用途：定时扫描已核销/已自动结算但未成功回传世纪恒通的券，
 *       重新调用回传逻辑，满足API文档2.2节"状态补推"要求。
 *
 * 触发方式：微信云开发定时触发器，建议每30分钟执行一次
 *           cron: 0 */30 * * * * *
 *
 * 扫描条件：
 *   - settleType 为 'auto' 或 'manual'（已结算）
 *   - mobileNotifiedAt 为空或不存在（未成功回传）
 *   - notifyUrl 不为空（有回传地址）
 *   - 每次最多处理 50 条
 */

const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const https = require('https');
const config = require('./config');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// ============================================================
// 工具函数（与 mobileIntegration 保持一致）
// ============================================================

function nowISO() {
  return new Date().toISOString();
}

function formatDateTime(dateLike) {
  const d = new Date(dateLike);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function generateSign(params, appId, traceId, timestamp, nonceStr, appSecret) {
  const sortedKeys = Object.keys(params).sort();
  let paramsStr = '';
  for (const key of sortedKeys) {
    const val = params[key];
    if (val === '' || val === null || val === undefined) continue;
    if (typeof val === 'object') {
      paramsStr += key + JSON.stringify(val);
    } else {
      paramsStr += key + String(val);
    }
  }
  const signStr = appId + traceId + timestamp + nonceStr + paramsStr + appSecret;
  return crypto.createHash('md5').update(signStr, 'utf8').digest('hex');
}

function encrypt3DES(text, key) {
  if (!key) return text;
  const keyBuf = Buffer.from(key, 'utf8');
  const cipher = crypto.createCipheriv('des-ede3', keyBuf, Buffer.alloc(0));
  cipher.setAutoPadding(true);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return encrypted.toString('hex');
}

// ============================================================
// 单次回传（不含重试）
// ============================================================

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

  const traceId = crypto.randomBytes(16).toString('hex');
  const timestamp = String(Date.now());
  const nonceStr = String(Math.floor(Math.random() * 1e10)).padStart(10, '0');
  const sign = generateSign(body, config.appId, traceId, timestamp, nonceStr, config.appSecret);

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
        if (res.statusCode === 200) {
          resolve({ success: true });
        } else {
          resolve({ success: false, statusCode: res.statusCode, data });
        }
      });
    });

    req.on('error', (e) => {
      resolve({ success: false, error: e.message });
    });

    req.write(postData);
    req.end();
  });
}

// ============================================================
// 带重试的回传
// ============================================================

async function notifyWithRetry(coupon, settleType) {
  const maxRetries = 2; // 补推任务重试次数较少，避免单次执行时间过长
  const retryDelays = [2000, 4000];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await _doNotifyOnce(coupon, settleType);
    if (result.success) {
      await db.collection('coupons').doc(coupon._id).update({
        data: { mobileNotifiedAt: nowISO() }
      }).catch(() => {});
      return { success: true, couponId: coupon.couponId, attempts: attempt + 1 };
    }

    if (attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]));
    }
  }

  return { success: false, couponId: coupon.couponId, reason: 'max_retries_exceeded' };
}

// ============================================================
// 云函数入口
// ============================================================

exports.main = async (event, context) => {
  console.log('[notifyRetry] 开始扫描未成功回传的券...');

  // 查询已结算但未成功回传的券
  const res = await db.collection('coupons').where({
    settleType: _.in(['auto', 'manual']),
    mobileNotifiedAt: _.or(_.eq(''), _.exists(false)),
    notifyUrl: _.neq('').and(_.exists(true))
  }).limit(50).get();

  console.log('[notifyRetry] 待补推券数量:', res.data.length);

  const results = [];
  for (const coupon of res.data) {
    const result = await notifyWithRetry(coupon, coupon.settleType).catch(err => {
      console.error('[notifyRetry] 补推异常:', coupon.couponId, err);
      return { success: false, couponId: coupon.couponId, error: err.message };
    });
    results.push(result);
    console.log('[notifyRetry] 补推结果:', result);
  }

  const summary = {
    scanned: res.data.length,
    success: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    timestamp: nowISO()
  };

  console.log('[notifyRetry] 执行完成:', summary);
  return summary;
};
