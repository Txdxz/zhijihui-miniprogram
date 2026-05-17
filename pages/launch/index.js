const app = getApp();

Page({
  data: {
    hasSession: false,
    authorizing: false,
    resolving: false,
    statusText: '',
    showRoleChooser: false,
    roleOptions: []
  },

  async onLoad() {
    await this._bootstrap();
  },

  async _bootstrap() {
    const cachedOpenId = app.globalData.currentOpenId || wx.getStorageSync('currentOpenId');

    if (cachedOpenId && !app.globalData.currentOpenId) {
      app.globalData.currentOpenId = cachedOpenId;
    }

    this.setData({
      hasSession: !!cachedOpenId,
      statusText: cachedOpenId ? '已识别身份，点击进入' : ''
    });
  },

  async onWechatLogin() {
    if (this.data.authorizing || this.data.resolving) {
      return;
    }

    this.setData({
      authorizing: true,
      statusText: '正在识别身份...'
    });

    try {
      // 确保有 openId
      if (!app.globalData.currentOpenId) {
        await new Promise((resolve, reject) => {
          app.wxLogin(
            () => resolve(),
            (err) => reject(new Error(err || '微信登录失败'))
          );
        });
      }

      await this._resolveAndRoute();
    } catch (error) {
      console.error('onWechatLogin 错误:', error);
      const message = (error && error.message) || '登录失败，请重试';
      wx.showToast({ title: message, icon: 'none' });
      this.setData({ statusText: message });
    } finally {
      this.setData({ authorizing: false });
    }
  },

  async _resolveAndRoute({ silent = false } = {}) {
    this.setData({ resolving: true, showRoleChooser: false });

    try {
      const result = await app.resolveLaunchContext();
      this.setData({
        hasSession: !!result.openId
      });

      if (result.needsChoice) {
        this.setData({
          showRoleChooser: true,
          roleOptions: result.roleOptions || [],
          statusText: '检测到多个可用身份，请选择本次进入的页面'
        });
        return;
      }

      if (result.target) {
        this.setData({ statusText: `正在进入${result.target.title}...` });
        this._enterTarget(result.target);
        return;
      }

      if (!silent) {
        wx.showToast({ title: '暂未识别到可进入页面', icon: 'none' });
      }
    } catch (error) {
      console.error('_resolveAndRoute 错误:', error);
      const message = (error && error.message) || '身份识别失败，请重试';
      if (!silent) {
        wx.showToast({ title: message, icon: 'none' });
      }
      this.setData({ statusText: message });
    } finally {
      this.setData({ resolving: false });
    }
  },

  _enterTarget(target) {
    if (!target || !target.url) {
      return;
    }

    if (target.routeType === 'switchTab') {
      wx.switchTab({ url: target.url });
      return;
    }

    wx.reLaunch({ url: target.url });
  },

  async onChooseRole(e) {
    const role = e.currentTarget.dataset.role;
    const fallbackTarget = role === 'customer'
      ? {
          key: 'customer',
          title: '客户首页',
          url: '/pages/index/index',
          routeType: 'switchTab'
        }
      : (this.data.roleOptions || []).find(item => item.key === role);

    if (!fallbackTarget) {
      return;
    }

    this.setData({
      resolving: true,
      showRoleChooser: false,
      statusText: `正在进入${fallbackTarget.title}...`
    });

    try {
      const res = await app.selectPortalRole(role);
      if (res.code === 200 && res.data) {
        this._enterTarget(res.data);
      } else {
        wx.showToast({ title: res.message || '角色切换失败', icon: 'none' });
        this.setData({
          showRoleChooser: true,
          statusText: res.message || '角色切换失败，请重试'
        });
      }
    } catch (error) {
      console.error('onChooseRole 错误:', error);
      wx.showToast({ title: '角色切换失败', icon: 'none' });
      this.setData({
        showRoleChooser: true,
        statusText: '角色切换失败，请重试'
      });
    } finally {
      this.setData({ resolving: false });
    }
  },

  onGoBind() {
    wx.navigateTo({ url: '/pages/bind/index' });
  }
});
