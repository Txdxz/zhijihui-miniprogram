// pages/index/index.js - 首页 V2.1
// 新增功能：
// 1. 微信登录 + 用户信息展示
// 2. 定位授权 + 附近门店匹配
// 3. 门店按距离排序

const { businessAPI, STATES } = require('../../utils/business-api');
const { Analytics, AnalyticsEvents } = require('../../utils/analytics');

Page({
  data: {
    // ===== 用户登录状态 =====
    isLoggedIn: false,
    userInfo: null,  // { avatarUrl, nickName, ... }
    showLoginModal: false,

    // ===== 定位状态 =====
    location: null,       // { latitude, longitude }
    locationAuth: false,
    locationLoading: false,
    locationText: '正在获取位置...',

    // ===== 合约流程状态 =====
    storeInfo: null,
    currentStep: 1,
    contractStatus: 0,
    statusText: '待提交',
    statusStyle: 'default',
    statusDesc: '请输入手机号开始办理',
    contractId: '',

    // ===== Vant 步骤条数据 =====
    steps: [
      { text: '填手机号' },
      { text: '资格核验' },
      { text: '填写信息' },
      { text: '验证码' },
      { text: '办理完成' }
    ],

    // ===== 步骤1：手机号 =====
    step1Phone: '',
    step1PhoneError: '',

    // ===== 步骤2：门店选择 =====
    formData: {
      name: '',
      address: '',
      storeId: '',
      storeName: '',
      nameError: '',
      addressError: ''
    },
    agreed: false,
    stores: [],           // 门店列表（带距离）
    storeNames: [],       // Vant选择器需要的门店名称列表
    showStorePicker: false, // Vant选择器显示状态
    storeFilterText: '全部门店',

    // ===== 步骤3：验证码 =====
    smsCode: '',
    smsCodeError: '',

    // ===== 步骤4+：合约信息 =====
    maskPhone: '',
    contractInfo: {},
    expressCompanyName: '快递单号',

    // ===== 防重复提交状态 =====
    isSubmitting: false,

    // ===== 页面加载状态 =====
    pageLoading: true,
    pageError: '',
    enablePullRefresh: false
  },

  // ===== 组件实例引用 =====
  _dialog: null,
  _pollingTimer: null,

  // ==========================================
  // 导航方法
  // ==========================================

  goToProfile() {
    wx.navigateTo({ url: '/pages/profile/index' });
  },

  goToContractDetail() {
    if (!this.data.contractId) {
      wx.showToast({ title: '暂无合约信息', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: `/pages/contract/detail/index?contractId=${this.data.contractId}` });
  },

  goToStoreMap() {
    wx.navigateTo({ url: '/pages/store/map/index' });
  },

  // ==========================================
  // 生命周期
  // ==========================================

  async onLoad() {
    await this._initializePage();
  },

  async onPullDownRefresh() {
    try {
      await this._initializePage();
      wx.showToast({ title: '已刷新', icon: 'success', duration: 1500 });
    } catch (error) {
      console.error('下拉刷新失败:', error);
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async onShow() {
    try {
      if (!this.data.stores.length) {
        await this._loadStores();
      }
      if (!this.data.contractId) {
        await this._restoreCurrentContract();
      }
      if (this.data.contractId) {
        await this._loadContractStatus(this.data.contractId);
      }
      this._checkAndStartPolling();
    } catch (error) {
      console.error('首页 onShow 刷新失败:', error);
    }
  },

  // 【重要】修复内存泄漏：onHide 和 onUnload 都要清理定时器
  onHide() { this._stopPolling(); },
  onUnload() { this._stopPolling(); },

  // ==========================================
  // 用户登录
  // ==========================================

  async _initializePage() {
    this.setData({ pageLoading: true, pageError: '' });
    try {
      this._checkLoginStatus();
      await this._restoreCurrentContract();
      await this._loadStores();
      if (this.data.contractId) {
        await this._loadContractStatus(this.data.contractId);
      }
    } catch (error) {
      console.error('首页初始化失败:', error);
      this.setData({ pageError: '加载失败，请下拉刷新重试' });
    } finally {
      this.setData({ pageLoading: false, enablePullRefresh: true });
    }
  },

  /**
   * 检查登录状态
   */
  _checkLoginStatus() {
    const app = getApp();
    const isLoggedIn = app.globalData.isLoggedIn;
    const userInfo = app.globalData.userInfo;

    this.setData({
      isLoggedIn: !!isLoggedIn,
      userInfo: userInfo
    });
  },

  /**
   * 触发微信登录（点击登录按钮）
   */
  async onTriggerLogin() {
    const app = getApp();

    try {
      wx.showLoading({ title: '登录中...', mask: true });

      // 1. 获取 openId
      const result = await new Promise((resolve, reject) => {
        app.wxLogin(
          (res) => resolve(res),
          (err) => reject(new Error(err))
        );
      });

      // 2. 尝试获取用户授权（可能用户拒绝）
      try {
        const userInfo = await app.getUserInfo();
        this.setData({
          isLoggedIn: true,
          userInfo: userInfo,
          showLoginModal: false
        });
      } catch(e) {
        // 用户拒绝授权，但 openId 已获取，仍可继续
        this.setData({
          isLoggedIn: true,
          showLoginModal: false
        });
        this._showToast('登录成功，可享受更多服务', 'success');
      }

    } catch(e) {
      console.error('登录失败', e);
      this._showToast('登录失败，请重试');
    } finally {
      wx.hideLoading();
    }
  },

  /**
   * 跳过登录（不获取用户信息，只获取 openId）
   */
  onSkipLogin() {
    this.setData({ showLoginModal: false });
    this._loadStores();
  },

  // ==========================================
  // 定位与附近门店
  // ==========================================

  /**
   * 加载门店列表（带定位排序）
   */
  async _loadStores() {
    const app = getApp();

    try {
      // 尝试从缓存获取门店列表
      const cachedStores = wx.getStorageSync('cached_stores');
      const cacheTime = wx.getStorageSync('cached_stores_time');
      const now = Date.now();
      
      // 缓存有效期10分钟
      if (cachedStores && cacheTime && (now - cacheTime) < 10 * 60 * 1000) {
        console.log('使用缓存的门店列表');
        let stores = cachedStores;
        const location = app.globalData.location;
        const preferredStoreId = this.data.formData.storeId
          || this.data.contractInfo.storeId
          || (this.data.storeInfo && this.data.storeInfo.id)
          || '';

        // 如果有定位，按距离排序
        if (location) {
          stores = app.sortStoresByDistance(stores, location);
        }

        const matchedStore = preferredStoreId
          ? stores.find(store => store.id === preferredStoreId)
          : null;
        const contractStore = this.data.contractInfo.storeId
          ? {
              id: this.data.contractInfo.storeId,
              name: this.data.contractInfo.storeName,
              address: (this.data.storeInfo && this.data.storeInfo.address) || ''
            }
          : null;
        const selectedStore = matchedStore || contractStore || this.data.storeInfo || stores[0];
        const nextData = {
          stores,
          storeNames: stores.map(store => this._formatStorePickerLabel(store)),
          locationText: location ? '已获取位置' : '未开启定位'
        };

        if (selectedStore) {
          nextData.storeInfo = selectedStore;
          nextData['formData.storeId'] = selectedStore.id;
          nextData['formData.storeName'] = selectedStore.name;
        }

        this.setData(nextData);
        return;
      }

      // 缓存过期或不存在，从服务器获取
      const res = await businessAPI.getStores();
      if (res.code === 200 && res.data?.length > 0) {
        let stores = res.data;
        const location = app.globalData.location;
        const preferredStoreId = this.data.formData.storeId
          || this.data.contractInfo.storeId
          || (this.data.storeInfo && this.data.storeInfo.id)
          || '';

        // 如果有定位，按距离排序
        if (location) {
          stores = app.sortStoresByDistance(stores, location);
        }

        // 缓存门店列表
        wx.setStorageSync('cached_stores', stores);
        wx.setStorageSync('cached_stores_time', Date.now());

        const matchedStore = preferredStoreId
          ? stores.find(store => store.id === preferredStoreId)
          : null;
        const contractStore = this.data.contractInfo.storeId
          ? {
              id: this.data.contractInfo.storeId,
              name: this.data.contractInfo.storeName,
              address: (this.data.storeInfo && this.data.storeInfo.address) || ''
            }
          : null;
        const selectedStore = matchedStore || contractStore || this.data.storeInfo || stores[0];
        const nextData = {
          stores,
          storeNames: stores.map(store => this._formatStorePickerLabel(store)),
          locationText: location ? '已获取位置' : '未开启定位'
        };

        if (selectedStore) {
          nextData.storeInfo = selectedStore;
          nextData['formData.storeId'] = selectedStore.id;
          nextData['formData.storeName'] = selectedStore.name;
        }

        this.setData(nextData);
      }
    } catch (error) {
      console.error('_loadStores 错误:', error);
    }
  },

  async _restoreCurrentContract() {
    try {
      const contractId = await businessAPI.getCurrentContractId();
      if (!contractId) return;

      const res = await businessAPI.getContractStatus(contractId);
      if (res.code === 200 && res.data) {
        this._updateUIByStatus(res.data);
      } else if (res.code === 404) {
        // 合约不存在，直接重置页面状态，不需要调用云函数
        this.setData({
          currentStep: 1,
          contractId: '',
          contractStatus: 0,
          statusText: '',
          statusStyle: '',
          statusDesc: ''
        });
      }
    } catch (error) {
      console.error('_restoreCurrentContract 错误:', error);
    }
  },

  /**
   * 获取用户定位
   */
  async onGetLocation() {
    const app = getApp();

    if (this.data.locationLoading) return;

    this.setData({ locationLoading: true });

    try {
      const location = await app.getUserLocation();

      if (location) {
        this.setData({
          location: location,
          locationAuth: true,
          locationText: '位置已获取'
        });

        // 重新加载门店（按距离排序）
        await this._loadStores();

        this._showToast('已定位成功', 'success');
      } else {
        this.setData({
          locationAuth: false,
          locationText: '定位失败'
        });
        // 提示用户开启定位
        this._showToast('请允许定位权限以匹配附近门店');
      }
    } catch(e) {
      console.error('获取定位失败', e);
      this.setData({ locationText: '定位失败' });
    } finally {
      this.setData({ locationLoading: false });
    }
  },

  /**
   * 打开定位设置
   */
  onOpenLocationSetting() {
    const app = getApp();
    app.openLocationSetting();
  },

  // ==========================================
  // Toast/Dialog 辅助方法
  // ==========================================

  /**
   * 显示 Toast 提示
   * @param {string} message - 提示文案
   * @param {string} theme - 主题：fail/success/warning
   */
  _showToast(message, theme = 'fail') {
    if (theme === 'success') {
      wx.showToast({ title: message, icon: 'success', duration: 2000 });
    } else if (theme === 'fail') {
      wx.showToast({ title: message, icon: 'none', duration: 2500 });
    } else {
      wx.showToast({ title: message, icon: 'none', duration: 2000 });
    }
  },

  /**
   * 显示成功提示
   * @param {string} message - 成功文案
   */
  _showSuccess(message) {
    this._showToast(message, 'success');
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

  _formatStorePickerLabel(store) {
    if (!store) return '';
    return store.distanceText ? `${store.name} (${store.distanceText})` : store.name;
  },

  /**
   * 显示确认对话框（Promise 化）
   * @param {object} options - { title, content, confirmText, cancelText, confirmColor }
   * @returns {Promise<boolean>} 用户点击确定返回 true
   */
  _confirmDialog({
    title = '确认操作',
    content = '',
    confirmText = '确定',
    cancelText = '取消',
    confirmColor = '#FF4D4F'
  }) {
    return new Promise(resolve => {
      if (this._dialog) {
        this._dialog.setData({
          title,
          content,
          visible: true,
          confirmText,
          cancelText,
          buttonVariant: 'outline'
        });
        this._dialogResolve = resolve;
        this._dialogConfirmHandler = () => resolve(true);
        this._dialogCancelHandler = () => resolve(false);
      } else {
        wx.showModal({ title, content, confirmColor, success: res => resolve(res.confirm) });
      }
    });
  },

  // ==========================================
  // 输入处理（t-input change 事件）
  // ==========================================

  onPhoneInput(e) {
    const value = this._inputDetail(e);
    // 限制只能输入数字
    const numericValue = value.replace(/\D/g, '').slice(0, 11);
    this.setData({
      step1Phone: numericValue,
      step1PhoneError: ''
    });
  },

  onNameInput(e) {
    const value = this._inputDetail(e).replace(/\s/g, ''); // 去除空格
    this.setData({ 'formData.name': value, 'formData.nameError': '' });
  },

  onAddressInput(e) {
    this.setData({ 'formData.address': this._inputDetail(e).trim(), 'formData.addressError': '' });
  },

  onSmsCodeInput(e) {
    const value = this._inputDetail(e).replace(/\D/g, '').slice(0, 6);
    this.setData({ smsCode: value, smsCodeError: '' });
  },

  // Vant选择器方法
  showStorePickerPopup() {
    if (!this.data.stores.length) {
      this._showToast('暂无可选门店');
      return;
    }
    // 初始化门店名称列表
    const storeNames = this.data.stores.map(store => this._formatStorePickerLabel(store));
    this.setData({ storeNames, showStorePicker: true });
  },

  hideStorePicker() {
    this.setData({ showStorePicker: false });
  },

  onStorePickerConfirm(e) {
    const rawIndex = e.detail && e.detail.index;
    const rawValue = e.detail && e.detail.value;
    const index = Array.isArray(rawIndex) ? Number(rawIndex[0]) : Number(rawIndex);
    const store = this.data.stores[index];
    const matchedStore = store || this.data.stores.find(item => this._formatStorePickerLabel(item) === rawValue || item.name === rawValue);
    if (matchedStore) {
      this.setData({
        'formData.storeId': matchedStore.id,
        'formData.storeName': matchedStore.name,
        storeInfo: matchedStore,
        showStorePicker: false
      });
    } else {
      this.setData({ showStorePicker: false });
    }
  },

  onStoreChange(e) {
    const index = Number(e.detail.value);
    const store = this.data.stores[index];
    if (store) {
      this.setData({
        'formData.storeId': store.id,
        'formData.storeName': store.name,
        storeInfo: store
      });
    }
  },

  /**
   * 手动切换门店（当有多个附近门店时）
   */
  onSwitchStore() {
    // 显示门店列表弹窗或 picker
    const stores = this.data.stores;
    if (!stores || stores.length === 0) {
      this._showToast('暂无可用门店');
      return;
    }

    // 统一使用 Vant Picker
    this.showStorePickerPopup();
  },

  onAgreeChange(e) {
    const detail = e && e.detail;
    const values = Array.isArray(detail)
      ? detail
      : Array.isArray(detail && detail.value)
        ? detail.value
        : [];
    this.setData({ agreed: values.includes('agreed') });
  },

  // ==========================================
  // 步骤1：提交手机号
  // ==========================================

  async submitPhone() {
    // 【防抖】防止快速连击
    if (this.data.isSubmitting) {
      return;
    }

    const phone = this.data.step1Phone;

    // 【安全校验】手机号格式验证（适配国内最新号段）
    const validation = this._validatePhone(phone);
    if (!validation.valid) {
      this.setData({ step1PhoneError: validation.message });
      return;
    }

    this.setData({ isSubmitting: true, step1PhoneError: '' });
    wx.showLoading({ title: '提交中...', mask: true });

    try {
      const storeId = this.data.storeInfo?.id || 'S001';
      const res = await businessAPI.submitPhone(phone, storeId);

      if (res.code === 200) {
        this.setData({
          contractId: res.data.contractId,
          currentStep: 2,
          contractStatus: res.data.status,
          contractInfo: {},
          maskPhone: this._maskPhone(phone),
          statusText: '核验中',
          statusStyle: 'process',
          statusDesc: '管理员正在核验您的合约资格'
        });
        this._startPolling();
        this._showSuccess('提交成功');
        
        // 上报埋点：合约申请提交成功
        Analytics.track(AnalyticsEvents.CONTRACT_SUBMIT, {
          contractId: res.data.contractId,
          storeId: storeId,
          phone: phone
        });
      } else {
        this.setData({ step1PhoneError: res.message || '核验失败，请稍后重试' });
      }
    } catch (error) {
      console.error('submitPhone 错误:', error);
      this._showToast('网络异常，请检查网络后重试');
    } finally {
      this.setData({ isSubmitting: false });
      wx.hideLoading();
    }
  },

  // ==========================================
  // 步骤3：填写收货信息
  // ==========================================

  async submitOrderInfo() {
    // 【防抖】
    if (this.data.isSubmitting) {
      return;
    }

    const { name, address, storeId } = this.data.formData;

    // 【安全校验】协议勾选
    if (!this.data.agreed) {
      this._showToast('请先阅读并勾选同意《用户协议》');
      return;
    }

    // 【安全校验】姓名
    if (!name || name.length < 2) {
      this.setData({ 'formData.nameError': '请输入正确的收货人姓名（至少2个字符）' });
      return;
    }
    if (name.length > 20) {
      this.setData({ 'formData.nameError': '收货人姓名过长' });
      return;
    }

    // 【安全校验】地址
    if (!address || address.length < 5) {
      this.setData({ 'formData.addressError': '请填写详细的收货地址（至少5个字符）' });
      return;
    }
    if (address.length > 100) {
      this.setData({ 'formData.addressError': '收货地址过长' });
      return;
    }

    // 【安全校验】门店
    if (!storeId) {
      this._showToast('请选择领取门店');
      return;
    }

    this.setData({ isSubmitting: true });
    wx.showLoading({ title: '提交中...', mask: true });

    try {
      const res = await businessAPI.submitOrderInfo(this.data.contractId, {
        name,
        address,
        storeId,
        storeName: this.data.formData.storeName
      });

      if (res.code === 200) {
        this.setData({
          currentStep: 4,
          contractStatus: res.data.status,
          statusText: '待验证码',
          statusStyle: 'default',
          statusDesc: '请填写下发的验证码'
        });
        this._showSuccess('信息已提交');
      } else {
        this._showToast(res.message || '提交失败，请重试');
      }
    } catch (error) {
      console.error('submitOrderInfo 错误:', error);
      this._showToast('网络异常，请检查网络后重试');
    } finally {
      this.setData({ isSubmitting: false });
      wx.hideLoading();
    }
  },

  // ==========================================
  // 步骤4：填写验证码
  // ==========================================

  /**
   * 验证码过期处理
   * 用户可以重新输入新收到的验证码，无需额外操作
   */
  onResendSmsCode() {
    wx.showModal({
      title: '验证码过期？',
      content: '验证码由中国移动系统发送，有效期通常为几分钟。\n\n如果验证码已过期，请：\n1. 等待中国移动发送新的验证码短信\n2. 收到新验证码后直接在上方输入框填写即可\n\n如长时间未收到验证码，请联系门店工作人员。',
      showCancel: false,
      confirmText: '我知道了'
    });
  },

  async submitSmsCode() {
    // 【防抖】
    if (this.data.isSubmitting) {
      return;
    }

    const smsCode = this.data.smsCode;

    // 【安全校验】验证码格式
    if (!smsCode || smsCode.length !== 6) {
      this.setData({ smsCodeError: '请输入6位数字验证码' });
      return;
    }
    if (!/^\d{6}$/.test(smsCode)) {
      this.setData({ smsCodeError: '验证码格式错误' });
      return;
    }

    this.setData({ isSubmitting: true, smsCodeError: '' });
    wx.showLoading({ title: '验证中...', mask: true });

    try {
      const res = await businessAPI.submitSmsCode(this.data.contractId, smsCode);

      if (res.code === 200) {
        this.setData({
          currentStep: 5,
          contractStatus: res.data.status,
          statusText: '办理中',
          statusStyle: 'process',
          statusDesc: '管理员正在为您办理合约'
        });
        this._startPolling();
        this._showSuccess('验证通过');
        
        // 上报埋点：验证码验证成功
        Analytics.track(AnalyticsEvents.CONTRACT_VERIFY_SMS, {
          contractId: this.data.contractId,
          success: true
        });
      } else {
        this.setData({ smsCodeError: res.message || '验证码错误' });
        
        // 上报埋点：验证码验证失败
        Analytics.track(AnalyticsEvents.CONTRACT_VERIFY_SMS, {
          contractId: this.data.contractId,
          success: false,
          error: res.message
        });
      }
    } catch (error) {
      console.error('submitSmsCode 错误:', error);
      this._showToast('网络异常，请检查网络后重试');
    } finally {
      this.setData({ isSubmitting: false });
      wx.hideLoading();
    }
  },

  // ==========================================
  // 新办业务
  // ==========================================

  async onCreateNewContract() {
    const confirmed = await new Promise(resolve => {
      wx.showModal({
        title: '新办业务',
        content: '确定要办理新业务吗？当前业务的办理记录将保留在系统中。',
        confirmText: '确定',
        confirmColor: '#07C160',
        cancelText: '取消',
        success: res => resolve(res.confirm)
      });
    });

    if (!confirmed) return;

    try {
      wx.showLoading({ title: '处理中...', mask: true });
      const res = await businessAPI.createNewContract();

      if (res.code !== 200) {
        wx.hideLoading();
        this._showToast(res.message || '无法创建新业务');
        return;
      }

      // 重置页面状态
      this.setData({
        currentStep: 1,
        contractId: '',
        contractStatus: 0,
        statusText: '',
        statusStyle: '',
        statusDesc: '',
        maskPhone: '',
        smsCode: '',
        smsCodeError: '',
        formData: {
          name: '',
          nameError: '',
          address: '',
          addressError: '',
          storeId: '',
          storeName: ''
        }
      });

      this._stopPolling();
      wx.hideLoading();
      wx.showToast({
        title: '可以开始办理新业务',
        icon: 'success',
        duration: 2000
      });
    } catch (error) {
      wx.hideLoading();
      console.error('创建新业务失败:', error);
      wx.showToast({
        title: '操作失败，请稍后重试',
        icon: 'none',
        duration: 2000
      });
    }
  },

  // ==========================================
  // 页面跳转
  // ==========================================

  goToCoupon() {
    wx.switchTab({ url: '/pages/coupon/coupon' });
  },

  onCopyTrackingNo() {
    const trackingNo = String((this.data.contractInfo && this.data.contractInfo.trackingNo) || '').trim();
    if (!trackingNo) {
      this._showToast('暂无快递单号');
      return;
    }
    wx.setClipboardData({
      data: trackingNo,
      success: () => this._showSuccess('快递单号已复制'),
      fail: () => this._showToast('复制失败，请手动记录')
    });
  },

  // ==========================================
  // 表单安全校验
  // ==========================================

  /**
   * 增强版手机号验证
   * 适配国内最新号段：13(0-9), 14(5-9), 15(0-9 except 14), 16, 17(0-8), 18, 19
   */
  _validatePhone(phone) {
    if (!phone) {
      return { valid: false, message: '请输入手机号码' };
    }
    if (phone.length !== 11) {
      return { valid: false, message: '请输入11位手机号码' };
    }
    // 严格号段验证
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      return { valid: false, message: '手机号码格式不正确' };
    }
    return { valid: true };
  },

  /**
   * 手机号脱敏
   */
  _maskPhone(phone) {
    if (!phone || phone.length < 7) return phone || '';
    return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
  },

  _resolveExpressCompanyName(contract = {}) {
    const code = String(
      contract.expressCompanyCode
      || contract.deliveryId
      || contract.companyCode
      || ''
    ).trim().toLowerCase();
    const codeMap = {
      shunfeng: '顺丰速运',
      ems: 'EMS',
      yuantong: '圆通速递',
      zhongtong: '中通快递',
      shentong: '申通快递',
      yunda: '韵达快递'
    };
    if (code && codeMap[code]) {
      return codeMap[code];
    }

    const trackingNo = String(contract.trackingNo || '').trim().toUpperCase();
    if (trackingNo.startsWith('SF')) return '顺丰速运';
    if (trackingNo.startsWith('YT')) return '圆通速递';
    if (trackingNo.startsWith('ZT')) return '中通快递';
    if (trackingNo.startsWith('ST')) return '申通快递';
    if (trackingNo.startsWith('YD')) return '韵达快递';
    if (trackingNo.startsWith('EMS')) return 'EMS';
    return '快递单号';
  },

  // ==========================================
  // 状态轮询（防内存泄漏）
  // ==========================================

  _checkAndStartPolling() {
    const status = this.data.contractStatus;
    const shouldPoll = this.data.contractId && [
      STATES.WAIT_VERIFY,
      STATES.CONTRACTING,
      STATES.CONTRACT_OK
    ].includes(status);

    if (shouldPoll) {
      this._startPolling();
    }
  },

  async _loadContractStatus(contractId) {
    if (!contractId) return;

    try {
      const res = await businessAPI.getContractStatus(contractId);
      if (res.code === 200) {
        this._updateUIByStatus(res.data);
      }
    } catch (e) {
      console.error('_loadContractStatus 错误:', e);
    }
  },

  _startPolling() {
    // 先停止现有定时器，避免重复
    this._stopPolling();

    this._pollingTimer = setInterval(() => {
      if (this.data.contractId) {
        this._loadContractStatus(this.data.contractId);
      } else {
        this._stopPolling();
      }
    }, 3000);
  },

  _stopPolling() {
    if (this._pollingTimer) {
      clearInterval(this._pollingTimer);
      this._pollingTimer = null;
    }
  },

  // ==========================================
  // UI 状态更新
  // ==========================================

  _updateUIByStatus(contract) {
    if (!contract) return;

    const status = contract.status;
    const statusMap = {
      [STATES.WAIT_VERIFY]: {
        step: 2,
        text: '核验中',
        style: 'process',
        desc: '管理员正在核验资格'
      },
      [STATES.QUALIFIED]: {
        step: 3,
        text: '核验通过',
        style: 'success',
        desc: '请填写收货信息'
      },
      [STATES.WAIT_SMSCODE]: {
        step: 4,
        text: '待验证码',
        style: 'default',
        desc: '请填写验证码'
      },
      [STATES.CONTRACTING]: {
        step: 5,
        text: '办理中',
        style: 'process',
        desc: '管理员正在办理合约'
      },
      [STATES.CONTRACT_OK]: {
        step: 6,
        text: '合约已办',
        style: 'success',
        desc: '等待发货中'
      },
      [STATES.SHIPPED]: {
        step: 6,
        text: '已发货',
        style: 'success',
        desc: '终端已发出，请留意快递单号'
      },
      [STATES.SIGNED]: {
        step: 6,
        text: '已完成',
        style: 'success',
        desc: ''
      },
      [STATES.SMS_CODE_REJECTED]: {
        step: 4,
        text: '验证码无效',
        style: 'error',
        desc: '请重新输入验证码'
      }
    };

    const info = statusMap[status] || {
      step: 1,
      text: '待提交',
      style: 'default',
      desc: '请输入手机号'
    };

    this.setData({
      contractId: contract.id,
      currentStep: info.step,
      contractStatus: status,
      statusText: info.text,
      statusStyle: info.style,
      statusDesc: info.desc,
      maskPhone: this._maskPhone(contract.phone || ''),
      'formData.name': contract.name || this.data.formData.name || '',
      'formData.address': contract.address || this.data.formData.address || '',
      'formData.storeId': contract.storeId || this.data.formData.storeId || '',
      'formData.storeName': contract.storeName || this.data.formData.storeName || '',
      storeInfo: contract.storeId
        ? (this.data.stores.find(store => store.id === contract.storeId) || {
            id: contract.storeId,
            name: contract.storeName,
            address: (this.data.storeInfo && this.data.storeInfo.address) || ''
          })
        : this.data.storeInfo,
      contractInfo: contract,
      expressCompanyName: this._resolveExpressCompanyName(contract)
    });

    // 验证码被驳回时，显示弹窗提示
    if (status === STATES.SMS_CODE_REJECTED) {
      // 过滤掉管理员的提示文案，只保留驳回原因
      let reason = contract.smsCodeRejectReason || '验证码无效或已过期';
      // 如果包含管理员提示，使用默认文案
      if (reason.includes('确定驳回') || reason.includes('驳回后用户')) {
        reason = '验证码无效或已过期';
      }

      wx.showModal({
        title: '验证码无效',
        content: `${reason}\n\n请等待中国移动发送新的验证码短信，收到后请重新输入。`,
        showCancel: false,
        confirmText: '我知道了',
        success: () => {
          // 清空之前输入的验证码
          this.setData({ smsCode: '', smsCodeError: '' });
        }
      });
      this._stopPolling();
      return;
    }

    // 等待用户输入或物流已完成时停止轮询，避免打断表单输入
    const isProcessCompleted = status === STATES.SHIPPED || status === STATES.SIGNED;
    if (isProcessCompleted || status === STATES.QUALIFIED || status === STATES.WAIT_SMSCODE) {
      this._stopPolling();
    }
  }
});
