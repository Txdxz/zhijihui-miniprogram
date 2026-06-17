// pages/coupon/coupon.js - 卡包页面 V2.0
// 二维码：utils/weapp_qrcode.js（weapp-qrcode）

const { businessAPI } = require('../../utils/business-api');
const drawQrcode = require('../../utils/weapp_qrcode.js');
const ToastLib = require('@vant/weapp/toast/toast');
const Toast = ToastLib.default || ToastLib;

// 构建核销信息 JSON（用于扫码解析；二维码内容需与门店核销页 parseQRData 一致）
function buildVerifyQRData(couponId, verifyCode, storeId) {
  return JSON.stringify({
    type: 'zjh_coupon',
    couponId: couponId,
    code: verifyCode,
    store: storeId,
    time: Date.now()
  });
}

Page({
  data: {
    hasContract: false,
    coupons: [],
    totalCount: 0,
    availableCount: 0,
    usedCount: 0,

    // 核销码弹窗
    showModal: false,
    verifyCode: '',
    qrCodeData: '',       // 二维码数据
    countdown: 180,
    countdownText: '03:00',
    verifyExpireAt: 0,
    currentCoupon: null,
    regenerating: false,

    // 内存泄漏修复：倒计时定时器引用
    _countdownTimer: null,

    // 页面加载状态
    pageLoading: true,
    pageError: ''
  },

  // ==========================================
  // 生命周期
  // ==========================================

  onLoad() {
    Toast.setDefaultOptions({ selector: '#van-toast' });
    this._initPage();
  },

  async onShow() {
    await this._initPage();
    if (this.data.showModal && this.data.verifyExpireAt) {
      this._resumeCountdown();
    }
  },

  async onPullDownRefresh() {
    try {
      await this.loadCoupons();
      wx.showToast({ title: '已刷新', icon: 'success', duration: 1500 });
    } catch (error) {
      console.error('刷新失败:', error);
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async _initPage() {
    this.setData({ pageLoading: true, pageError: '' });
    try {
      await this.loadCoupons();
    } catch (error) {
      console.error('加载卡包失败:', error);
      this.setData({ pageError: '加载失败，请下拉刷新重试' });
    } finally {
      this.setData({ pageLoading: false });
    }
  },

  onHide() {
    this._stopCountdown();
  },

  onUnload() {
    // 【重要】修复内存泄漏：页面销毁时清理定时器
    this._stopCountdown();
  },

  // ==========================================
  // Toast 辅助方法
  // ==========================================

  _showToast(message, theme = 'fail') {
    if (theme === 'success') {
      wx.showToast({ title: message, icon: 'success', duration: 2000 });
    } else {
      wx.showToast({ title: message, icon: 'none', duration: 2000 });
    }
  },

  _showSuccess(message) {
    wx.showToast({ title: message, icon: 'success', duration: 2000 });
  },

  // ==========================================
  // 数据加载
  // ==========================================

  async loadCoupons() {
    try {
      const contractId = await businessAPI.getCurrentContractId();

      if (!contractId) {
        this._stopCountdown();
        this.setData({
          hasContract: false,
          coupons: [],
          totalCount: 0,
          availableCount: 0,
          usedCount: 0,
          showModal: false,
          verifyCode: '',
          qrCodeData: '',
          verifyExpireAt: 0,
          currentCoupon: null
        });
        return;
      }

      const res = await businessAPI.getCoupons(contractId);

      if (res.code === 200 && res.data && res.data.length > 0) {
        const coupons = res.data.map(c => {
          const isExpired = c.expireAt && new Date(c.expireAt) < new Date();
          return {
            ...c,
            statusClass: this._getStatusClass(c.status, isExpired),
            activateDate: this._formatDate(c.activateDate).split(' ')[0],
            expireDate: c.expireAt ? this._formatDate(c.expireAt).split(' ')[0] : '',
            usedAt: c.usedAt ? this._formatDate(c.usedAt) : '',
            amountText: c.amount ? `¥${c.amount}` : '¥20'
          };
        });

        this.setData({
          hasContract: true,
          coupons,
          totalCount: coupons.length,
          availableCount: coupons.filter(c => c.status === 1).length,
          usedCount: coupons.filter(c => c.status === 2).length
        });
      } else {
        this.setData({
          hasContract: false,
          coupons: [],
          totalCount: 0,
          availableCount: 0,
          usedCount: 0
        });
      }
    } catch (e) {
      console.error('加载代金券失败:', e);
      this.setData({
        hasContract: false,
        coupons: [],
        totalCount: 0,
        availableCount: 0,
        usedCount: 0
      });
    }
  },

  _getStatusClass(status, isExpired = false) {
    if (status === 0) return 'pending';
    if (status === 1) return 'available';
    if (status === 2) return 'used';
    if (status === 3) return 'expired';
    return 'pending';
  },

  _formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  },

  _formatCountdown(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  },

  // ==========================================
  // 页面跳转
  // ==========================================

  goToIndex() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  // ==========================================
  // 核销码弹窗
  // ==========================================

  async showVerifyCode(e) {
    const couponId = e.currentTarget.dataset.id;
    const coupon = this.data.coupons.find(c => c.id === couponId);

    if (!coupon || coupon.status !== 1) {
      this._showToast('该券不可使用');
      return;
    }

    // 停止之前的倒计时
    this._stopCountdown();

    try {
      wx.showLoading({ title: '生成中...', mask: true });
      const res = await businessAPI.generateVerifyCode(couponId);

      if (res.code === 200) {
        // 构建二维码数据
        const qrData = buildVerifyQRData(couponId, res.data.verifyCode, coupon.storeId);

        this.setData({
          showModal: true,
          verifyCode: res.data.verifyCode,
          qrCodeData: qrData,
          countdown: this._getRemainingSeconds(res.data.expireAt),
          countdownText: this._formatCountdown(this._getRemainingSeconds(res.data.expireAt)),
          verifyExpireAt: res.data.expireAt,
          currentCoupon: coupon
        }, () => {
          setTimeout(() => this._generateQRCodeImage(qrData), 80);
        });

        this._startCountdown(res.data.expireAt);
      } else {
        this._showToast(res.message || '生成核销码失败');
      }
    } catch (error) {
      console.error('showVerifyCode 错误:', error);
      this._showToast('网络异常，请重试');
    } finally {
      wx.hideLoading();
    }
  },

  /**
   * 在 canvas 上绘制二维码（内容为 JSON，与门店扫码解析一致）
   * @param {string} text - 二维码字符串（通常为 buildVerifyQRData 结果）
   */
  _generateQRCodeImage(text) {
    const size = 200;
    drawQrcode({
      width: size,
      height: size,
      canvasId: 'qrcode-canvas',
      text: text || ''
    });
  },

  hideModal() {
    this._stopCountdown();
    this.setData({
      showModal: false,
      qrCodeData: '',
      verifyExpireAt: 0
    });
  },

  preventBubble() {},

  async regenerateCode() {
    if (this.data.regenerating || !this.data.currentCoupon) return;

    this.setData({ regenerating: true });

    try {
      const couponId = this.data.currentCoupon.id;
      const res = await businessAPI.generateVerifyCode(couponId);

      if (res.code === 200) {
        const qrData = buildVerifyQRData(couponId, res.data.verifyCode, this.data.currentCoupon.storeId);

        this.setData({
          verifyCode: res.data.verifyCode,
          qrCodeData: qrData,
          countdown: this._getRemainingSeconds(res.data.expireAt),
          countdownText: this._formatCountdown(this._getRemainingSeconds(res.data.expireAt)),
          verifyExpireAt: res.data.expireAt
        }, () => {
          setTimeout(() => this._generateQRCodeImage(qrData), 80);
        });

        this._startCountdown(res.data.expireAt);
        this._showSuccess('已刷新核销码');
      } else {
        this._showToast(res.message || '刷新失败');
      }
    } catch (error) {
      console.error('regenerateCode 错误:', error);
      this._showToast('网络异常');
    } finally {
      this.setData({ regenerating: false });
    }
  },

  // ==========================================
  // 倒计时（防内存泄漏）
  // ==========================================

  _getRemainingSeconds(expireAt) {
    if (!expireAt) return 0;
    return Math.max(0, Math.ceil((expireAt - Date.now()) / 1000));
  },

  _resumeCountdown() {
    const remaining = this._getRemainingSeconds(this.data.verifyExpireAt);
    if (remaining <= 0) {
      this._expireVerifyCode();
      return;
    }

    this.setData({
      countdown: remaining,
      countdownText: this._formatCountdown(remaining)
    });
    this._startCountdown(this.data.verifyExpireAt);
  },

  _expireVerifyCode() {
    this._stopCountdown();
    this.setData({
      verifyCode: '已过期',
      qrCodeData: '',
      countdown: 0,
      countdownText: '00:00',
      verifyExpireAt: 0
    });
  },

  _startCountdown(expireAt = this.data.verifyExpireAt) {
    // 先停止现有定时器
    this._stopCountdown();

    if (!expireAt) return;

    const updateCountdown = () => {
      const remaining = this._getRemainingSeconds(expireAt);
      if (remaining <= 0) {
        this._expireVerifyCode();
        Toast({ message: '核销码已过期，请重新生成', duration: 2500 });
        return false;
      }

      this.setData({
        countdown: remaining,
        countdownText: this._formatCountdown(remaining)
      });
      return true;
    };

    if (!updateCountdown()) {
      return;
    }

    this._countdownTimer = setInterval(() => {
      updateCountdown();
    }, 1000);
  },

  _stopCountdown() {
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer);
      this._countdownTimer = null;
    }
  },

  // ==========================================
  // 复制核销码
  // ==========================================

  copyVerifyCode() {
    if (!this.data.verifyCode || this.data.verifyCode === '已过期') {
      this._showToast('核销码已过期');
      return;
    }

    wx.setClipboardData({
      data: this.data.verifyCode,
      success: () => {
        this._showSuccess('已复制核销码');
      },
      fail: () => {
        this._showToast('复制失败');
      }
    });
  }
});
