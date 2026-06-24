// pages/store/verify.js - 门店核销页面 V2.0
// 核心改进：
// 1. async/await 重构
// 2. 原生扫码 API 接入（一键扫码核销）
// 3. 防抖机制
// 4. 数字码手动输入保留（备用）

const { businessAPI } = require('../../utils/business-api');
const ToastLib = require('@vant/weapp/toast/toast');
const Toast = ToastLib.default || ToastLib;
const DialogLib = require('@vant/weapp/dialog/dialog');
const Dialog = DialogLib.default || DialogLib;

// 解析二维码数据
function parseQRData(qrContent) {
  try {
    // 尝试解析 JSON 格式
    const data = JSON.parse(qrContent);
    if (data.type === 'zjh_coupon' && data.couponId && data.code) {
      return {
        valid: true,
        couponId: data.couponId,
        verifyCode: data.code,
        storeId: data.store || null
      };
    }
  } catch (e) {
    // 非 JSON 格式，可能是纯数字码
  }

  // 纯数字码格式（6位数字）
  if (/^\d{6}$/.test(qrContent)) {
    return {
      valid: true,
      verifyCode: qrContent,
      couponId: null,
      storeId: null
    };
  }

  return { valid: false };
}

Page({
  data: {
    currentStore: {
      id: '',
      name: '',
      address: ''
    },

    // van-tabs 当前下标：0 扫一扫 / 1 手动输入
    scanTabIndex: 0,
    scanMode: true,

    // ===== 手动输入 =====
    verifyCode: '',
    verifyError: '',
    showConfirm: false,
    showSuccess: false,
    confirmInfo: null,

    // ===== 核销记录（按月归集） =====
    recordsByMonth: [],
    todayTotal: 0,

    // ===== Loading 状态 =====
    querying: false,
    verifying: false,
    pageLoading: true,
    pageError: ''
  },

  // ==========================================
  // 导航方法
  // ==========================================

  navigateBack() {
    wx.navigateBack({
      fail: () => {
        wx.reLaunch({ url: '/pages/launch/index' });
      }
    });
  },

  // ==========================================
  // 生命周期
  // ==========================================

  onLoad(options) {
    Toast.setDefaultOptions({ selector: '#van-toast' });
    Dialog.setDefaultOptions({ selector: '#van-dialog' });
    this._initPage(options);
  },

  async onPullDownRefresh() {
    try {
      await this.loadRecords();
      wx.showToast({ title: '已刷新', icon: 'success', duration: 1500 });
    } catch (error) {
      console.error('刷新失败:', error);
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async _initPage(options) {
    this.setData({ pageLoading: true, pageError: '' });
    try {
      const app = getApp();
      const currentStore = app.globalData.currentStore || {};
      const storeId = options.storeId || currentStore.id || '';

      if (storeId) {
        await this._loadStore(storeId);
      } else {
        await this._loadStoreFromRole();
      }
    } catch (error) {
      console.error('门店页初始化失败:', error);
      this.setData({ pageError: '加载失败，请下拉刷新重试' });
    } finally {
      this.setData({ pageLoading: false });
    }
  },

  async _loadStoreFromRole() {
    try {
      const { callCloudFunction } = require('../../utils/cloud');

      // 方案1：直接查询用户角色获取门店ID
      const roleRes = await callCloudFunction('portalBiz', { action: 'getMyStore' });
      // console.log('getMyStore 返回:', roleRes);

      if (roleRes.code === 200 && roleRes.data && roleRes.data.storeId) {
        this._loadStore(roleRes.data.storeId);
        return;
      }

      // 方案2：通过 resolveLaunchContext 获取
      const res = await callCloudFunction('resolveLaunchContext', {});
      // console.log('resolveLaunchContext 返回:', JSON.stringify(res, null, 2));

      if (res.code === 200 && res.data) {
        const target = res.data.target;
        if (target && target.storeId) {
          this._loadStore(target.storeId);
          return;
        }
      }

      // 没有找到门店，显示未分配
      this.setData({
        currentStore: {
          id: '',
          name: '',
          address: ''
        }
      });
    } catch (e) {
      console.error('_loadStoreFromRole 失败:', e);
      this.setData({
        currentStore: {
          id: '',
          name: '',
          address: ''
        }
      });
    }
  },

  onShow() {
    const app = getApp();
    const currentStore = app.globalData.currentStore || {};
    const currentStoreId = (this.data.currentStore && this.data.currentStore.id) || '';

    if (currentStore.id && currentStore.id !== currentStoreId) {
      this._loadStore(currentStore.id);
      return;
    }

    this.loadRecords();
  },

  // ==========================================
  // Toast/Dialog 辅助方法
  // ==========================================

  _showToast(message) {
    wx.showToast({ title: message, icon: 'none', duration: 2000 });
  },

  _showSuccess(message) {
    wx.showToast({ title: message, icon: 'success', duration: 2000 });
  },

  _ensureStoreBound() {
    if (this.data.currentStore && this.data.currentStore.id) {
      return true;
    }
    this._showToast('当前账号未分配门店权限，请联系超级管理员配置后重新登录');
    return false;
  },

  _confirmDialog({
    title = '确认操作',
    content = '',
    confirmText = '确定',
    cancelText = '取消',
    confirmColor = '#ee0a24'
  }) {
    return Dialog.confirm({
      title,
      message: content,
      confirmButtonText: confirmText,
      cancelButtonText: cancelText,
      confirmButtonColor: confirmColor
    })
      .then(() => true)
      .catch(() => false);
  },

  onScanTabChange(e) {
    const idx = e.detail.index;
    const scanMode = idx === 0;
    this.setData({
      scanTabIndex: idx,
      scanMode,
      verifyError: '',
      showConfirm: false,
      showSuccess: false,
      verifyCode: scanMode ? '' : this.data.verifyCode
    });
  },

  // ==========================================
  // 门店加载
  // ==========================================

  async _loadStore(storeId) {
    try {
      // 优先使用 getMyStore 云函数直接获取
      const { callCloudFunction } = require('../../utils/cloud');
      const myStoreRes = await callCloudFunction('portalBiz', { action: 'getMyStore' });

      if (myStoreRes.code === 200 && myStoreRes.data) {
        const store = myStoreRes.data;
        this.setData({
          currentStore: {
            id: store.storeId,
            name: store.name,
            address: store.address || `${store.province || ''}${store.city || ''}${store.district || ''}`
          }
        }, () => {
          // 保存到全局
          const app = getApp();
          app.globalData.currentStore = this.data.currentStore;
          this.loadRecords();
        });
        return;
      }

      // 降级：从门店列表中查找
      const res = await businessAPI.getStores();
      const stores = (res && res.code === 200 && Array.isArray(res.data)) ? res.data : [];
      const store = stores.find(s => (s.id || s.storeId) === storeId);
      if (store) {
        this.setData({ currentStore: store }, () => {
          const app = getApp();
          app.globalData.currentStore = store;
          this.loadRecords();
        });
        return;
      }

      this.setData({
        currentStore: {
          id: '',
          name: '',
          address: ''
        }
      }, () => {
        this.loadRecords();
      });
    } catch (e) {
      console.error('_loadStore 错误:', e);
      this.setData({
        currentStore: {
          id: '',
          name: '',
          address: ''
        }
      });
    }
  },

  // ==========================================
  // 扫码核销（主入口）
  // ==========================================

  scanQRCode() {
    if (this.data.verifying || this.data.querying) {
      return;
    }
    if (!this._ensureStoreBound()) {
      return;
    }

    wx.scanCode({
      onlyFromCamera: true,
      scanType: ['qrCode', 'barCode'],
      success: (res) => {
        // console.log('扫码结果:', res);
        this._handleScanResult(res.result || res.code);
      },
      fail: (err) => {
        console.error('扫码失败:', err);
        if (err.errMsg && err.errMsg.includes('cancel')) {
          return;
        }
        this._showToast('扫码失败，请重试');
      }
    });
  },

  async _handleScanResult(content) {
    if (!content) {
      this._showToast('扫码内容为空');
      return;
    }

    const parsed = parseQRData(content);

    if (!parsed.valid) {
      this._showToast('无效的核销码');
      return;
    }

    const verifyCode = parsed.verifyCode;

    if (parsed.storeId && parsed.storeId !== this.data.currentStore.id) {
      const confirmed = await this._confirmDialog({
        title: '门店不匹配',
        content: '该券不属于当前门店，是否继续核销？',
        confirmText: '继续核销',
        confirmColor: '#FAAD14'
      });
      if (!confirmed) return;
    }

    await this._queryAndConfirm(verifyCode);
  },

  // ==========================================
  // 手动输入模式
  // ==========================================

  onCodeInput(e) {
    const raw = typeof e.detail === 'string' ? e.detail : (e.detail && e.detail.value) || '';
    const value = String(raw).replace(/\D/g, '').slice(0, 6);
    this.setData({
      verifyCode: value,
      verifyError: '',
      showConfirm: false,
      showSuccess: false
    });
  },

  async queryCode() {
    if (this.data.querying) return;
    if (!this._ensureStoreBound()) return;

    const verifyCode = this.data.verifyCode;

    if (!verifyCode || verifyCode.length < 6) {
      this.setData({ verifyError: '请输入6位核销码' });
      return;
    }

    await this._queryAndConfirm(verifyCode);
  },

  // ==========================================
  // 核销流程（核心）
  // ==========================================

  async _queryAndConfirm(verifyCode) {
    if (!this._ensureStoreBound()) {
      return;
    }

    this.setData({ querying: true, verifyError: '' });

    try {
      const res = await businessAPI.storeVerifyCoupon(verifyCode, this.data.currentStore.id);

      if (res.code === 200) {
        this.setData({
          showConfirm: true,
          confirmInfo: res.data,
          verifyCode: verifyCode
        });
      } else {
        this.setData({ verifyError: res.message || '核销码无效' });
      }
    } catch (error) {
      console.error('_queryAndConfirm 错误:', error);
      this._showToast('网络异常，请重试');
    } finally {
      this.setData({ querying: false });
    }
  },

  async confirmVerify() {
    if (this.data.verifying || !this.data.confirmInfo) return;

    this.setData({ verifying: true });

    try {
      const res = await businessAPI.storeConfirmVerify(this.data.confirmInfo.couponId, this.data.verifyCode);

      if (res.code === 200) {
        // 更新确认信息，包含剩余次数
        const updatedInfo = {
          ...this.data.confirmInfo,
          usedTimes: res.data.usedTimes || 1,
          monthlyLimit: res.data.monthlyLimit || 1,
          remainingTimes: (res.data.monthlyLimit || 1) - (res.data.usedTimes || 1),
          isMonthlyUsedUp: res.data.status === 2
        };

        this.setData({
          showConfirm: false,
          showSuccess: true,
          confirmInfo: updatedInfo
        });
        this._showSuccess('核销成功');
        setTimeout(() => {
          this.loadRecords();
        }, 600);
      } else {
        this._showToast(res.message || '核销失败');
      }
    } catch (error) {
      console.error('confirmVerify 错误:', error);
      this._showToast('网络异常');
    } finally {
      this.setData({ verifying: false });
    }
  },

  cancelConfirm() {
    this.setData({
      showConfirm: false,
      confirmInfo: null
    });
  },

  resetPage() {
    this.setData({
      verifyCode: '',
      verifyError: '',
      showConfirm: false,
      showSuccess: false,
      confirmInfo: null
    });
  },

  // ==========================================
  // 核销记录
  // ==========================================

  loadRecords() {
    const storeId = this.data.currentStore.id;
    if (!storeId) {
      this.setData({ recordsByMonth: [], todayTotal: 0 });
      return;
    }

    businessAPI.getStoreVerifyRecords(storeId)
      .then((res) => {
        if (res && res.code === 200 && res.data) {
          this.setData({
            recordsByMonth: res.data.recordsByMonth || [],
            todayTotal: res.data.todayTotal || 0
          });
          return;
        }
        this.setData({ recordsByMonth: [], todayTotal: 0 });
      })
      .catch((e) => {
        console.error('加载核销记录失败:', e);
        this.setData({ recordsByMonth: [], todayTotal: 0 });
      });
  },

  _maskPhone(phone) {
    if (!phone || phone.length < 7) return phone || '未知';
    return phone.slice(0, 3) + '****' + phone.slice(-4);
  },

  _formatDate(d) {
    if (!d) return '';
    const pad = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  },

  _formatTime(d) {
    if (!d) return '';
    const pad = n => String(n).padStart(2,'0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  // 导出核销记录
  exportVerifyRecords() {
    const recordsByMonth = this.data.recordsByMonth;
    if (!recordsByMonth || recordsByMonth.length === 0) {
      wx.showToast({ title: '暂无核销记录', icon: 'none' });
      return;
    }

    let text = '===智机惠核销记录===';
    let totalAmount = 0;
    let totalCount = 0;

    recordsByMonth.forEach(monthGroup => {
      text += `\n\n【${monthGroup.month}】`;
      text += `\n合计：¥${monthGroup.total}`;
      text += `\n手机号\t时间\t金额`;
      
      monthGroup.list.forEach(record => {
        text += `\n${record.phone}\t${record.date} ${record.time}\t¥${record.amount}`;
        totalAmount += record.amount;
        totalCount++;
      });
    });

    text += `\n\n总计：${totalCount}笔，共¥${totalAmount}`;

    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showModal({
          title: '已复制到剪贴板',
          content: `共 ${totalCount} 条核销记录，请粘贴到微信/备忘录/Excel 中保存。`,
          showCancel: false,
          confirmText: '好的'
        });
      }
    });
  }
});
