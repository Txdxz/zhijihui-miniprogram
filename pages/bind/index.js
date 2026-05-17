// pages/bind/index.js - 角色绑定页面
const app = getApp();
const { callCloudFunction } = require('../../utils/cloud');

const ROLE_HINTS = {
  admin: '检测到管理员邀请，请输入您的手机号完成绑定',
  store_owner: '检测到门店负责人邀请，请输入您的手机号完成绑定',
  store_clerk: '检测到店员邀请，请输入您的手机号完成绑定'
};

const ROLE_NAMES = {
  admin: '管理员',
  store_owner: '门店负责人',
  store_clerk: '店员'
};

Page({
  data: {
    phone: '',
    binding: false,
    result: null,
    error: '',
    inviteType: '',  // 从 URL 参数获取
    inviteHint: ''   // 提示文案
  },

  onLoad(options) {
    // 从 URL 参数获取邀请类型
    const inviteType = options.inviteType || '';
    if (inviteType && ROLE_HINTS[inviteType]) {
      this.setData({
        inviteType,
        inviteHint: ROLE_HINTS[inviteType]
      });
    }
  },

  _inputDetail(e) {
    const detail = e && e.detail;
    if (detail == null) return '';
    if (typeof detail === 'string' || typeof detail === 'number') {
      return String(detail);
    }
    if (typeof detail === 'object' && detail.value != null) {
      return String(detail.value);
    }
    return '';
  },

  onPhoneInput(e) {
    const value = e.detail.value || '';
    const numericValue = value.replace(/\D/g, '').slice(0, 11);
    this.setData({
      phone: numericValue,
      error: ''
    });
  },

  async onBindRole() {
    const phone = this.data.phone.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      this.setData({ error: '请输入正确的11位手机号' });
      return;
    }

    this.setData({ binding: true, error: '', result: null });

    try {
      // 先确保有登录态
      if (!app.globalData.currentOpenId) {
        await new Promise((resolve, reject) => {
          app.wxLogin(resolve, (err) => reject(new Error(err || '登录失败')));
        });
      }

      // 业务规则：一个手机号只能对应一个角色
      // 先查询该手机号的待绑定邀请数量
      const queryRes = await callCloudFunction('portalBiz', {
        action: 'queryPendingInvites',
        phone
      });

      if (queryRes.code === 200 && queryRes.data) {
        const invites = queryRes.data;

        // 如果没有邀请记录
        if (invites.length === 0) {
          this.setData({
            error: '未找到可绑定的角色，请确认手机号与管理员邀请时填写的手机号一致'
          });
          return;
        }

        // 如果有多条邀请记录 → 数据异常，拒绝绑定
        if (invites.length > 1) {
          this.setData({
            error: '该手机号存在多条邀请记录，请联系管理员处理'
          });
          return;
        }

        // 只有一条邀请记录，正常绑定
        const invite = invites[0];
        const roleKey = invite.roleKey;

        const res = await callCloudFunction('bindRoleByPhone', { phone, roleKey });
        if (res.code === 200) {
          this.setData({
            result: {
              success: true,
              roleKey,
              message: `绑定成功！您已成为${ROLE_NAMES[roleKey] || roleKey}`
            }
          });

          // 更新全局状态
          app.globalData.userRole = roleKey;
          wx.setStorageSync('userRole', roleKey);

          // 延迟跳转，让用户看到成功提示
          setTimeout(async () => {
            // 调用 resolveLaunchContext 获取完整的角色信息（包括门店ID）
            try {
              const launchRes = await callCloudFunction('resolveLaunchContext', {});
              if (launchRes.code === 200 && launchRes.data && launchRes.data.target) {
                const target = launchRes.data.target;
                // 如果有门店信息，存到全局
                if (target.storeId) {
                  app.globalData.currentStore = {
                    id: target.storeId,
                    name: target.title || '',
                    address: target.desc || ''
                  };
                }
                // 跳转到目标页面
                if (target.routeType === 'reLaunch') {
                  wx.reLaunch({ url: target.url });
                } else {
                  wx.redirectTo({ url: target.url });
                }
                return;
              }
            } catch (e) {
              console.error('resolveLaunchContext 失败:', e);
            }

            // 降级处理：直接跳转
            if (roleKey === 'admin') {
              wx.reLaunch({ url: '/packageAdmin/pages/admin/index' });
            } else if (roleKey === 'store_owner' || roleKey === 'store_clerk') {
              wx.reLaunch({ url: '/pages/store/verify' });
            }
          }, 1500);
        } else {
          this.setData({
            error: res.message || '绑定失败，请稍后重试'
          });
        }
      } else {
        this.setData({
          error: '查询邀请记录失败，请稍后重试'
        });
      }
    } catch (error) {
      console.error('绑定失败:', error);
      this.setData({ error: error.message || '绑定失败，请稍后重试' });
    } finally {
      this.setData({ binding: false });
    }
  },

  onGoBack() {
    wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/launch/index' }) });
  }
});
