// app.js - 智机惠小程序入口
const { initCloudRuntime, callCloudFunction } = require('./utils/cloud');
const { Analytics, AnalyticsEvents } = require('./utils/analytics');

App({
  onLaunch() {
    // 初始化数据分析SDK
    Analytics.init();
    const cloudRuntime = initCloudRuntime();
    this.globalData.runtimeMode = cloudRuntime.mode;
    this.globalData.cloudReady = cloudRuntime.enabled;
    this.globalData.cloudEnvId = cloudRuntime.envId;
    this.globalData.cloudReason = cloudRuntime.reason || '';

    // 读取持久化数据
    try {
      this.globalData.userRole     = wx.getStorageSync('userRole')     || 'customer';
      this.globalData.currentOpenId = wx.getStorageSync('currentOpenId') || '';
      this.globalData.currentAdmin = wx.getStorageSync('currentAdmin') || null;
      this.globalData.currentStoreOwner = wx.getStorageSync('currentStoreOwner') || null;
      this.globalData.currentStore = wx.getStorageSync('currentStore') || null;
      this.globalData.userInfo     = wx.getStorageSync('userInfo')     || null;
      this.globalData.isLoggedIn   = !!wx.getStorageSync('userInfo');
      this.globalData.lastPortalRole = wx.getStorageSync('lastPortalRole') || '';
    } catch(e) {
      this.globalData.userRole     = 'customer';
      this.globalData.currentOpenId = '';
      this.globalData.currentAdmin = null;
      this.globalData.currentStoreOwner = null;
      this.globalData.currentStore = null;
      this.globalData.userInfo     = null;
      this.globalData.isLoggedIn   = false;
      this.globalData.lastPortalRole = '';
    }
  },

  _buildCustomerTarget() {
    return {
      key: 'customer',
      title: '客户首页',
      desc: '办理合约与查看权益',
      url: '/pages/index/index',
      routeType: 'switchTab'
    };
  },

  _saveCurrentOpenId(openId) {
    const normalizedOpenId = String(openId || '').trim();
    if (!normalizedOpenId) {
      return '';
    }

    this.globalData.currentOpenId = normalizedOpenId;
    try {
      wx.setStorageSync('currentOpenId', normalizedOpenId);
    } catch (e) {}
    return normalizedOpenId;
  },

  async _loginByCloud() {
    const res = await callCloudFunction('login');
    const openId = res && res.data ? res.data.openId : '';
    const user = res && res.data ? res.data.user : null;

    if (!openId) {
      throw new Error((res && res.message) || '云开发登录失败');
    }

    // Store user record from auto-registration
    if (user) {
      this.globalData.currentUser = user;
    }

    return this._saveCurrentOpenId(openId);
  },

  _cacheRoleOptions(roleOptions) {
    this.globalData.lastResolvedRoleOptions = Array.isArray(roleOptions) ? roleOptions.slice() : [];
  },

  _findRoleOption(roleKeys = []) {
    const options = this.globalData.lastResolvedRoleOptions || [];
    return options.find(item => item && roleKeys.includes(item.key)) || null;
  },

  _requireCloudReady() {
    if (this.globalData.cloudReady) {
      return true;
    }
    throw new Error('云开发未就绪，请在 utils/cloud-env.js 配置 CLOUD_ENV_ID 并部署云函数');
  },

  /**
   * 获取当前用户的 openId
   */
  getCurrentOpenId() {
    if (this.globalData.currentOpenId) {
      return Promise.resolve(this.globalData.currentOpenId);
    }

    this._requireCloudReady();
    if (!this._cloudLoginPromise) {
      this._cloudLoginPromise = this._loginByCloud()
        .finally(() => {
          this._cloudLoginPromise = null;
        });
    }
    return this._cloudLoginPromise;
  },

  /**
   * 判断 openId 是否为管理员
   */
  checkIsAdmin(openId) {
    const roleOptions = this.globalData.lastResolvedRoleOptions || [];
    if (!openId || !this.globalData.currentOpenId || openId !== this.globalData.currentOpenId) {
      return false;
    }
    return roleOptions.some(item => item && (item.key === 'admin' || item.key === 'super_admin'));
  },

  /**
   * 获取当前管理员信息（用于界面显示）
   */
  getCurrentAdmin() {
    if (this.globalData.currentAdmin && this.globalData.currentAdmin.status === 1) {
      return this.globalData.currentAdmin;
    }

    const adminTarget = this._findRoleOption(['super_admin', 'admin']);
    if (!adminTarget) {
      return null;
    }

    const currentAdmin = {
      id: adminTarget.key,
      name: adminTarget.title || '管理员',
      roleKey: adminTarget.key,
      status: 1,
      desc: adminTarget.desc || ''
    };
    this.globalData.currentAdmin = currentAdmin;
    try {
      wx.setStorageSync('currentAdmin', currentAdmin);
    } catch (e) {}
    return currentAdmin;
  },

  /**
   * 获取当前门店负责人信息
   */
  getCurrentStoreOwner() {
    const currentStoreOwner = this.globalData.currentStoreOwner;
    if (currentStoreOwner && currentStoreOwner.status !== 0) {
      return currentStoreOwner;
    }

    const storeTarget = this._findRoleOption(['store_owner', 'store_clerk']);
    if (!storeTarget || !storeTarget.storeId) {
      return null;
    }

    const inferredStoreName = (storeTarget.desc || '').replace(/\s*核销工作台$/, '');
    const storeOwner = {
      id: storeTarget.storeId,
      role: storeTarget.key,
      storeId: storeTarget.storeId,
      storeName: inferredStoreName,
      status: 1
    };
    const currentStore = {
      id: storeTarget.storeId,
      name: inferredStoreName,
      address: ''
    };
    this.globalData.currentStoreOwner = storeOwner;
    this.globalData.currentStore = currentStore;
    try {
      wx.setStorageSync('currentStoreOwner', storeOwner);
      wx.setStorageSync('currentStore', currentStore);
    } catch (e) {}
    return storeOwner;
  },

  _setCustomerRole() {
    this.globalData.userRole = 'customer';
    this.globalData.currentAdmin = null;
    this.globalData.currentStoreOwner = null;
    this.globalData.currentStore = null;
    try {
      wx.setStorageSync('userRole', 'customer');
      wx.setStorageSync('currentAdmin', null);
      wx.setStorageSync('currentStoreOwner', null);
      wx.setStorageSync('currentStore', null);
    } catch (e) {}
  },

  _setAdminRole(admin) {
    this.globalData.userRole = 'admin';
    this.globalData.currentAdmin = admin;
    this.globalData.currentStoreOwner = null;
    this.globalData.currentStore = null;
    try {
      wx.setStorageSync('userRole', 'admin');
      wx.setStorageSync('currentAdmin', admin);
      wx.setStorageSync('currentStoreOwner', null);
      wx.setStorageSync('currentStore', null);
    } catch (e) {}
  },

  _setStoreRole(storeOwner, storeInfo) {
    this.globalData.userRole = 'store_owner';
    this.globalData.currentAdmin = null;
    this.globalData.currentStoreOwner = storeOwner;
    this.globalData.currentStore = storeInfo || null;
    try {
      wx.setStorageSync('userRole', 'store_owner');
      wx.setStorageSync('currentAdmin', null);
      wx.setStorageSync('currentStoreOwner', storeOwner);
      wx.setStorageSync('currentStore', storeInfo || null);
    } catch (e) {}
  },

  _rememberPortalRole(roleKey) {
    this.globalData.lastPortalRole = roleKey;
    try {
      wx.setStorageSync('lastPortalRole', roleKey);
    } catch (e) {}
  },

  /**
   * 管理员身份验证
   * 通过 openId 白名单判断，无需密码
   */
  verifyAdmin(onSuccess, onFail) {
    if (this.globalData.userRole === 'admin') {
      // 已是管理员，快速通过
      const currentAdmin = this.getCurrentAdmin();
      if (currentAdmin) {
        onSuccess && onSuccess(currentAdmin);
        return;
      }
    }

    this.resolveLaunchContext({ preferredRoleKey: this.globalData.lastPortalRole || 'customer' })
      .then((result) => {
        const adminTarget = [result.target].concat(result.roleOptions || [])
          .find(item => item && (item.key === 'admin' || item.key === 'super_admin'));

        if (!adminTarget) {
          onFail && onFail();
          return;
        }

        this.applyPortalRole(adminTarget.key, { target: adminTarget });
        onSuccess && onSuccess(this.getCurrentAdmin());
      })
      .catch((error) => {
        console.error('管理员校验失败:', error);
        onFail && onFail(error);
      });
  },

  /**
   * 解析当前微信号可进入的角色入口
   */
  async resolveLaunchContext(options = {}) {
    this._requireCloudReady();
    const preferredRoleKey = typeof options.preferredRoleKey === 'string'
      ? options.preferredRoleKey
      : (this.globalData.lastPortalRole || wx.getStorageSync('lastPortalRole') || '');
    const res = await callCloudFunction('resolveLaunchContext', {
      lastPortalRole: preferredRoleKey
    });

    if (!res || res.code !== 200 || !res.data) {
      throw new Error((res && res.message) || '角色识别失败');
    }

    const launchData = res.data;
    const openId = this._saveCurrentOpenId(launchData.openId || '');
    const roleOptions = Array.isArray(launchData.roleOptions) ? launchData.roleOptions : [];

    this._cacheRoleOptions(roleOptions);
    this.globalData.lastLaunchContext = {
      openId,
      role: launchData.role || '',
      target: launchData.target || null,
      roleOptions,
      needsChoice: !!launchData.needsChoice
    };

    if (launchData.target) {
      this.applyPortalRole(launchData.target.key || launchData.role || 'customer', {
        target: launchData.target
      });
    } else if (launchData.role === 'customer' && !launchData.needsChoice) {
      this.applyPortalRole('customer');
    } else {
      this._setCustomerRole();
    }

    return {
      openId,
      role: launchData.role || '',
      target: launchData.target || null,
      roleOptions,
      needsChoice: !!launchData.needsChoice
    };
  },

  async selectPortalRole(roleKey) {
    this._requireCloudReady();
    const result = await this.resolveLaunchContext({ preferredRoleKey: roleKey });
    const target = result.target
      || (result.roleOptions || []).find(item => item.key === roleKey)
      || (roleKey === 'customer' ? this._buildCustomerTarget() : null);

    if (!target) {
      if (roleKey === 'admin' || roleKey === 'super_admin') {
        return { code: 404, message: '当前账号未配置管理员权限' };
      }
      if (roleKey === 'store_owner' || roleKey === 'store_clerk') {
        return { code: 404, message: '当前账号未绑定门店身份' };
      }
      return { code: 404, message: '未识别到可进入页面' };
    }

    this.applyPortalRole(roleKey, { target });
    return { code: 200, data: target };
  },

  applyPortalRole(roleKey, context = {}) {
    if ((roleKey === 'admin' || roleKey === 'super_admin') && (context.admin || context.target)) {
      const admin = context.admin || {
        id: roleKey,
        name: (context.target && context.target.title) || '管理员',
        roleKey,
        status: 1,
        desc: (context.target && context.target.desc) || ''
      };
      this._setAdminRole(admin);
      this._rememberPortalRole(roleKey);
      
      // 上报用户身份 - 管理员
      Analytics.setUser({
        userId: 'admin_' + this.globalData.currentOpenId,
        userType: 'admin',
        role: roleKey
      });
      Analytics.track(AnalyticsEvents.ADMIN_LOGIN, {
        roleKey: roleKey
      });
      return;
    }

    if ((roleKey === 'store_owner' || roleKey === 'store_clerk') && (context.storeOwner || context.target)) {
      const target = context.target || {};
      const inferredStoreName = ((target.desc || '').replace(/\s*核销工作台$/, '')) || '';
      const storeInfo = context.currentStore || (target.storeId ? {
        id: target.storeId,
        name: inferredStoreName,
        address: ''
      } : null);
      const storeOwner = context.storeOwner || {
        id: target.storeId || '',
        role: roleKey,
        storeId: target.storeId || '',
        storeName: inferredStoreName,
        status: 1
      };
      this._setStoreRole(storeOwner, storeInfo || null);
      this._rememberPortalRole(roleKey);
      
      // 上报用户身份 - 门店负责人
      Analytics.setUser({
        userId: 'store_' + this.globalData.currentOpenId,
        userType: 'store_owner',
        storeId: target.storeId
      });
      return;
    }

    this._setCustomerRole();
    this._rememberPortalRole('customer');
    
    // 上报用户身份 - 普通客户
    Analytics.setUser({
      userId: 'customer_' + this.globalData.currentOpenId,
      userType: 'customer'
    });
  },

  async bindCurrentUserToStoreRole(phone) {
    this._requireCloudReady();
    const res = await callCloudFunction('bindRoleByPhone', {
      phone,
      roleKey: 'store_owner'
    });

    if (res && res.code === 200) {
      await this.resolveLaunchContext({ preferredRoleKey: 'store_owner' });
    }
    return res;
  },

  async bindCurrentUserToAdminRole(phone) {
    this._requireCloudReady();
    const res = await callCloudFunction('bindRoleByPhone', {
      phone,
      roleKey: 'admin'
    });

    if (res && res.code === 200) {
      await this.resolveLaunchContext({ preferredRoleKey: 'admin' });
    }

    return res;
  },

  /**
   * 将当前 openId 注册为管理员（管理员操作）
   * @param {Object} adminInfo { name, phone }
   * @returns Promise<{ code, data, message }>
   */
  async addAdminByCurrentUser(adminInfo) {
    return {
      code: 400,
      message: '正式环境请先由超级管理员预配置管理员权限，再使用手机号完成绑定'
    };
  },

  /**
   * 退出管理员身份（切回消费者）
   */
  logoutAdmin() {
    this._setCustomerRole();
    this._rememberPortalRole('customer');
  },

  onShow() {},
  onHide() {},

  globalData: {
    currentUser:  null,         // 数据库 portal_users 记录 { _id, openId, nickName, avatarUrl, phone, createdAt }
    userInfo:     null,         // 微信用户信息 { avatarUrl, city, gender, language, nickName, province }
    isLoggedIn:   false,        // 是否已授权登录
    currentStore: null,         // 当前选中的门店
    currentContract: null,       // 当前合约
    currentStoreOwner: null,    // 当前门店负责人信息
    userRole:     'customer',    // customer | admin | store_owner
    currentOpenId: '',          // 当前微信 openId
    currentAdmin:  null,        // 当前管理员信息
    lastPortalRole: '',         // 上次进入的工作台角色
    lastResolvedRoleOptions: [],// 最近一次识别到的角色入口
    lastLaunchContext: null,    // 最近一次启动分流结果
    runtimeMode: 'disabled',    // disabled | cloud
    cloudReady: false,          // 云环境是否已初始化
    cloudEnvId: '',             // 当前云环境 ID
    cloudReason: '',            // 云环境初始化失败原因
    location: null,             // 用户当前位置 { latitude, longitude }
    locationAuth: false          // 是否已授权定位
  },

  // ==========================================
  // 微信登录 - 获取用户信息
  // ==========================================

  /**
   * 检查并获取微信登录状态
   * @returns {Promise<boolean>} 是否已登录
   */
  checkLoginStatus() {
    return new Promise((resolve) => {
      if (this.globalData.userInfo && this.globalData.currentOpenId) {
        resolve(true);
        return;
      }

      // 检查本地缓存
      try {
        const userInfo = wx.getStorageSync('userInfo');
        const openId = wx.getStorageSync('currentOpenId');
        if (userInfo && openId) {
          this.globalData.userInfo = userInfo;
          this.globalData.currentOpenId = openId;
          this.globalData.isLoggedIn = true;
          resolve(true);
          return;
        }
      } catch(e) {}

      resolve(false);
    });
  },

  /**
   * 微信登录 - 获取 openId 和用户基本信息
   * @param {Function} onSuccess 成功回调
   * @param {Function} onFail 失败回调
   */
  wxLogin(onSuccess, onFail) {
    this.getCurrentOpenId()
      .then((openId) => {
        onSuccess && onSuccess({ openid: openId });
      })
      .catch((error) => {
        console.error('云开发登录失败', error);
        onFail && onFail(error && error.message ? error.message : '微信登录失败');
      });
  },

  /**
   * 获取用户授权信息（使用新的头像昵称填写机制）
   * @returns {Promise<{ avatarUrl, nickName, gender, country, province, city }>}
   */
  getUserInfo() {
    return new Promise((resolve) => {
      // 使用默认用户信息，实际应用中应该引导用户手动输入头像和昵称
      const defaultUserInfo = {
        avatarUrl: 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0',
        nickName: '用户' + Math.floor(Math.random() * 10000),
        gender: 0,
        country: '',
        province: '',
        city: ''
      };
      
      // 保存到 globalData 和本地
      this.globalData.userInfo = defaultUserInfo;
      this.globalData.isLoggedIn = true;
      try {
        wx.setStorageSync('userInfo', defaultUserInfo);
      } catch(e) {}
      
      resolve(defaultUserInfo);
    });
  },

  /**
   * 完整的微信登录流程（自动获取 openId + 用户授权）
   * @returns {Promise<{ success: boolean, userInfo?, openId?, error?: string }>}
   */
  async doWxLogin() {
    try {
      // 1. 先获取 openId
      const openId = await this._getOpenId();
      if (!openId) {
        return { success: false, error: '获取 openId 失败' };
      }

      // 2. 尝试获取用户信息（可能用户拒绝）
      let userInfo = null;
      try {
        userInfo = await this.getUserInfo();
      } catch(e) {
        console.log('用户拒绝授权用户信息');
        // 用户拒绝授权，继续使用 openId 登录
      }

      return { success: true, openId, userInfo };
    } catch(e) {
      return { success: false, error: e.message || '登录失败' };
    }
  },

  /**
   * 获取 openId（内部方法）
   */
  _getOpenId() {
    return this.getCurrentOpenId().catch(() => null);
  },

  /**
   * 保存用户会话（内部方法）
   */
  _saveUserSession(openId, userInfo) {
    this.globalData.currentOpenId = openId;
    this.globalData.isLoggedIn = true;
    if (userInfo) {
      this.globalData.userInfo = userInfo;
    }
    try {
      wx.setStorageSync('currentOpenId', openId);
      if (userInfo) {
        wx.setStorageSync('userInfo', userInfo);
      }
    } catch(e) {}
  },

  // ==========================================
  // 定位功能
  // ==========================================

  /**
   * 检查定位授权状态
   * @returns {Promise<boolean>}
   */
  checkLocationAuth() {
    return new Promise((resolve) => {
      wx.getSetting({
        success: (res) => {
          const authSetting = res.authSetting;
          // 优先检查正式 scope 字段
          if (authSetting['scope.userLocation'] === true) {
            this.globalData.locationAuth = true;
            resolve(true);
          } else if (authSetting['scope.userLocation'] === false) {
            this.globalData.locationAuth = false;
            resolve(false);
          } else {
            // 未询问过，发起授权询问
            resolve(false);
          }
        },
        fail: () => resolve(false)
      });
    });
  },

  /**
   * 获取用户定位
   * @returns {Promise<{ latitude: number, longitude: number } | null>}
   */
  getUserLocation() {
    return Promise.resolve(null);
  },

  /**
   * 内部方法：执行获取定位
   */
  _doGetLocation(resolve) {
    wx.getLocation({
      type: 'gcj02',  // 国测局坐标系，与腾讯地图一致
      success: (res) => {
        this.globalData.location = {
          latitude: res.latitude,
          longitude: res.longitude
        };
        this.globalData.locationAuth = true;
        resolve(this.globalData.location);
      },
      fail: (err) => {
        console.error('获取定位失败', err);
        this.globalData.locationAuth = false;
        resolve(null);
      }
    });
  },

  /**
   * 计算两点之间的距离（米）
   * @param {number} lat1 纬度1
   * @param {number} lng1 经度1
   * @param {number} lat2 纬度2
   * @param {number} lng2 经度2
   */
  calcDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000; // 地球半径（米）
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  },

  /**
   * 根据定位计算附近门店并排序
   * @param {Array} stores 门店列表
   * @param {Object} location { latitude, longitude }
   * @returns {Array} 排序后的门店列表（包含 distance 字段）
   */
  sortStoresByDistance(stores, location) {
    if (!location || !stores || stores.length === 0) {
      return stores;
    }

    return stores.map(store => {
      let distance = null;
      if (store.location && store.location.lat && store.location.lng) {
        distance = Math.round(
          this.calcDistance(
            location.latitude,
            location.longitude,
            store.location.lat,
            store.location.lng
          )
        );
      }
      return {
        ...store,
        distance,
        distanceText: distance !== null
          ? (distance < 1000 ? `${distance}米` : `${(distance/1000).toFixed(1)}公里`)
          : '距离未知'
      };
    }).sort((a, b) => {
      // 优先按距离排序，无距离的排后面
      if (a.distance === null && b.distance === null) return 0;
      if (a.distance === null) return 1;
      if (b.distance === null) return -1;
      return a.distance - b.distance;
    });
  },

  /**
   * 获取用户当前位置信息（逆地理编码）
   * @param {Object} location { latitude, longitude }
   * @returns {Promise<string>} 位置描述
   */
  reverseGeocode(location) {
    return new Promise((resolve) => {
      if (!location) {
        resolve('未知位置');
        return;
      }
      // 【正式版】调用腾讯地图逆地理编码 API
      // const key = 'YOUR_TENCENT_MAP_KEY';
      // wx.request({
      //   url: `https://apis.map.qq.com/ws/geocoder/v1/?location=${location.latitude},${location.longitude}&key=${key}`,
      //   success: (res) => {
      //     if (res.data && res.data.result) {
      //       resolve(res.data.result.address);
      //     } else {
      //       resolve('未知位置');
      //     }
      //   },
      //   fail: () => resolve('未知位置')
      // });

      // 兜底：未接入逆地理编码服务时返回坐标文本
      resolve(`${location.latitude.toFixed(2)}, ${location.longitude.toFixed(2)}`);
    });
  },

});




