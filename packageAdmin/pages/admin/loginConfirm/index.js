Page({
  data: {
    scene: '',
    userInfo: {},
    loading: false,
    error: ''
  },

  onLoad(options) {
    const scene = decodeURIComponent(options.scene || '');
    this.setData({ scene });

    // 获取当前用户信息
    const app = getApp();
    if (app.globalData.currentUser) {
      this.setData({ userInfo: app.globalData.currentUser });
    }
  },

  async onConfirm() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });

    try {
      const res = await wx.cloud.callFunction({
        name: 'portalBiz',
        data: { action: 'adminConfirmLogin', scene: this.data.scene }
      });

      const result = res.result || {};

      if (result.code === 200) {
        wx.showToast({ title: '登录成功', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 1500);
      } else {
        this.setData({ error: result.message || '确认失败' });
      }
    } catch (e) {
      console.error('confirmLogin error:', e);
      this.setData({ error: '网络错误，请重试' });
    } finally {
      this.setData({ loading: false });
    }
  },

  goToAdminPanel() {
    wx.reLaunch({ url: '/packageAdmin/pages/admin/index' });
  }
});
