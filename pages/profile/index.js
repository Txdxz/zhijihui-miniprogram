const { businessAPI } = require('../../utils/business-api');
const ToastLib = require('@vant/weapp/toast/toast');
const Toast = ToastLib.default || ToastLib;

// Contract status display mapping
const CONTRACT_STATUS_MAP = {
  0: { label: '已驳回', cls: 'rejected' },
  1: { label: '待审核', cls: 'pending' },
  2: { label: '已通过', cls: 'qualified' },
  3: { label: '待短信', cls: 'pending' },
  4: { label: '办理中', cls: 'processing' },
  5: { label: '已办理', cls: 'completed' },
  6: { label: '已发货', cls: 'shipped' },
  7: { label: '已签收', cls: 'signed' },
  8: { label: '短信驳回', cls: 'rejected' }
};

Page({
  data: {
    pageLoading: true,
    pageError: '',

    // User profile
    userInfo: null,
    nickName: '',
    avatarUrl: '',
    phone: '',

    // Editing state
    editing: false,
    saving: false,

    // Contracts
    contracts: [],

    // Coupon stats
    couponStats: {
      total: 0,
      pending: 0,
      active: 0,
      used: 0
    },

    // Contract status helpers for template
    _CONTRACT_STATUS_MAP: CONTRACT_STATUS_MAP,

    // Admin status
    isAdmin: false
  },

  onLoad() {
    Toast.setDefaultOptions({ selector: '#van-toast' });
    this.loadProfile();
  },

  onShow() {
    this.loadProfile();
  },

  async loadProfile() {
    this.setData({ pageLoading: true, pageError: '' });
    try {
      // 如果角色信息为空，主动触发一次角色识别
      const app = getApp();
      const roles = app.globalData.lastResolvedRoleOptions || [];
      const userRole = app.globalData.userRole || wx.getStorageSync('userRole') || '';
      if (!roles.length && userRole !== 'admin' && userRole !== 'super_admin') {
        try {
          await app.resolveLaunchContext({ preferredRoleKey: '' });
        } catch (e) {
          console.error('预检角色识别失败:', e);
        }
      }

      const res = await businessAPI.getUserInfo();

      if (res.code === 200 && res.data) {
        const { user, contracts, couponStats } = res.data;
        // 检查当前用户是否有管理员权限（多重来源确保可靠）
        const app = getApp();
        const roles = app.globalData.lastResolvedRoleOptions || [];
        const fromRoles = roles.some(r => r && (r.key === 'admin' || r.key === 'super_admin'));
        const fromStorage = (wx.getStorageSync('userRole') || '') === 'admin'
          || (wx.getStorageSync('userRole') || '') === 'super_admin';
        const fromGlobal = app.globalData.userRole === 'admin' || app.globalData.userRole === 'super_admin';
        const fromCurrentAdmin = !!(app.globalData.currentAdmin && app.globalData.currentAdmin.status === 1);
        const isAdmin = fromRoles || fromStorage || fromGlobal || fromCurrentAdmin;
        this.setData({
          userInfo: user,
          nickName: user.nickName || '',
          avatarUrl: user.avatarUrl || '',
          phone: user.phone || '',
          contracts: contracts || [],
          couponStats: couponStats || { total: 0, pending: 0, active: 0, used: 0 },
          isAdmin,
          pageLoading: false
        });
      } else {
        this.setData({ pageError: '加载失败', pageLoading: false });
      }
    } catch (e) {
      console.error('loadProfile error:', e);
      this.setData({ pageError: '网络异常，请下拉刷新重试', pageLoading: false });
    }
  },

  onPullDownRefresh() {
    this.loadProfile().finally(() => wx.stopPullDownRefresh());
  },

  _showToast(msg) {
    wx.showToast({ title: msg, icon: 'none', duration: 2000 });
  },

  // ========== Profile editing ==========

  startEdit() {
    this.setData({
      editing: true,
      nickName: this.data.userInfo.nickName || '',
      avatarUrl: this.data.userInfo.avatarUrl || ''
    });
  },

  cancelEdit() {
    this.setData({
      editing: false,
      nickName: this.data.userInfo.nickName || '',
      avatarUrl: this.data.userInfo.avatarUrl || ''
    });
  },

  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    if (avatarUrl) {
      this.setData({ avatarUrl });
    }
  },

  onNicknameInput(e) {
    const value = (e.detail && e.detail.value) || '';
    this.setData({ nickName: value });
  },

  onNicknameChange(e) {
    const value = (e.detail && e.detail.value) || '';
    this.setData({ nickName: value });
  },

  async saveProfile() {
    if (this.data.saving) return;
    this.setData({ saving: true });

    try {
      const { nickName, avatarUrl } = this.data;

      // Upload avatar if changed (temporary path from chooseAvatar)
      let finalAvatarUrl = this.data.userInfo.avatarUrl || '';
      if (avatarUrl && avatarUrl !== finalAvatarUrl && avatarUrl.startsWith('http://tmp/')) {
        try {
          const cloudPath = `avatars/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
          const uploadRes = await wx.cloud.uploadFile({
            cloudPath,
            filePath: avatarUrl
          });
          finalAvatarUrl = uploadRes.fileID;
        } catch (e) {
          console.warn('头像上传失败，使用临时路径:', e);
          finalAvatarUrl = avatarUrl;
        }
      } else if (avatarUrl && avatarUrl !== finalAvatarUrl) {
        finalAvatarUrl = avatarUrl;
      }

      const res = await businessAPI.updateUserProfile({
        nickName: nickName,
        avatarUrl: finalAvatarUrl
      });

      if (res.code === 200) {
        wx.showToast({ title: '保存成功', icon: 'success', duration: 1500 });
        this.setData({
          editing: false,
          userInfo: {
            ...this.data.userInfo,
            nickName,
            avatarUrl: finalAvatarUrl
          }
        });
        // Update global user info
        const app = getApp();
        if (app.globalData.currentUser) {
          app.globalData.currentUser.nickName = nickName;
          app.globalData.currentUser.avatarUrl = finalAvatarUrl;
        }
      } else {
        this._showToast(res.message || '保存失败');
      }
    } catch (e) {
      console.error('saveProfile error:', e);
      this._showToast('网络异常');
    } finally {
      this.setData({ saving: false });
    }
  },

  // ========== Navigation ==========

  goToLoginConfirm() {
    wx.navigateTo({ url: '/packageAdmin/pages/admin/loginConfirm/index' });
  },

  viewCoupons() {
    wx.switchTab({ url: '/pages/coupon/coupon' });
  },

  // WXML helpers - these are called from WXML via data binding
  _formatDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  },
  _getStatusLabel(status) {
    const map = this.data._CONTRACT_STATUS_MAP;
    return (map && map[status] && map[status].label) || '未知';
  },
  _getStatusCls(status) {
    const map = this.data._CONTRACT_STATUS_MAP;
    return (map && map[status] && map[status].cls) || 'default';
  }
});
