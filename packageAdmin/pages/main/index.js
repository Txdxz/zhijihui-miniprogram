// packageAdmin/pages/main/index.js - 管理后台主页
const app = getApp();
const { businessAPI } = require('../../../utils/business-api');

Page({
  data: {
    adminInfo: null,
    isCloudMode: false,
    canManageStoreSetup: false,
    canManageAdmins: false,
    canManageCouponOps: false,
    stats: {
      pendingContracts: 0,
      todayContracts: 0,
      totalCoupons: 0,
      totalStores: 0
    }
  },

  onLoad() {
    this.checkAdminAuth();
  },

  onShow() {
    if (this.data.adminInfo) {
      this.loadStats();
    }
  },

  // 检查管理员权限
  checkAdminAuth() {
    app.verifyAdmin(
      (admin) => {
        const isCloudMode = !!app.globalData.cloudReady;
        this.setData({
          adminInfo: admin,
          isCloudMode,
          canManageStoreSetup: !isCloudMode,
          canManageAdmins: !isCloudMode
            ? !!(admin && admin.id)
            : !!(admin && admin.roleKey === 'super_admin'),
          canManageCouponOps: !isCloudMode
        });
        this.loadStats();
      },
      (error) => {
        const message = (error && error.message) || '您不是管理员，无法访问管理后台';
        wx.showModal({
          title: '权限不足',
          content: message,
          showCancel: false,
          success: () => {
            wx.reLaunch({ url: '/pages/launch/index' });
          }
        });
      }
    );
  },

  // 加载统计数据
  async loadStats() {
    try {
      const res = await businessAPI.getAdminStats();
      if (res && res.code === 200 && res.data) {
        this.setData({
          stats: {
            pendingContracts: Number(res.data.pendingContracts || 0),
            todayContracts: Number(res.data.todayContracts || 0),
            totalCoupons: Number(res.data.totalCoupons || 0),
            totalStores: Number(res.data.totalStores || 0)
          }
        });
        return;
      }
      wx.showToast({ title: (res && res.message) || '加载统计失败', icon: 'none' });
    } catch (error) {
      console.error('加载统计数据失败:', error);
      wx.showToast({ title: '加载统计失败，请稍后重试', icon: 'none' });
    }
  },

  // 跳转到合约管理
  goToContract() {
    wx.navigateTo({ url: '/packageAdmin/pages/admin/index?tab=contract' });
  },

  // 跳转到代金券管理
  goToCoupon() {
    if (!this.data.canManageCouponOps) {
      wx.showToast({ title: '正式版请在后台系统管理代金券规则', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/packageAdmin/pages/admin/index?tab=coupon' });
  },

  // 跳转到门店管理
  goToStore() {
    wx.navigateTo({ url: '/packageAdmin/pages/admin/index?tab=store' });
  },

  // 跳转到管理员管理
  goToAdmin() {
    wx.navigateTo({ url: '/packageAdmin/pages/admin/index?tab=admins' });
  },

  // 退出管理员身份
  logoutAdmin() {
    wx.showModal({
      title: '确认退出',
      content: '确定要退出当前身份吗？',
      success: (res) => {
        if (res.confirm) {
          app.logoutAdmin();
          wx.showToast({
            title: '已退出当前身份',
            icon: 'success'
          });
          setTimeout(() => {
            wx.reLaunch({ url: '/pages/launch/index' });
          }, 1500);
        }
      }
    });
  }
});
