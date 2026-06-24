/**
 * 世纪恒通荟采平台对接配置
 * 注意：此配置需与 mobileIntegration/config.js 保持一致
 */

module.exports = {
  // 智机惠提供，分享给世纪恒通（用于接口签名）
  appId: 'zjh_appid_001',
  appSecret: 'zjh_secret_2026',

  // 世纪恒通提供（用于3DES加解密），待世纪恒通提供后替换
  desKey: '',

  // 世纪恒通API域名（回调用），待世纪恒通提供后替换
  hengtongApiBase: '',
};
