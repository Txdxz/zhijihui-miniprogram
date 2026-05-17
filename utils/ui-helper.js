/**
 * UI 工具函数 - 统一的加载状态、错误提示、空状态处理
 */
const ToastLib = require('@vant/weapp/toast/toast');

const Toast = (function() {
  try {
    return ToastLib.default || ToastLib;
  } catch (e) {
    return {
      success(opts) { wx.showToast({ title: typeof opts === 'string' ? opts : (opts.message || '成功'), icon: 'success', duration: 2000 }); },
      fail(opts) { wx.showToast({ title: typeof opts === 'string' ? opts : (opts.message || '失败'), icon: 'none', duration: 2000 }); },
      loading(opts) { wx.showLoading({ title: typeof opts === 'string' ? opts : (opts.message || '加载中...'), mask: true }); }
    };
  }
})();

/**
 * 初始化 Toast（在页面 onLoad 中调用）
 */
function initToast(selector) {
  try {
    Toast.setDefaultOptions({ selector: selector || '#van-toast' });
  } catch (e) {}
}

/**
 * 显示成功提示
 */
function showSuccess(message) {
  wx.showToast({ title: message, icon: 'success', duration: 2000 });
}

/**
 * 显示失败提示
 */
function showFail(message) {
  wx.showToast({ title: message, icon: 'none', duration: 2500 });
}

/**
 * 显示网络异常提示
 */
function showNetworkError() {
  wx.showToast({ title: '网络异常，请检查网络后重试', icon: 'none', duration: 2500 });
}

/**
 * 带重试的异步操作包装器
 * @param {Function} fn - 异步操作函数
 * @param {Object} context - 页面 this 上下文（可选，用于 setData）
 * @param {string} loadingKey - data 中的 loading 字段名（可选）
 * @returns {Promise<{success, data?, error?}>}
 */
async function withLoading(fn, context, loadingKey = 'loading') {
  if (context && loadingKey) {
    context.setData({ [loadingKey]: true });
  } else {
    wx.showLoading({ title: '加载中...', mask: true });
  }

  try {
    const result = await fn();
    return { success: true, data: result };
  } catch (error) {
    console.error('[withLoading] 错误:', error);
    const message = (error && error.message) || '操作失败';
    showNetworkError();
    return { success: false, error: message };
  } finally {
    if (context && loadingKey) {
      context.setData({ [loadingKey]: false });
    } else {
      wx.hideLoading();
    }
  }
}

/**
 * 显示确认对话框
 */
function showConfirm({ title, content, confirmText = '确定', cancelText = '取消', confirmColor = '#FF4D4F' }) {
  return new Promise(resolve => {
    wx.showModal({
      title,
      content,
      confirmColor,
      cancelText,
      confirmText,
      success: res => resolve(res.confirm)
    });
  });
}

module.exports = {
  initToast,
  showSuccess,
  showFail,
  showNetworkError,
  withLoading,
  showConfirm,
  Toast
};
