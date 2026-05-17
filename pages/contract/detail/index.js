// pages/contract/detail/index.js - 合约详情页
const { businessAPI, STATES } = require('../../utils/business-api');

const STATUS_MAP = {
  [STATES.REJECTED]: { text: '已拒绝', color: '#FF4D4F', icon: '✕' },
  [STATES.WAIT_VERIFY]: { text: '待核验', color: '#FAAD14', icon: '…' },
  [STATES.QUALIFIED]: { text: '核验通过', color: '#1677FF', icon: '✓' },
  [STATES.WAIT_SMSCODE]: { text: '待短信验证', color: '#FAAD14', icon: '…' },
  [STATES.CONTRACTING]: { text: '办理中', color: '#1677FF', icon: '⟳' },
  [STATES.CONTRACT_OK]: { text: '合约完成', color: '#07C160', icon: '✓' },
  [STATES.SHIPPED]: { text: '已发货', color: '#07C160', icon: '📦' },
  [STATES.SIGNED]: { text: '已签收', color: '#07C160', icon: '✓' },
  [STATES.SMS_CODE_REJECTED]: { text: '验证码被驳回', color: '#FF4D4F', icon: '✕' }
};

Page({
  data: {
    contractId: '',
    contract: null,
    timeline: [],
    statusInfo: null,
    pageLoading: true,
    pageError: ''
  },

  onLoad(options) {
    const contractId = options.contractId || '';
    if (!contractId) {
      this.setData({ pageError: '缺少合约参数', pageLoading: false });
      return;
    }
    this.setData({ contractId });
    this._loadContract();
  },

  onPullDownRefresh() {
    this._loadContract().finally(() => wx.stopPullDownRefresh());
  },

  async _loadContract() {
    this.setData({ pageLoading: true, pageError: '' });
    try {
      const res = await businessAPI.getContractStatus(this.data.contractId);
      if (res && res.code === 200 && res.data) {
        const contract = res.data;
        const statusInfo = STATUS_MAP[contract.status] || STATUS_MAP[STATES.WAIT_VERIFY];
        const timeline = this._buildTimeline(contract);
        this.setData({ contract, statusInfo, timeline, pageLoading: false });
      } else {
        this.setData({
          pageError: res.message || '合约不存在',
          pageLoading: false
        });
      }
    } catch (e) {
      console.error('加载合约详情失败:', e);
      this.setData({
        pageError: '加载失败，请下拉重试',
        pageLoading: false
      });
    }
  },

  _buildTimeline(contract) {
    const items = [];
    const fmtd = (d) => {
      if (!d) return '';
      const dt = new Date(d);
      return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
    };

    items.push({ text: '提交申请', desc: '手机号提交成功', time: fmtd(contract.createdAt), active: true });

    if (contract.status >= STATES.QUALIFIED) {
      items.push({ text: '资格核验通过', desc: '管理员已核验通过', time: fmtd(contract.updatedAt), active: true });
    }

    if (contract.status === STATES.REJECTED) {
      items.push({ text: '核验未通过', desc: contract.rejectReason || '不符合办理条件', time: fmtd(contract.updatedAt), active: false });
    }

    if (contract.status >= STATES.WAIT_SMSCODE) {
      items.push({ text: '填写收货信息', desc: `${contract.name || ''} ${contract.address || ''}`.trim(), time: fmtd(contract.updatedAt), active: true });
    }

    if (contract.status >= STATES.CONTRACTING) {
      items.push({ text: '合约办理中', desc: '管理员正在为您办理合约', time: fmtd(contract.updatedAt), active: true });
    }

    if (contract.status >= STATES.CONTRACT_OK) {
      items.push({ text: '合约完成', desc: '合约办理成功，待发货', time: fmtd(contract.contractOkAt), active: true });
    }

    if (contract.status >= STATES.SHIPPED) {
      items.push({ text: '已发货', desc: `快递单号: ${contract.trackingNo || '暂无'}`, time: fmtd(contract.shippedAt), active: true });
    }

    if (contract.status >= STATES.SIGNED) {
      items.push({ text: '已签收', desc: '终端已签收', time: fmtd(contract.signedAt), active: true });
    }

    if (contract.status === STATES.SMS_CODE_REJECTED) {
      items.push({ text: '验证码被驳回', desc: contract.smsCodeRejectReason || '请重新输入验证码', time: fmtd(contract.smsCodeRejectedAt), active: false });
    }

    return items;
  },

  onCopyTrackingNo() {
    if (!this.data.contract || !this.data.contract.trackingNo) return;
    wx.setClipboardData({
      data: this.data.contract.trackingNo,
      success: () => wx.showToast({ title: '已复制单号', icon: 'success' })
    });
  },

  goToCoupon() {
    wx.switchTab({ url: '/pages/coupon/coupon' });
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' });
  }
});
