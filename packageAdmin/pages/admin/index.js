// pages/admin/index.js - 管理后台 V2.0
// ============================================================
// 【开发规划说明】阶段三-Admin端操作减负
// ============================================================
// 当前手机端管理页面存在功能过重的问题，按照 V2.0 规划，应进行如下拆分：
//
// 【保留在手机端（轻量操作）】
// 1. 合约状态审批 - 核验资格、通过/拒绝
// 2. 订单发货 - 填写快递单号
// 3. 轻量级数据概览 - 今日数据、本周数据
//
// 【应剥离到 PC Web 端管理后台（重度操作）】
// 1. 新建门店管理 - 门店信息维护、店长账号绑定
// 2. 代金券规则配置 - 金额、有效期、数量限制等
// 3. 管理员账号管理 - 增删改查、权限分配
// 4. 批量操作功能 - 批量发货、批量导出
// 5. 数据统计分析 - 完整报表、趋势分析
//
// 【后续开发建议】
// 1. PC 端使用 Vue/React + Ant Design 构建管理后台
// 2. 与小程序共享同一套后端 API
// 3. 手机端仅保留紧急/外出时的轻量操作能力
// ============================================================

const { businessAPI, STATES } = require('../../../utils/business-api');
const { callCloudFunction } = require('../../../utils/cloud');
const { Analytics, AnalyticsEvents } = require('../../../utils/analytics');
const { 
  getProvinces, 
  getCities, 
  getDistricts, 
  getFullAddress, 
  checkStoreFilter,
  getStoreStats 
} = require('../../utils/region');

const STORE_SCOPE_OPTIONS = [
  { label: '仅限绑定门店', value: 'bound' },
  { label: '全部门店',     value: 'all' }
];
const STORE_SCOPE_LABELS = STORE_SCOPE_OPTIONS.map(o => o.label);

