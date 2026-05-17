const cloudEnv = require('./cloud-env');

function initCloudRuntime() {
  if (!cloudEnv.USE_CLOUD) {
    return {
      enabled: false,
      mode: 'disabled',
      envId: '',
      reason: 'cloud disabled'
    };
  }

  if (typeof wx === 'undefined' || !wx.cloud) {
    return {
      enabled: false,
      mode: 'disabled',
      envId: '',
      reason: 'wx.cloud unavailable'
    };
  }

  if (!cloudEnv.CLOUD_ENV_ID) {
    return {
      enabled: false,
      mode: 'disabled',
      envId: '',
      reason: 'missing env id'
    };
  }

  try {
    wx.cloud.init({
      env: cloudEnv.CLOUD_ENV_ID,
      traceUser: cloudEnv.TRACE_USER !== false
    });

    return {
      enabled: true,
      mode: 'cloud',
      envId: cloudEnv.CLOUD_ENV_ID,
      reason: ''
    };
  } catch (error) {
    console.error('云环境初始化失败:', error);
    return {
      enabled: false,
      mode: 'disabled',
      envId: '',
      reason: error && error.message ? error.message : 'init failed'
    };
  }
}

function callCloudFunction(name, data = {}) {
  return new Promise((resolve, reject) => {
    if (typeof wx === 'undefined' || !wx.cloud) {
      reject(new Error('当前基础库不支持 wx.cloud'));
      return;
    }

    wx.cloud.callFunction({
      name,
      data,
      success: (res) => resolve(res.result || res),
      fail: (error) => reject(error)
    });
  });
}

module.exports = {
  cloudEnv,
  initCloudRuntime,
  callCloudFunction
};