Page({
  data: {
    activeTab: 'contract',
    isCloudMode: false,

    // 合约管理
    contractFilter: -1,
    pendingCount: 0,
    processingCount: 0,
    waitShipCount: 0,
    rejectedCount: 0,
    contracts: [],
    contractsAll: [],
    // 当前正在处理的合约 id（控制按钮 loading）
    processingId: '',

    // 代金券管理
    canManageCouponOps: false,
    couponStats: { total: 0, available: 0, used: 0, totalAmount: 0 },
    usageRecords: [],
    usageByMonth: [],
    couponRules: [],
    showAddRuleForm: false,
    storeScopeOptions: STORE_SCOPE_OPTIONS,
    savingRule: false,
    // 导出对账单
    exportMonthOptions: [],
    contractExportMonthIndex: 0,
    couponExportMonthOptions: [],
    couponExportMonthIndex: 0,
    contractExportStats: { count: 0, amount: 0 },
    couponExportStats: { count: 0, amount: 0 },
    downloading: false,
    newRule: {
      name: '',
      amountStr: '20',
      totalCountStr: '5',
      validMonthsStr: '5',
      monthlyLimitStr: '1',
      storeScopeIndex: 0,
      notes: ''
    },
    // 带选中标记的门店列表（WXML无法直接用.includes，需预处理）
    ruleStoresWithSelected: [],
    ruleSelectedCount: 0,  // 选中的门店数量（WXML无法计算.length）

    // 门店管理
    stores: [],
    filteredStores: [],
    canManageStoreSetup: false,
    storeSearchKeyword: '',
    storeFilterProvince: '全部',
    storeFilterCity: '全部',
    storeFilterDistrict: '全部',
    storeProvinces: [],
    storeCities: [],
    storeDistricts: [],
    newStore: {
      name: '',
      province: '',
      city: '',
      district: '',
      address: '',
      owner: '',
      phone: '',
      location: null,       // { lat, lng }
      regionValue: [],    // 省市区选择器值 [provinceCode, cityCode, districtCode]
      regionText: ''      // 显示文本 "山西省 太原市 迎泽区"
    },
    phoneBindError: '',
    editingStoreId: '',
    swipeActiveIdx: -1,
    _touchStartX: 0,
    savingStore: false,
    regionPickerVisible: false,
    regionPickerType: 'province', // province/city/district
    regionPickerData: [],

    // 管理员管理
    admins: [],
    currentAdmin: null,
    canManageAdmins: false,
    canEditOtherAdmins: false,  // 是否可以编辑其他管理员
    newAdmin: { name: '', phone: '' },
    savingAdmin: false,
    adminSwipeActiveIdx: -1,
    editingAdminId: '',
    _adminTouchStartX: 0,

    exportMonthLabels: [],
    couponExportMonthLabels: [],
    storeScopeLabels: STORE_SCOPE_LABELS
  },

  onLoad(options = {}) {
    const ToastLib = require('@vant/weapp/toast/toast');
    const Toast = ToastLib.default || ToastLib;
    const DialogLib = require('@vant/weapp/dialog/dialog');
    const Dialog = DialogLib.default || DialogLib;
    Toast.setDefaultOptions({ selector: '#van-toast' });
    Dialog.setDefaultOptions({ selector: '#van-dialog' });
    this._Toast = Toast;
    this._Dialog = Dialog;
    this._entryTab = this._normalizeTab(options.tab);
    this._ensureAdminAccess();
  },

  onShow() {
    if (this.data.currentAdmin) {
      this.loadAll();
    }
  },

  // ===== Toast / Dialog 辅助 =====
  _showToast(message) {
    // 直接使用原生 Toast，避免 Vant 兼容性问题
    wx.showToast({ title: message, icon: 'none', duration: 2000 });
  },

  _showSuccess(message) {
    // 直接使用原生 Toast，避免 Vant 兼容性问题
    wx.showToast({ title: message, icon: 'success', duration: 2000 });
  },

  _confirmDialog({ title, content, confirmText = '确定', cancelText = '取消', confirmColor = '#ee0a24' }) {
    if (!this._Dialog) {
      return new Promise(resolve => {
        wx.showModal({ title, content, confirmColor, success: res => resolve(res.confirm) });
      });
    }
    return this._Dialog.confirm({
      title,
      message: content,
      confirmButtonText: confirmText,
      cancelButtonText: cancelText,
      confirmButtonColor: confirmColor
    })
      .then(() => true)
      .catch(() => false);
  },

  _normalizeTab(tab) {
    const validTabs = ['contract', 'coupon', 'store', 'admins'];
    return validTabs.includes(tab) ? tab : '';
  },

  _ensureAdminAccess() {
    const app = getApp();
    app.verifyAdmin(
      (admin) => {
        const currentAdmin = admin || app.globalData.currentAdmin || null;
        if (!currentAdmin) {
          wx.showModal({
            title: '权限异常',
            content: '管理员身份信息已失效，请重新进入后台。',
            showCancel: false,
            success: () => {
              wx.reLaunch({ url: '/pages/launch/index' });
            }
          });
          return;
        }
        // 判断是否为超级管理员
        const isSuperAdmin = currentAdmin && (currentAdmin.roleKey === 'super_admin' || currentAdmin.id === 'super_admin');
        
        const nextData = {
          currentAdmin,
          isCloudMode: !!app.globalData.cloudReady,
          canManageStoreSetup: isSuperAdmin,
          canManageCouponOps: isSuperAdmin,
          canManageAdmins: isSuperAdmin
        };
        if (this._entryTab) {
          nextData.activeTab = this._entryTab;
          this._entryTab = '';
        }
        this.setData(nextData, () => {
          this.loadAll();
        });
      },
      (error) => {
        const message = (error && error.message) || '当前账号未开通管理后台权限，请联系运营配置后再试。';
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

  // ========== 合约管理 ==========

  switchTab(e) {
    let tab = typeof e === 'string' ? e : (e.detail && e.detail.name);
    if (tab == null || tab === '') {
      const names = ['contract', 'coupon', 'store', 'admins'];
      const idx = e.detail && typeof e.detail.index === 'number' ? e.detail.index : 0;
      tab = names[idx] || 'contract';
    }
    // 超级管理员可以访问所有tab
    const isSuperAdmin = this.data.currentAdmin && (this.data.currentAdmin.roleKey === 'super_admin' || this.data.currentAdmin.id === 'super_admin');
    if (!isSuperAdmin && (tab === 'coupon' || tab === 'store' || tab === 'admins')) {
      this._showToast('仅超级管理员可管理此模块');
      this.setData({ activeTab: 'contract' });
      return;
    }
    this.setData({ activeTab: tab });
    if (tab === 'contract') { this.loadContracts(); this._initExportOptions(); }
    if (tab === 'coupon') { this.loadCouponStats(); if (!this.data.couponExportMonthOptions.length) this._initExportOptions(); }
    if (tab === 'store')  this.loadStores();
    if (tab === 'admins') this.loadAdmins();
  },

  setContractFilter(e) {
    const val = Number(e.currentTarget.dataset.val);
    this.setData({ contractFilter: val }, () => {
      this._applyFilter();
    });
  },

  async loadContracts() {
    try {
      const res = await businessAPI.adminGetContracts();
      if (res.code !== 200) {
        // 只在真正的错误时提示，空数据不算错误
        if (res.code !== 404 && res.code !== 200) {
          console.warn('加载合约失败:', res.message);
        }
        this.setData({ 
          contractsAll: [], 
          pendingCount: 0, 
          processingCount: 0, 
          waitShipCount: 0, 
          rejectedCount: 0 
        });
        return;
      }

      const all = (res.data || []).map(c => ({
        ...c,
        // 管理员后台需要明文手机号用于核验
        statusText: this._getStatusText(c.status),
        statusClass: this._getStatusClass(c.status),
        createdAt: this._formatDate(c.createdAt),
        rawCreatedAt: c.createdAt || '',
        _trackingNo: c.trackingNo || ''
      }));

      const pendingCount = all.filter(c => c.status === STATES.WAIT_VERIFY).length;
      const processingCount = all.filter(c => c.status === STATES.CONTRACTING).length;
      const waitShipCount = all.filter(c => c.status === STATES.CONTRACT_OK).length;
      const rejectedCount = all.filter(c => c.status === STATES.REJECTED).length;

      this.setData({ contractsAll: all, pendingCount, processingCount, waitShipCount, rejectedCount }, () => {
        this._applyFilter();
      });
    } catch (error) {
      console.error('加载合约失败:', error);
      // 不显示错误提示，只记录日志
      this.setData({ 
        contractsAll: [], 
        pendingCount: 0, 
        processingCount: 0, 
        waitShipCount: 0, 
        rejectedCount: 0 
      });
    }
  },

  _applyFilter() {
    const filterVal = this.data.contractFilter;
    let contracts = this.data.contractsAll;
    if (filterVal === -1) {
      // 全部
    } else if (filterVal === 99) {
      contracts = contracts.filter(c => c.status >= STATES.CONTRACT_OK);
    } else {
      contracts = contracts.filter(c => c.status === filterVal);
    }
    this.setData({ contracts }, () => this._updateContractExportStats());
  },

  async passVerify(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ processingId: id });
    try {
      const res = await businessAPI.adminUpdateStatus(id, STATES.QUALIFIED);
      if (res && res.code === 200) {
        this._showSuccess('核验通过');
        
        // 上报埋点：审核通过
        Analytics.track(AnalyticsEvents.ADMIN_APPROVE, {
          contractId: id
        });
        
        this.loadContracts();
      } else {
        this._showToast((res && res.message) || '操作失败');
      }
    } catch (error) {
      console.error('核验通过失败:', error);
      this._showToast('操作失败，请稍后重试');
    } finally {
      this.setData({ processingId: '' });
    }
  },

  async rejectVerify(e) {
    const id = e.currentTarget.dataset.id;
    const confirmed = await this._confirmDialog({
      title: '确认拒绝',
      content: '拒绝后该合约申请将终止',
      confirmColor: '#FF4D4F'
    });
    if (confirmed) {
      this.setData({ processingId: id });
      try {
        const res = await businessAPI.adminUpdateStatus(id, STATES.REJECTED);
        if (res && res.code === 200) {
          this._showSuccess('已拒绝');
          
          // 上报埋点：审核拒绝
          Analytics.track(AnalyticsEvents.ADMIN_REJECT, {
            contractId: id
          });
          
          this.loadContracts();
        } else {
          this._showToast((res && res.message) || '操作失败');
        }
      } catch (error) {
        console.error('拒绝失败:', error);
        this._showToast('操作失败，请稍后重试');
      } finally {
        this.setData({ processingId: '' });
      }
    }
  },

  async completeContract(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ processingId: id });
    try {
      const res = await businessAPI.adminUpdateStatus(id, STATES.CONTRACT_OK);
      if (res && res.code === 200) {
        this._showSuccess('已标记完成，代金券已生成');
        this.loadContracts();
      } else {
        this._showToast((res && res.message) || '操作失败');
      }
    } catch (error) {
      console.error('标记完成失败:', error);
      this._showToast('操作失败，请稍后重试');
    } finally {
      this.setData({ processingId: '' });
    }
  },

  async rejectSmsCode(e) {
    const id = e.currentTarget.dataset.id;
    const phone = e.currentTarget.dataset.phone;

    // 弹窗让管理员输入驳回原因
    wx.showModal({
      title: '驳回验证码',
      content: '驳回后，用户需要重新输入新的验证码。',
      placeholderText: '请输入驳回原因（可选）',
      editable: true,
      confirmText: '确定驳回',
      confirmColor: '#ee0a24',
      cancelText: '取消',
      success: async (res) => {
        if (res.confirm) {
          this.setData({ processingId: id });
          try {
            // 只保存管理员输入的内容，不要包含提示文案
            const adminInput = (res.content || '').trim();
            const reason = adminInput || '验证码无效或已过期，请重新输入';
            const result = await businessAPI.adminUpdateStatus(id, STATES.SMS_CODE_REJECTED, {
              rejectReason: reason
            });
            if (result && result.code === 200) {
              this._showSuccess('已驳回，用户将收到提示');
              this.loadContracts();
            } else {
              this._showToast((result && result.message) || '操作失败');
            }
          } catch (error) {
            console.error('驳回验证码失败:', error);
            this._showToast('操作失败，请稍后重试');
          } finally {
            this.setData({ processingId: '' });
          }
        }
      }
    });
  },

  onTrackingInput(e) {
    const id = e.currentTarget.dataset.id;
    const val = this._inputDetail(e);
    const contracts = this.data.contracts.map(c => {
      if (c.id === id) return { ...c, _trackingNo: val };
      return c;
    });
    this.setData({ contracts });
  },

  async shipOrder(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.contracts.find(c => c.id === id);
    const trackingNo = (item && item._trackingNo) ? item._trackingNo : ('SF' + Date.now());
    this.setData({ processingId: id });
    try {
      const res = await businessAPI.adminUpdateStatus(id, STATES.SHIPPED, {
        trackingNo,
        shippedAt: new Date().toISOString()
      });
      if (res && res.code === 200) {
        this._showSuccess('已发货');
        this.loadContracts();
      } else {
        this._showToast((res && res.message) || '发货失败');
      }
    } catch (error) {
      console.error('确认发货失败:', error);
      this._showToast('发货失败，请稍后重试');
    } finally {
      this.setData({ processingId: '' });
    }
  },

  exportContracts() {
    const list = this.data.contractsAll;
    if (list.length === 0) {
      this._showToast('暂无记录');
      return;
    }
    let text = '===智机惠合约记录===\n';
    text += '手机号\t状态\t门店\t姓名\t地址\t快递单号\t日期\n';
    list.forEach(c => {
      text += `${c.phone}\t${c.statusText}\t${c.storeName}\t${c.name || ''}\t${c.address || ''}\t${c.trackingNo || ''}\t${c.createdAt}\n`;
    });
    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showModal({
          title: '已复制到剪贴板',
          content: `共 ${list.length} 条记录，请粘贴到微信/备忘录/Excel 中保存。`,
          showCancel: false,
          confirmText: '好的'
        });
      }
    });
  },

  // ========== 对账导出 ==========

  _buildMonthOptions() {
    const now = new Date();
    const options = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      options.push({
        value: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
        label: `${d.getFullYear()}年${d.getMonth()+1}月`
      });
    }
    return options;
  },

  _initExportOptions() {
    const monthOpts = this._buildMonthOptions();
    const labels = monthOpts.map(m => m.label);
    this.setData({
      exportMonthOptions: monthOpts,
      couponExportMonthOptions: monthOpts,
      exportMonthLabels: labels,
      couponExportMonthLabels: labels,
      contractExportMonthIndex: 0,
      couponExportMonthIndex: 0
    }, () => this._updateExportStats());
  },

  onContractMonthPick(e) {
    const idx = Number(e.detail.value);
    this.setData({ contractExportMonthIndex: idx }, () => this._updateContractExportStats());
  },

  onCouponMonthPick(e) {
    const idx = Number(e.detail.value);
    this.setData({ couponExportMonthIndex: idx }, () => this._updateCouponExportStats());
  },

  onRuleScopePick(e) {
    const idx = Number(e.detail.value);
    this.setData({ 'newRule.storeScopeIndex': idx }, () => {
      if (idx === 1) {
        this.setData({ 'newRule.selectedStores': [] });
      }
    });
  },

  _updateExportStats() {
    this._updateContractExportStats();
    this._updateCouponExportStats();
  },

  _updateContractExportStats() {
    const opts = this.data.exportMonthOptions;
    if (!opts || !opts[this.data.contractExportMonthIndex]) {
      console.log('合约月份选项未初始化');
      return;
    }
    const targetMonth = opts[this.data.contractExportMonthIndex].value;
    let count = 0;
    let amount = 0;

    console.log('合约月份筛选:', targetMonth, '总记录数:', (this.data.contractsAll || []).length);

    (this.data.contractsAll || []).forEach(c => {
      const createdAt = c.createdAt || '';
      // 处理格式化的日期 (YYYY-MM-DD) 
      let createdMonth = '';
      if (createdAt.includes('-')) {
        createdMonth = createdAt.substring(0, 7);
      } else if (c.rawCreatedAt) {
        // 如果有原始创建时间
        const rawDate = new Date(c.rawCreatedAt);
        createdMonth = `${rawDate.getFullYear()}-${String(rawDate.getMonth()+1).padStart(2,'0')}`;
      }
      
      if (createdMonth === targetMonth) {
        count++;
        // 如果已签收/已发货，计算代金券金额
        if (c.status >= STATES.SHIPPED) amount += 100; // 假设每笔合约对应100元代金券
      }
    });

    console.log('合约统计结果:', { count, amount });
    this.setData({ contractExportStats: { count, amount } });
  },

  _updateCouponExportStats() {
    const opts = this.data.couponExportMonthOptions;
    if (!opts || !opts[this.data.couponExportMonthIndex]) {
      console.log('代金券月份选项未初始化');
      return;
    }
    const targetMonth = opts[this.data.couponExportMonthIndex].value;
    let count = 0;
    let amount = 0;

    console.log('代金券月份筛选:', targetMonth, '核销记录数:', (this.data.usageRecords || []).length);

    const records = this.data.usageRecords || [];
    records.forEach(r => {
      const usedAt = r.usedAt || '';
      let usedMonth = '';
      if (usedAt.includes('-')) {
        usedMonth = usedAt.substring(0, 7);
      } else if (r.rawUsedAt) {
        // 如果有原始使用时间
        const rawDate = new Date(r.rawUsedAt);
        usedMonth = `${rawDate.getFullYear()}-${String(rawDate.getMonth()+1).padStart(2,'0')}`;
      }
      
      if (usedMonth === targetMonth) {
        count++;
        amount += (r.amount || 0);
      }
    });

    console.log('代金券统计结果:', { count, amount });
    this.setData({ couponExportStats: { count, amount } });
  },

  // 生成 CSV 文件并保存到本地
  downloadContractReport() {
    const opts = this.data.exportMonthOptions;
    const targetMonth = opts[this.data.contractExportMonthIndex].value;
    const label = opts[this.data.contractExportMonthIndex].label;
    
    // 筛选该月数据
    const rows = (this.data.contractsAll || []).filter(c => {
      return (c.createdAt || '').substring(0, 7) === targetMonth;
    }).map(c => [
      c.phone || '',
      c.statusText || '',
      c.storeName || '',
      c.name || '',
      c.address || '',
      c.trackingNo || '',
      c.createdAt ? this._formatDate(c.createdAt) : ''
    ]);

    if (rows.length === 0) {
      this._showToast('该月份暂无记录');
      return;
    }

    const header = ['手机号', '状态', '门店', '客户姓名', '收货地址', '快递单号', '创建日期'];
    const content = this._generateCSV(header, rows);

    const fileName = `智机惠合约对账_${targetMonth}.csv`;
    this._saveFile(content, fileName);
  },

  downloadCouponReport() {
    const opts = this.data.couponExportMonthOptions;
    const targetMonth = opts[this.data.couponExportMonthIndex].value;

    const rows = (this.data.usageRecords || []).filter(r => {
      return (r.usedAt || '').substring(0, 7) === targetMonth;
    }).map(r => [
      r.phone || '',
      r.storeName || '',
      r.amount || 0,
      r.usedAtStr || ''
    ]);

    if (rows.length === 0) {
      this._showToast('该月份暂无核销记录');
      return;
    }

    const header = ['手机号', '门店', '核销金额', '核销时间'];
    const content = this._generateCSV(header, rows);

    const fileName = `智机惠核销对账_${targetMonth}.csv`;
    this._saveFile(content, fileName);
  },

  _generateCSV(header, rows) {
    // 添加 BOM 头以支持 Excel 中文显示
    let csv = '\uFEFF';
    csv += header.map(h => `"${h}"`).join(',') + '\n';
    rows.forEach(row => {
      csv += row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',') + '\n';
    });
    return csv;
  },

  _saveFile(content, fileName) {
    this.setData({ downloading: true });
    const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`;
    wx.getFileSystemManager().writeFile({
      filePath,
      data: content,
      encoding: 'utf-8',
      success: () => {
        this.setData({ downloading: false });
        // 直接弹出分享面板
        wx.showModal({
          title: '文件已生成',
          content: `文件已保存：${fileName}\n\n点击"转发"发送到微信聊天，或点击"复制"粘贴到备忘录/Excel中保存。`,
          confirmText: '转发',
          cancelText: '复制内容',
          success: (res) => {
            if (res.confirm) {
              // 转发文件
              wx.shareFileMessage({
                filePath,
                fileName,
                success: () => {
                  this._showSuccess('已发送');
                },
                fail: (err) => {
                  console.error('分享失败:', err);
                  // 分享失败则打开文档
                  wx.openDocument({
                    filePath,
                    showMenu: true,
                    fail: () => {
                      this._showToast('请在微信聊天中查看');
                    }
                  });
                }
              });
            } else if (res.cancel) {
              // 复制内容
              wx.setClipboardData({
                data: content.replace('\uFEFF', ''),
                success: () => {
                  this._showSuccess('内容已复制，可粘贴到备忘录或Excel');
                }
              });
            }
          }
        });
      },
      fail: (err) => {
        console.error('写入文件失败:', err);
        this.setData({ downloading: false });
        // 降级方案：复制到剪贴板
        wx.setClipboardData({
          data: content.replace('\uFEFF', ''),
          success: () => {
            this._showToast('已生成CSV，内容已复制到剪贴板，可粘贴到备忘录或Excel');
          }
        });
      }
    });
  },

  // ========== 代金券管理 ==========

  async loadCouponStats() {
    if (!this.data.canManageCouponOps) {
      this.setData({
        couponStats: { total: 0, available: 0, used: 0, totalAmount: 0 },
        usageRecords: [],
        usageByMonth: [],
        couponRules: []
      });
      return;
    }
    try {
      // 加载代金券规则
      const rulesRes = await businessAPI.getCouponRules();
      const rules = (rulesRes && rulesRes.code === 200) ? (rulesRes.data || []) : [];

      // 云模式下代金券统计数据需要通过查询合约和代金券汇总
      // 当前统计数据显示在管理后台
      this.setData({
        couponStats: { total: 0, available: 0, used: 0, totalAmount: 0 },
        usageRecords: [],
        usageByMonth: [],
        couponRules: rules
      }, () => {
        this._updateCouponExportStats();
      });
    } catch (e) {
      console.error('加载代金券统计失败:', e);
    }
  },

  toggleAddRuleForm() {
    // 计算带选中标记的门店列表(使用全部门店,而非筛选后的)
    const selectedIds = this.data.newRule.selectedStores || [];
    const withSelected = this.data.stores.map(store => ({
      ...store,
      selected: selectedIds.includes(store.id)
    }));
    this.setData({
      showAddRuleForm: !this.data.showAddRuleForm,
      newRule: { 
        name: '', 
        amountStr: '20', 
        totalCountStr: '5', 
        validMonthsStr: '5', 
        monthlyLimitStr: '1', 
        storeScopeIndex: 0, 
        notes: '', 
        selectedStores: [] 
      },
      ruleStoresWithSelected: withSelected,
      ruleSelectedCount: 0  // 重置为0
    });
  },

  onRuleName(e)         { this.setData({ 'newRule.name': this._inputDetail(e) }); },
  onRuleAmount(e)       { this.setData({ 'newRule.amountStr': this._inputDetail(e) }); },
  onRuleCount(e)        { this.setData({ 'newRule.totalCountStr': this._inputDetail(e) }); },
  onRuleMonths(e)       { this.setData({ 'newRule.validMonthsStr': this._inputDetail(e) }); },
  onRuleMonthlyLimit(e) { this.setData({ 'newRule.monthlyLimitStr': this._inputDetail(e) }); },
  onRuleNotes(e)        { this.setData({ 'newRule.notes': this._inputDetail(e) }); },

  /** Vant field / search 的 detail 可能是字符串或 { value } */
  _inputDetail(e) {
    const d = e.detail;
    if (d == null) return '';
    if (typeof d === 'string' || typeof d === 'number') return String(d);
    if (typeof d === 'object' && d.value != null) return String(d.value);
    return '';
  },

  // 切换代金券绑定的门店
  toggleRuleStore(e) {
    const storeId = e.currentTarget.dataset.id;
    const selected = this.data.newRule.selectedStores || [];
    const idx = selected.indexOf(storeId);
    if (idx > -1) {
      selected.splice(idx, 1);
    } else {
      selected.push(storeId);
    }
    // 更新带选中标记的门店列表
    const withSelected = this.data.ruleStoresWithSelected.map(store => ({
      ...store,
      selected: selected.includes(store.id)
    }));
    this.setData({ 
      'newRule.selectedStores': selected,
      ruleStoresWithSelected: withSelected,
      ruleSelectedCount: selected.length  // 更新选中数量
    });
  },

  async saveRule() {
    const r = this.data.newRule;
    if (!r.name) { this._showToast('请填写代金券名称'); return; }
    const amount       = parseFloat(r.amountStr);
    const totalCount   = parseInt(r.totalCountStr);
    const validMonths  = parseInt(r.validMonthsStr);
    const monthlyLimit = parseInt(r.monthlyLimitStr);
    if (!amount || amount <= 0)       { this._showToast('面额必须大于0'); return; }
    if (!totalCount || totalCount <= 0){ this._showToast('数量必须大于0'); return; }
    if (!validMonths || validMonths <= 0){ this._showToast('有效期必须大于0'); return; }
    if (!monthlyLimit || monthlyLimit <= 0){ this._showToast('每月限用必须大于0'); return; }
    if (r.storeScopeIndex === 0 && (!r.selectedStores || r.selectedStores.length === 0)) {
      this._showToast('请选择至少一个绑定门店'); return;
    }

    const storeScope = STORE_SCOPE_OPTIONS[r.storeScopeIndex].value;
    this.setData({ savingRule: true });

    try {
      const res = await businessAPI.createCouponRule({
        name: r.name,
        amount,
        totalCount,
        validMonths,
        monthlyLimit,
        storeScope,
        selectedStores: r.storeScopeIndex === 0 ? (r.selectedStores || []) : [],
        notes: r.notes
      });

      if (res && res.code === 200) {
        this._showSuccess('代金券规则已保存');
        this.setData({
          showAddRuleForm: false,
          newRule: {
            name: '',
            amountStr: '20',
            totalCountStr: '5',
            validMonthsStr: '5',
            monthlyLimitStr: '1',
            storeScopeIndex: 0,
            notes: '',
            selectedStores: []
          }
        });
        this.loadCouponStats();
      } else {
        this._showToast((res && res.message) || '保存失败');
      }
    } catch(e) {
      console.error('保存规则失败:', e);
      this._showToast('保存失败');
    } finally {
      this.setData({ savingRule: false });
    }
  },

  async deleteRule(e) {
    const id = e.currentTarget.dataset.id;
    const confirmed = await this._confirmDialog({
      title: '确认删除',
      content: '删除后不可恢复，已发放的代金券不受影响',
      confirmColor: '#FF4D4F'
    });
    if (confirmed) {
      try {
        const res = await businessAPI.deleteCouponRule(id);
        if (res && res.code === 200) {
          this._showSuccess('已删除');
          this.loadCouponStats();
        } else {
          this._showToast((res && res.message) || '删除失败');
        }
      } catch (error) {
        console.error('删除规则失败:', error);
        this._showToast('删除失败');
      }
    }
  },

  exportCoupons() {
    const records = this.data.usageRecords;
    if (records.length === 0) {
      this._showToast('暂无核销记录');
      return;
    }
    let text = '===智机惠代金券核销记录===\n';
    text += '手机号\t门店\t金额\t核销时间\n';
    records.forEach(r => {
      text += `${r.phone}\t${r.storeName}\t¥${r.amount}\t${r.usedAt}\n`;
    });
    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showModal({
          title: '已复制到剪贴板',
          content: `共 ${records.length} 条核销记录，请粘贴保存。`,
          showCancel: false,
          confirmText: '好的'
        });
      }
    });
  },

  // ========== 门店管理 ==========

  async loadStores() {
    if (!this.data.canManageStoreSetup) {
      this.setData({
        stores: [],
        filteredStores: [],
        swipeActiveIdx: -1,
        storeProvinces: ['全部'],
        storeCities: ['全部'],
        storeDistricts: ['全部']
      });
      return;
    }

    try {
      let stores = [];

      const res = await businessAPI.adminGetStores();
      if (res.code === 200) {
        stores = res.data || [];
      } else if (res.code !== 404) {
        console.warn('加载门店失败:', res.message);
      }

      // 为门店添加完整地址显示
      const storesWithFullAddress = stores.map(store => ({
        ...store,
        id: store.storeId || store.id || '',
        fullAddress: getFullAddress(store)
      }));

      const provinces = getProvinces(storesWithFullAddress);
      const cities = getCities(storesWithFullAddress, '全部');
      const districts = getDistricts(storesWithFullAddress, '全部', '全部');

      this.setData({
        stores: storesWithFullAddress,
        filteredStores: storesWithFullAddress,
        swipeActiveIdx: -1,
        storeProvinces: provinces,
        storeCities: cities,
        storeDistricts: districts
      });
    } catch (error) {
      console.error('加载门店失败:', error);
      // 不显示错误提示，只记录日志
      this.setData({
        stores: [],
        filteredStores: [],
        swipeActiveIdx: -1,
        storeProvinces: [],
        storeCities: [],
        storeDistricts: []
      });
    }
  },



  onStoreSearchInput(e) {
    this.setData({ storeSearchKeyword: this._inputDetail(e) }, () => this._applyStoreFilter());
  },

  onStoreSearchSubmit() {},

  onStoreSearchClear() {
    this.setData({ storeSearchKeyword: '' }, () => this._applyStoreFilter());
  },

  setStoreProvinceFilter(e) {
    const province = e.currentTarget.dataset.val;
    this.setData({ 
      storeFilterProvince: province,
      storeFilterCity: '全部',
      storeFilterDistrict: '全部'
    }, () => this._applyStoreFilter());
  },

  setStoreCityFilter(e) {
    const city = e.currentTarget.dataset.val;
    this.setData({ 
      storeFilterCity: city,
      storeFilterDistrict: '全部'
    }, () => this._applyStoreFilter());
  },

  setStoreDistrictFilter(e) {
    const district = e.currentTarget.dataset.val;
    this.setData({ 
      storeFilterDistrict: district
    }, () => this._applyStoreFilter());
  },

  _applyStoreFilter() {
    const stores = this.data.stores || [];
    
    const filter = {
      province: this.data.storeFilterProvince,
      city: this.data.storeFilterCity,
      district: this.data.storeFilterDistrict,
      keyword: this.data.storeSearchKeyword
    };
    
    const filteredStores = stores.filter(store => checkStoreFilter(store, filter));
    
    // 根据当前筛选条件更新城市和区县列表
    const cities = getCities(stores, filter.province);
    const districts = getDistricts(stores, filter.province, filter.city);
    
    // 同时更新代金券门店选择器的带标记列表
    const selectedIds = this.data.newRule.selectedStores || [];
    const ruleStoresWithSelected = filteredStores.map(store => ({
      ...store,
      selected: selectedIds.includes(store.id)
    }));
    
    this.setData({ 
      filteredStores, 
      ruleStoresWithSelected,
      ruleSelectedCount: selectedIds.length,
      swipeActiveIdx: -1,
      storeCities: cities,
      storeDistricts: districts
    });
  },

  showQRCode(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/store/verify?storeId=${id}` });
  },

  onSwipeTouchStart(e) {
    this.setData({ _touchStartX: e.touches[0].clientX });
  },
  onSwipeTouchMove(e) {
    // 阻止事件冒泡，避免触发 tab 切换
    e.stopPropagation && e.stopPropagation();
  },
  onSwipeTouchEnd(e) {
    const startX = this.data._touchStartX;
    if (startX === undefined) return;
    
    const endX = e.changedTouches[0].clientX;
    const idx = e.currentTarget.dataset.idx;
    const diff = startX - endX;
    
    // 配置化阈值:左滑>50px打开,右滑>30px关闭
    const SWIPE_THRESHOLD = { OPEN: 50, CLOSE: 30 };
    
    if (diff > SWIPE_THRESHOLD.OPEN) {
      this.setData({ swipeActiveIdx: idx });
    } else if (diff < -SWIPE_THRESHOLD.CLOSE) {
      this.setData({ swipeActiveIdx: -1 });
    }
  },

  // 左滑打开时，点击门店主体关闭左滑
  onStoreItemTap(e) {
    if (this.data.swipeActiveIdx !== -1) {
      this.setData({ swipeActiveIdx: -1 });
    }
  },

  editStore(e) {
    const idx = e.currentTarget.dataset.idx;
    const store = this.data.stores[idx];
    this.setData({
      editingStoreId: store.id,
      newStore: {
        name: store.name,
        province: store.province || '',
        city: store.city || '',
        district: store.district || '',
        address: store.address || '',
        owner: store.owner === '—' ? '' : store.owner,
        phone: store.phone === '—' ? '' : (store.phone || '')
      },
      swipeActiveIdx: -1
    });
    wx.pageScrollTo({ scrollTop: 9999, duration: 300 });
  },

  cancelEditStore() {
    this.setData({
      editingStoreId: '',
      newStore: { name: '', province: '', city: '', district: '', address: '', owner: '', phone: '', location: null }
    });
  },

  async deleteStore(e) {
    const id = e.currentTarget.dataset.id;
    const confirmed = await this._confirmDialog({
      title: '确认删除',
      content: '删除后该门店数据不可恢复',
      confirmColor: '#FF4D4F'
    });
    if (confirmed) {
      try {
        const res = await businessAPI.adminDeleteStore(id);
        if (res.code === 200) {
          this._showSuccess('门店已删除');
          this.loadStores();
        } else {
          this._showToast((res && res.message) || '删除失败');
        }
      } catch(err) {
        console.error('删除门店失败:', err);
        this._showToast('删除失败');
      }
    } else {
      this.setData({ swipeActiveIdx: -1 });
    }
  },

  onNewStoreName(e)  { this.setData({ 'newStore.name': this._inputDetail(e) }); },
  onNewStoreAddr(e)  { this.setData({ 'newStore.address': this._inputDetail(e) }); },
  onNewStoreOwner(e) { this.setData({ 'newStore.owner': this._inputDetail(e) }); },
  
  /**
   * 地区选择器变化
   * 使用微信小程序内置地区选择器
   */
  onRegionChange(e) {
    const value = e.detail.value; // [省名, 市名, 区名]
    const code = e.detail.code;   // [省编码, 市编码, 区编码]
    
    this.setData({
      'newStore.province': value[0] || '',
      'newStore.city': value[1] || '',
      'newStore.district': value[2] || '',
      'newStore.regionValue': code || [],
      'newStore.regionText': value.join(' ')
    });
  },
  
  onNewStorePhone(e) {
    const phone = this._inputDetail(e);
    let error = '';
    if (phone && !/^1\d{10}$/.test(phone)) {
      error = '请输入正确的11位手机号';
    }
    // 手机号唯一性校验由云函数 handleAdminCreateStore/handleAdminUpdateStore 处理
    this.setData({ 'newStore.phone': phone, phoneBindError: error });
  },

  chooseLocation() {
    wx.chooseLocation({
      success: res => {
        const addr = (res.address ? res.address + ' ' : '') + (res.name || '');
        this.setData({
          'newStore.address': addr.trim(),
          'newStore.location': {
            lat: res.latitude,
            lng: res.longitude
          }
        });
      },
      fail: (err) => {
        if (err && err.errMsg && err.errMsg.indexOf('cancel') === -1) {
          this._showToast('获取位置失败，请手动输入');
        }
      }
    });
  },

  async addStore() {
    const { name, province, city, district, address, owner, phone, location, editingStoreId } = this.data.newStore;

    // 验证必填字段
    if (!name) { this._showToast('门店名称不能为空'); return; }
    if (!province) { this._showToast('请选择省份'); return; }
    if (!city) { this._showToast('请选择城市'); return; }
    if (!district) { this._showToast('请选择区县'); return; }
    if (!owner) { this._showToast('请填写负责人姓名'); return; }
    if (!phone) { this._showToast('请填写店长手机号'); return; }
    if (!/^1\d{10}$/.test(phone)) { this._showToast('请输入正确的11位手机号'); return; }

    this.setData({ savingStore: true });
    try {
      const storeData = {
        name,
        province,
        city,
        district,
        address: address || '',
        owner,
        phone,
        location: location || null
      };

      let res;
      if (this.data.editingStoreId) {
        res = await businessAPI.adminUpdateStore(this.data.editingStoreId, storeData);
        if (res.code === 200) {
          this._showSuccess('门店已更新');
        } else {
          this._showToast((res && res.message) || '更新失败');
          this.setData({ savingStore: false });
          return;
        }
      } else {
        res = await businessAPI.adminCreateStore(storeData);
        if (res.code === 200) {
          this._showSuccess('门店已添加');
        } else {
          this._showToast((res && res.message) || '添加失败');
          this.setData({ savingStore: false });
          return;
        }
      }

      this.setData({
        newStore: { name: '', province: '', city: '', district: '', address: '', owner: '', phone: '', location: null },
        editingStoreId: '',
        phoneBindError: ''
      });
      this.loadStores();
    } catch (e) {
      console.error('保存门店失败:', e);
      this._showToast('操作失败');
    } finally {
      this.setData({ savingStore: false });
    }
  },

  // ========== 管理员管理 ==========

  loadAdmins() {
    const app = getApp();
    const currentAdmin = app.globalData.currentAdmin;
    const isSuperAdmin = currentAdmin && currentAdmin.roleKey === 'super_admin';
    const canManageAdmins = !!isSuperAdmin;
    const nextData = {
      admins: [],
      currentAdmin: currentAdmin,
      canManageAdmins,
      canEditOtherAdmins: canManageAdmins
    };

    if (!canManageAdmins && this.data.activeTab === 'admins') {
      nextData.activeTab = 'contract';
    }
    if (!this.data.canManageStoreSetup && this.data.activeTab === 'store') {
      nextData.activeTab = 'contract';
    }

    this.setData(nextData);

    if (!canManageAdmins) {
      return;
    }

    callCloudFunction('manageAdmin', { action: 'list' })
      .then((res) => {
        if (!res || res.code !== 200) {
          if (res && res.code !== 404) {
            console.warn('加载管理员失败:', res.message);
          }
          this.setData({ admins: [] });
          return;
        }
        const admins = (res.data || []).map((item) => ({
          id: item._id || item.id || '',
          name: item.name || (item.roleKey === 'super_admin' ? '超级管理员' : '管理员'),
          phone: item.phone || '',
          status: item.status === 0 ? 0 : 1,
          roleKey: item.roleKey || 'admin'
        }));
        this.setData({ admins });
      })
      .catch((error) => {
        console.error('云端加载管理员失败:', error);
        this.setData({ admins: [] });
      });
  },

  onNewAdminName(e)  { this.setData({ 'newAdmin.name': this._inputDetail(e) }); },
  onNewAdminPhone(e) { this.setData({ 'newAdmin.phone': this._inputDetail(e) }); },

  submitAddAdmin() {
    const { name, phone } = this.data.newAdmin;
    if (!name)  { this._showToast('请填写管理员姓名'); return; }
    if (!phone) { this._showToast('请填写手机号码'); return; }
    if (!/^1\d{10}$/.test(phone)) {
      this._showToast('手机号格式不正确'); return;
    }

    // 编辑模式
    if (this.data.editingAdminId) {
      this.setData({ savingAdmin: true });
      callCloudFunction('manageAdmin', {
        action: 'update',
        roleId: this.data.editingAdminId,
        name,
        phone
      }).then((res) => {
        if (res && res.code === 200) {
          this._showSuccess('管理员信息已更新');
          this.setData({ newAdmin: { name: '', phone: '' }, editingAdminId: '' });
          this.loadAdmins();
        } else {
          this._showToast((res && res.message) || '更新失败');
        }
      }).catch((error) => {
        console.error('云端更新管理员失败:', error);
        this._showToast('更新失败，请稍后重试');
      }).finally(() => {
        this.setData({ savingAdmin: false });
      });
      return;
    }

    // 新增模式
    this.setData({ savingAdmin: true });
    callCloudFunction('manageAdmin', {
      action: 'invite',
      name,
      phone
    }).then((res) => {
      if (res && res.code === 200) {
        this._showSuccess('已创建管理员邀请（待绑定）');
        this.setData({ newAdmin: { name: '', phone: '' }, editingAdminId: '' });
        this.loadAdmins();
      } else {
        this._showToast((res && res.message) || '邀请创建失败');
      }
    }).catch((error) => {
      console.error('云端创建管理员邀请失败:', error);
      this._showToast('邀请创建失败，请稍后重试');
    }).finally(() => {
      this.setData({ savingAdmin: false });
    });
  },

  async deleteAdmin(e) {
    const id = e.currentTarget.dataset.id;
    const confirmed = await this._confirmDialog({
      title: '确认移除',
      content: '移除后该管理员将无法登录管理后台',
      confirmColor: '#FF4D4F'
    });
    if (confirmed) {
      try {
        const res = await callCloudFunction('manageAdmin', {
          action: 'disableRole',
          roleId: id
        });
        if (res && res.code === 200) {
          this._showSuccess('已移除');
          this.loadAdmins();
        } else {
          this._showToast((res && res.message) || '移除失败');
        }
      } catch (error) {
        console.error('移除管理员失败:', error);
        this._showToast('移除失败，请稍后重试');
      }
      this.setData({ adminSwipeActiveIdx: -1 });
      return;
    }
    this.setData({ adminSwipeActiveIdx: -1 });
  },

  // 管理员左滑操作
  onAdminSwipeTouchStart(e) {
    this.setData({ _adminTouchStartX: e.touches[0].clientX });
  },
  onAdminSwipeTouchMove(e) {
    e.stopPropagation && e.stopPropagation();
    // 阻止事件冒泡,避免影响页面滚动
  },
  onAdminSwipeTouchEnd(e) {
    const startX = this.data._adminTouchStartX;
    if (startX === undefined) return;
    
    const endX = e.changedTouches[0].clientX;
    const idx = e.currentTarget.dataset.idx;
    const diff = startX - endX;
    
    // 配置化阈值:左滑>50px打开,右滑>30px关闭
    const SWIPE_THRESHOLD = { OPEN: 50, CLOSE: 30 };
    
    // 左滑超过阈值打开菜单
    if (diff > SWIPE_THRESHOLD.OPEN) {
      this.setData({ adminSwipeActiveIdx: idx });
    }
    // 右滑超过阈值关闭菜单
    else if (diff < -SWIPE_THRESHOLD.CLOSE) {
      this.setData({ adminSwipeActiveIdx: -1 });
    }
    // 点击其他地方关闭菜单
    else if (this.data.adminSwipeActiveIdx !== -1 && this.data.adminSwipeActiveIdx !== idx) {
      this.setData({ adminSwipeActiveIdx: -1 });
    }
  },

  // 点击管理员项关闭左滑
  onAdminItemTap(e) {
    if (this.data.adminSwipeActiveIdx !== -1) {
      this.setData({ adminSwipeActiveIdx: -1 });
    }
  },

  // 编辑管理员
  editAdmin(e) {
    const idx = e.currentTarget.dataset.idx;
    const admin = this.data.admins[idx];
    this.setData({
      editingAdminId: admin.id,
      newAdmin: { name: admin.name, phone: admin.phone },
      adminSwipeActiveIdx: -1
    });
    wx.pageScrollTo({ scrollTop: 9999, duration: 300 });
  },

  // 取消编辑管理员
  cancelEditAdmin() {
    this.setData({
      editingAdminId: '',
      newAdmin: { name: '', phone: '' }
    });
  },

  logoutAdmin() {
    const app = getApp();
    app.logoutAdmin();
    this.setData({
      currentAdmin: null,
      canManageAdmins: false,
      canEditOtherAdmins: false
    });
    this._showSuccess('已退出当前身份');
    setTimeout(() => {
      wx.reLaunch({ url: '/pages/launch/index' });
    }, 800);
  },

  // ========== 工具函数 ==========

  loadAll() {
    if (!this.data.currentAdmin) {
      return;
    }
    this.loadContracts();
    if (this.data.canManageCouponOps) {
      this.loadCouponStats();
    }
    if (this.data.canManageStoreSetup) {
      this.loadStores();
    }
    this.loadAdmins();
  },

  _maskPhone(phone) {
    if (!phone || phone.length < 7) return phone || '未知';
    return phone.slice(0, 3) + '****' + phone.slice(-4);
  },

  _formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  },

  _formatDateTime(d) {
    if (!d) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  _getStatusText(status) {
    const map = {
      [STATES.REJECTED]:       '已拒绝',
      [STATES.WAIT_VERIFY]:    '待核验',
      [STATES.QUALIFIED]:      '已核验',
      [STATES.WAIT_SMSCODE]:   '待验证码',
      [STATES.CONTRACTING]:    '办理中',
      [STATES.CONTRACT_OK]:    '待发货',
      [STATES.SHIPPED]:        '已发货',
      [STATES.SIGNED]:         '已完成',
      [STATES.SMS_CODE_REJECTED]: '验证码无效'
    };
    return map[status] || '未知';
  },

  _getStatusClass(status) {
    if (status === STATES.REJECTED) return 'chip-reject';
    if (status === STATES.WAIT_VERIFY) return 'chip-warn';
    if (status === STATES.SMS_CODE_REJECTED) return 'chip-reject';
    if (status === STATES.QUALIFIED || status === STATES.WAIT_SMSCODE) return 'chip-blue';
    if (status === STATES.CONTRACTING) return 'chip-blue';
    if (status === STATES.CONTRACT_OK) return 'chip-orange';
    if (status >= STATES.SHIPPED) return 'chip-green';
    return 'chip-grey';
  },

});
