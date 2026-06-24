// utils/mock.js - Mock数据和API模拟
// 用于开发者工具预览调试，模拟后端接口
//
// 【自动推进说明】Mock API 内置了自动推进机制（_autoAdvanceTimers）：
// - 合约提交手机号后 3 秒 → 自动变为 QUALIFIED（核验通过）
// - 用户提交收货信息后 → 进入 WAIT_SMSCODE（待验证码）
// - 合约提交验证码后 5 秒 → 自动变为 CONTRACT_OK（办理完成）+ 生成代金券
// - 合约变为已办理后 10 秒 → 自动发货
// - 合约变为已发货后 5 秒 → 自动变为 SIGNED（已签收）
// 如需关闭自动推进，调用 mockAPI.disableAutoAdvance()

const STATES = {
  WAIT_INPUT: 0,       // 等待输入手机号
  REJECTED: 0,         // 已拒绝（保持兼容，实际使用 WAIT_INPUT）
  WAIT_VERIFY: 1,      // 等待资格核验
  QUALIFIED: 2,        // 核验通过，填写信息
  WAIT_SMSCODE: 3,     // 等待短信验证码
  CONTRACTING: 4,      // 合约办理中
  CONTRACT_OK: 5,      // 合约已办理，等待发货
  SHIPPED: 6,          // 已发货
  SIGNED: 7,           // 已签收
  SMS_CODE_REJECTED: 8 // 验证码被驳回
};

// ============================================================
// 【自动推进定时器】—— Mock 环境下自动模拟管理员审批操作
// ============================================================
const _autoAdvanceTimers = {};

function _ensureContractTimers(contractId) {
  if (!_autoAdvanceTimers[contractId]) {
    _autoAdvanceTimers[contractId] = {
      qualify: null,
      contract: null,
      ship: null,
      sign: null
    };
  }
  return _autoAdvanceTimers[contractId];
}

function _clearContractAutoAdvance(contractId, keys) {
  const timers = _autoAdvanceTimers[contractId];
  if (!timers) return;

  const timerKeys = Array.isArray(keys) && keys.length > 0
    ? keys
    : Object.keys(timers);

  timerKeys.forEach((key) => {
    if (timers[key]) {
      clearTimeout(timers[key]);
      timers[key] = null;
    }
  });

  if (Object.values(timers).every(timer => !timer)) {
    delete _autoAdvanceTimers[contractId];
  }
}

function clearAllAutoAdvance() {
  Object.keys(_autoAdvanceTimers).forEach(contractId => {
    _clearContractAutoAdvance(contractId);
  });
}

function _scheduleContractAutoAdvance(contractId, key, delay, task) {
  const timers = _ensureContractTimers(contractId);
  if (timers[key]) {
    clearTimeout(timers[key]);
  }

  timers[key] = setTimeout(() => {
    timers[key] = null;
    task();
    if (Object.values(timers).every(timer => !timer)) {
      delete _autoAdvanceTimers[contractId];
    }
  }, delay);
}

function _findContractIndex(data, contractId) {
  return (data.contracts || []).findIndex(c => c.id === contractId);
}

function _formatTimelineTime(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function _buildShipLogistics(dateInput) {
  const time = _formatTimelineTime(dateInput);
  return [
    { status: '运输中', time },
    { status: '快递已揽收', time }
  ];
}

function _prependLogistics(logistics, entry) {
  const list = Array.isArray(logistics) ? logistics.slice() : [];
  if (list.some(item => item.status === entry.status)) {
    return list;
  }
  return [entry, ...list];
}

function _ensureCouponsForContract(data, contract) {
  if (!contract) return false;
  const existed = (data.coupons || []).some(c => c.contractId === contract.id);
  if (existed) {
    return false;
  }
  _generateCoupons(data, contract);
  return true;
}

// 生成代金券的辅助函数（合约办理完成时调用）
function _generateCoupons(data, contract) {
  const now = new Date();
  for (let i = 1; i <= 5; i++) {
    const periodMonth = new Date(now);
    periodMonth.setMonth(periodMonth.getMonth() + (i - 1));
    const periodMonthStr = `${periodMonth.getFullYear()}-${String(periodMonth.getMonth() + 1).padStart(2, '0')}`;

    data.coupons.push({
      id: 'CP' + Date.now() + i,
      contractId: contract.id,
      storeId: contract.storeId,
      storeName: contract.storeName,
      amount: 20,
      monthlyLimit: 1,
      period: i, // 第几期
      periodMonth: periodMonthStr, // 对应的月份
      status: i === 1 ? 1 : 0, // 第1张立即激活
      activateDate: now.toISOString(),
      usedTimes: 0, // 本月已使用次数
      usedCount: 0, // 总使用次数
      usedAt: null,
      verifyCode: null,
      verifyExpireAt: null
    });
  }
}

// 自动推进状态
function _autoAdvance(contractId, currentStatus) {
  switch (currentStatus) {
    case STATES.WAIT_VERIFY:
      // 3秒后自动核验通过
      _scheduleContractAutoAdvance(contractId, 'qualify', 3000, () => {
        const data = mockAPI.getDB();
        const idx = _findContractIndex(data, contractId);
        if (idx < 0 || data.contracts[idx].status !== STATES.WAIT_VERIFY) return;

        data.contracts[idx].status = STATES.QUALIFIED;
        data.contracts[idx].qualifiedAt = new Date().toISOString();
        mockAPI.saveDB(data);
        console.log('[Mock Auto] 合约', contractId, '自动核验通过 → QUALIFIED');
      });
      break;

    case STATES.QUALIFIED:
      // QUALIFIED 需要用户填写信息后手动提交，不自动推进
      break;

    case STATES.WAIT_SMSCODE:
      // WAIT_SMSCODE 需要用户填验证码后手动提交，不自动推进
      break;

    case STATES.CONTRACTING:
      // 5秒后自动办理完成 + 生成代金券
      _clearContractAutoAdvance(contractId, ['ship', 'sign']);
      _scheduleContractAutoAdvance(contractId, 'contract', 5000, () => {
        const data = mockAPI.getDB();
        const idx = _findContractIndex(data, contractId);
        if (idx < 0 || data.contracts[idx].status !== STATES.CONTRACTING) return;

        data.contracts[idx].status = STATES.CONTRACT_OK;
        data.contracts[idx].contractOkAt = new Date().toISOString();
        const generated = _ensureCouponsForContract(data, data.contracts[idx]);
        mockAPI.saveDB(data);
        console.log('[Mock Auto] 合约', contractId, generated
          ? '自动办理完成 → CONTRACT_OK，生成5张代金券'
          : '自动办理完成 → CONTRACT_OK');
        _autoAdvance(contractId, STATES.CONTRACT_OK);
      });
      break;

    case STATES.CONTRACT_OK:
      // 10秒后自动发货
      _clearContractAutoAdvance(contractId, ['contract']);
      _scheduleContractAutoAdvance(contractId, 'ship', 10000, () => {
        const data = mockAPI.getDB();
        const idx = _findContractIndex(data, contractId);
        if (idx < 0 || data.contracts[idx].status !== STATES.CONTRACT_OK) return;

        const shippedAt = new Date().toISOString();
        const contract = data.contracts[idx];
        data.contracts[idx] = {
          ...contract,
          status: STATES.SHIPPED,
          shippedAt,
          trackingNo: contract.trackingNo || ('SF' + Date.now().toString().slice(-12)),
          logistics: contract.logistics && contract.logistics.length > 0
            ? contract.logistics
            : _buildShipLogistics(shippedAt)
        };
        mockAPI.saveDB(data);
        console.log('[Mock Auto] 合约', contractId, '自动发货 → SHIPPED');
        _autoAdvance(contractId, STATES.SHIPPED);
      });
      break;

    case STATES.SHIPPED:
      // 5秒后自动签收
      _scheduleContractAutoAdvance(contractId, 'sign', 5000, () => {
        const data = mockAPI.getDB();
        const idx = _findContractIndex(data, contractId);
        if (idx < 0 || data.contracts[idx].status !== STATES.SHIPPED) return;

        const signedAt = new Date().toISOString();
        const contract = data.contracts[idx];
        data.contracts[idx] = {
          ...contract,
          status: STATES.SIGNED,
          signedAt,
          logistics: _prependLogistics(
            contract.logistics && contract.logistics.length > 0
              ? contract.logistics
              : _buildShipLogistics(contract.shippedAt || signedAt),
            { status: '已签收', time: _formatTimelineTime(signedAt) }
          )
        };
        mockAPI.saveDB(data);
        console.log('[Mock Auto] 合约', contractId, '自动签收 → SIGNED');
      });
      break;
  }
}

// 默认门店数据（带省市区结构化信息和坐标）
// 坐标为 gcj02 坐标系，用于定位匹配
const defaultStores = [
  { 
    id: 'S001', 
    name: '爱宠汪汪宠物店', 
    province: '山西省',
    city: '太原市',
    district: '迎泽区',
    address: '解放路88号', 
    owner: '张老板',
    phone: '13800138001',
    // 太原市迎泽区坐标
    location: { lat: 37.857, lng: 112.548 }
  },
  { 
    id: 'S002', 
    name: '萌宠乐园', 
    province: '山西省',
    city: '太原市', 
    district: '小店区',
    address: '学府街22号', 
    owner: '李老板',
    phone: '13800138002',
    // 太原市小店区坐标
    location: { lat: 37.748, lng: 112.558 }
  },
  { 
    id: 'S003', 
    name: '宠物天堂宠物店', 
    province: '山西省',
    city: '太原市', 
    district: '万柏林区',
    address: '千峰南路15号', 
    owner: '王老板',
    phone: '13800138003',
    // 太原市万柏林区坐标
    location: { lat: 37.818, lng: 112.518 }
  },
];

function createDefaultStoreOwners(stores) {
  return (stores || []).map(store => ({
    id: 'SO_INIT_' + store.id,
    phone: store.phone,
    storeId: store.id,
    storeName: store.name,
    role: 'store_owner',
    openId: '',
    status: 1,
    createdAt: '2026-01-01T00:00:00Z'
  }));
}

// Mock API
const mockAPI = {
  // 获取数据库（延迟初始化）
  getDB() {
    try {
      const data = wx.getStorageSync('mockDB');
      if (!data || !data.stores) {
        const storeOwners = createDefaultStoreOwners(defaultStores);
        const newData = {
          contracts: [],
          coupons: [],
          stores: defaultStores,
          admins: [
            // 预置管理员（预览用），正式上线后将此字段移到服务端
            { id: 'A001', name: '演示管理员', phone: '13800000001', openId: 'admin_preview_001', status: 1, createdAt: '2026-01-01T00:00:00Z' }
          ],
          storeOwners, // 门店负责人权限绑定
          couponRules: [], // 代金券规则
          currentContractId: null
        };
        wx.setStorageSync('mockDB', newData);
        return newData;
      }

      let changed = false;
      if (!Array.isArray(data.contracts)) {
        data.contracts = [];
        changed = true;
      }
      if (!Array.isArray(data.coupons)) {
        data.coupons = [];
        changed = true;
      }
      if (!Array.isArray(data.admins)) {
        data.admins = [
          { id: 'A001', name: '演示管理员', phone: '13800000001', openId: 'admin_preview_001', status: 1, createdAt: '2026-01-01T00:00:00Z' }
        ];
        changed = true;
      }
      if (!Array.isArray(data.couponRules)) {
        data.couponRules = [];
        changed = true;
      }
      if (typeof data.currentContractId === 'undefined') {
        data.currentContractId = null;
        changed = true;
      }
      if (!Array.isArray(data.storeOwners)) {
        data.storeOwners = createDefaultStoreOwners(data.stores || defaultStores);
        changed = true;
      } else {
        const storeIds = new Set(data.storeOwners.map(owner => owner.storeId));
        (data.stores || []).forEach((store) => {
          if (!storeIds.has(store.id) && store.phone) {
            data.storeOwners.push({
              id: 'SO_MIGRATE_' + store.id,
              phone: store.phone,
              storeId: store.id,
              storeName: store.name,
              role: 'store_owner',
              openId: '',
              status: 1,
              createdAt: new Date().toISOString()
            });
            changed = true;
          }
        });
      }

      if (changed) {
        wx.setStorageSync('mockDB', data);
      }

      return data;
    } catch (e) {
      console.error('获取数据库失败:', e);
      return {
        contracts: [],
        coupons: [],
        stores: defaultStores,
        storeOwners: createDefaultStoreOwners(defaultStores),
        currentContractId: null
      };
    }
  },

  saveDB(data) {
    try {
      wx.setStorageSync('mockDB', data);
    } catch (e) {
      console.error('保存数据库失败:', e);
    }
  },

  // 获取门店列表
  getStores() {
    return new Promise(resolve => {
      setTimeout(() => {
        const data = this.getDB();
        resolve({ code: 200, data: data.stores });
      }, 300);
    });
  },

  // 提交手机号，创建合约记录
  submitPhone(phone, storeId) {
    return new Promise(resolve => {
      setTimeout(() => {
        const data = this.getDB();
        const store = data.stores.find(s => s.id === storeId);
        const contractId = 'C' + Date.now();
        const contract = {
          id: contractId,
          phone,
          storeId,
          storeName: store ? store.name : '未知门店',
          status: STATES.WAIT_VERIFY,
          createdAt: new Date().toISOString(),
          name: '',
          address: '',
          smsCode: '',
          trackingNo: '',
          logistics: []
        };
        data.contracts.push(contract);
        data.currentContractId = contractId;
        this.saveDB(data);

        // 【自动推进】提交手机号后 3 秒自动核验通过
        _autoAdvance(contractId, STATES.WAIT_VERIFY);

        resolve({ code: 200, data: { contractId, status: STATES.WAIT_VERIFY } });
      }, 500);
    });
  },

  // 查询合约状态
  getContractStatus(contractId) {
    return new Promise(resolve => {
      setTimeout(() => {
        const data = this.getDB();
        const contract = data.contracts.find(c => c.id === contractId);
        if (contract) {
          resolve({ code: 200, data: contract });
        } else {
          resolve({ code: 404, message: '合约记录不存在' });
        }
      }, 200);
    });
  },

  getCurrentContractId() {
    const data = this.getDB();
    return data.currentContractId || '';
  },

  /**
   * 创建新业务（仅当当前业务已完成时允许）
   */
  createNewContract() {
    const data = this.getDB();
    
    // 检查当前合约状态
    if (data.currentContractId) {
      const currentContract = data.contracts.find(c => c.id === data.currentContractId);
      if (currentContract) {
        // 已完成状态：CONTRACT_OK(5), SHIPPED(6), SIGNED(7)
        const completedStates = [STATES.CONTRACT_OK, STATES.SHIPPED, STATES.SIGNED];
        if (!completedStates.includes(currentContract.status)) {
          return {
            code: 400,
            message: '当前还有未完成的业务，请先完成当前业务'
          };
        }
      }
    }
    
    // 清除当前合约指针，允许创建新合约
    if (data.currentContractId) {
      data.currentContractId = null;
      this.saveDB(data);
    }
    
    return {
      code: 200,
      data: {
        canCreate: true,
        message: '可以创建新业务'
      }
    };
  },

  // 提交收货信息
  submitOrderInfo(contractId, info) {
    return new Promise(resolve => {
      setTimeout(() => {
        const data = this.getDB();
        const idx = data.contracts.findIndex(c => c.id === contractId);
        if (idx >= 0) {
          data.contracts[idx] = { ...data.contracts[idx], ...info, status: STATES.WAIT_SMSCODE };
          this.saveDB(data);
          // 【自动推进】提交收货信息后，进入 WAIT_SMSCODE 状态，等待用户填验证码
          resolve({ code: 200, data: { status: STATES.WAIT_SMSCODE } });
        } else {
          resolve({ code: 404 });
        }
      }, 500);
    });
  },

  // 提交短信验证码
  submitSmsCode(contractId, code) {
    return new Promise(resolve => {
      setTimeout(() => {
        const data = this.getDB();
        const idx = data.contracts.findIndex(c => c.id === contractId);
        if (idx >= 0) {
          data.contracts[idx].smsCode = code;
          data.contracts[idx].status = STATES.CONTRACTING;
          this.saveDB(data);

          // 【自动推进】提交验证码后进入 CONTRACTING，5秒后自动办理完成
          _autoAdvance(contractId, STATES.CONTRACTING);

          resolve({ code: 200, data: { status: STATES.CONTRACTING } });
        } else {
          resolve({ code: 404 });
        }
      }, 500);
    });
  },

  // 获取代金券列表
  getCoupons(contractId) {
    return new Promise(resolve => {
      setTimeout(() => {
        const data = this.getDB();
        const coupons = data.coupons.filter(c => c.contractId === contractId);
        resolve({ code: 200, data: coupons });
      }, 300);
    });
  },

  // 生成动态核销码
  generateVerifyCode(couponId) {
    return new Promise(resolve => {
      setTimeout(() => {
        const data = this.getDB();
        const idx = data.coupons.findIndex(c => c.id === couponId);
        if (idx >= 0) {
          const code = String(Math.floor(100000 + Math.random() * 900000));
          const expireAt = Date.now() + 3 * 60 * 1000; // 3分钟
          data.coupons[idx].verifyCode = code;
          data.coupons[idx].verifyExpireAt = expireAt;
          this.saveDB(data);
          resolve({ code: 200, data: { verifyCode: code, expireAt } });
        } else {
          resolve({ code: 404 });
        }
      }, 200);
    });
  },

  // ===== 管理员操作 API =====

  // 管理员：获取所有合约
  adminGetContracts() {
    return new Promise(resolve => {
      setTimeout(() => {
        const data = this.getDB();
        resolve({ code: 200, data: data.contracts });
      }, 300);
    });
  },

  getContracts() {
    return this.adminGetContracts().then(res => res.data || []);
  },

  // 管理员：更新合约状态
  adminUpdateStatus(contractId, status, extra = {}) {
    return new Promise(resolve => {
      setTimeout(() => {
        const data = this.getDB();
        const idx = _findContractIndex(data, contractId);
        if (idx >= 0) {
          const current = data.contracts[idx];
          const nextContract = { ...current, ...extra, status };

          // 发货时记录时间
          if (status === STATES.SHIPPED && !extra.shippedAt) {
            nextContract.shippedAt = new Date().toISOString();
          }

          if (status === STATES.CONTRACT_OK && !nextContract.contractOkAt) {
            nextContract.contractOkAt = new Date().toISOString();
          }

          if (status === STATES.SHIPPED) {
            nextContract.logistics = nextContract.logistics && nextContract.logistics.length > 0
              ? nextContract.logistics
              : _buildShipLogistics(nextContract.shippedAt);
          }

          if (status === STATES.SIGNED) {
            const signedAt = nextContract.signedAt || new Date().toISOString();
            nextContract.signedAt = signedAt;
            nextContract.logistics = _prependLogistics(
              nextContract.logistics && nextContract.logistics.length > 0
                ? nextContract.logistics
                : _buildShipLogistics(nextContract.shippedAt || signedAt),
              { status: '已签收', time: _formatTimelineTime(signedAt) }
            );
          }

          data.contracts[idx] = nextContract;

          // 合约完成时自动生成5张代金券
          if (status === STATES.CONTRACT_OK) {
            _ensureCouponsForContract(data, data.contracts[idx]);
            // 【自动推进】办理完成后10秒自动发货，再5秒自动签收
            _autoAdvance(contractId, STATES.CONTRACT_OK);
          } else if (status === STATES.QUALIFIED) {
            // 【自动推进】手动核验通过后3秒生效（等同于自动核验）
            _clearContractAutoAdvance(contractId, ['qualify', 'contract', 'ship', 'sign']);
            _autoAdvance(contractId, STATES.QUALIFIED);
          } else if (status === STATES.SHIPPED) {
            // 【自动推进】手动发货后5秒自动签收
            _clearContractAutoAdvance(contractId, ['contract', 'ship']);
            _autoAdvance(contractId, STATES.SHIPPED);
          } else if (status === STATES.SIGNED) {
            _clearContractAutoAdvance(contractId, ['contract', 'ship', 'sign']);
          }

          this.saveDB(data);
          resolve({ code: 200, data: data.contracts[idx] });
        } else {
          resolve({ code: 404 });
        }
      }, 500);
    });
  },

  // 门店：核销代金券
  storeVerifyCoupon(code, storeId) {
    return new Promise(resolve => {
      setTimeout(() => {
        const data = this.getDB();
        const now = Date.now();
        const idx = data.coupons.findIndex(c => 
          c.verifyCode === code && 
          c.verifyExpireAt > now &&
          c.status === 1 &&
          c.storeId === storeId
        );
        if (idx >= 0) {
          const coupon = data.coupons[idx];
          // 返回确认信息，还未标记使用
          resolve({ 
            code: 200, 
            data: { 
              couponId: coupon.id,
              storeName: coupon.storeName,
              amount: coupon.amount,
              contractId: coupon.contractId
            } 
          });
        } else {
          // 先检查是否是本店的券
          const sameCodeCoupon = data.coupons.find(c => c.verifyCode === code);
          if (sameCodeCoupon) {
            if (sameCodeCoupon.storeId !== storeId) {
              resolve({ code: 403, message: '该券不属于当前门店' });
              return;
            }
            if (sameCodeCoupon.status === 2) {
              resolve({ code: 400, message: '该券已核销使用' });
              return;
            }
            if (sameCodeCoupon.status === 3) {
              resolve({ code: 400, message: '该券已过期' });
              return;
            }
            if (sameCodeCoupon.verifyExpireAt <= now) {
              resolve({ code: 400, message: '核销码已过期，请让客户重新生成' });
              return;
            }
          }
          resolve({ code: 400, message: '核销码无效，请检查输入' });
        }
      }, 300);
    });
  },

  // 门店：确认核销
  storeConfirmVerify(couponId, verifyCode) {
    return new Promise(resolve => {
      setTimeout(() => {
        const data = this.getDB();
        const idx = data.coupons.findIndex(c => c.id === couponId);
        if (idx >= 0) {
          data.coupons[idx].status = 2; // 已使用
          data.coupons[idx].usedAt = new Date().toISOString();
          data.coupons[idx].verifyCode = null;
          this.saveDB(data);
          resolve({ code: 200, data: { success: true } });
        } else {
          resolve({ code: 404 });
        }
      }, 400);
    });
  },

  refreshLogistics(contractId) {
    return new Promise(resolve => {
      setTimeout(() => {
        const data = this.getDB();
        const idx = _findContractIndex(data, contractId);
        if (idx < 0) {
          resolve({ code: 404, message: '合约记录不存在' });
          return;
        }

        const contract = data.contracts[idx];
        if (contract.status < STATES.SHIPPED) {
          resolve({ code: 200, data: contract });
          return;
        }

        let logistics = contract.logistics && contract.logistics.length > 0
          ? contract.logistics.slice()
          : _buildShipLogistics(contract.shippedAt || new Date());

        if (contract.status === STATES.SHIPPED) {
          logistics = _prependLogistics(logistics, {
            status: '派送中',
            time: _formatTimelineTime(new Date())
          });
        }

        if (contract.status === STATES.SIGNED) {
          logistics = _prependLogistics(logistics, {
            status: '已签收',
            time: _formatTimelineTime(contract.signedAt || new Date())
          });
        }

        data.contracts[idx].logistics = logistics;
        this.saveDB(data);
        resolve({ code: 200, data: data.contracts[idx] });
      }, 300);
    });
  },

  // ===== 管理员账号管理 =====

  // 获取所有管理员列表
  getAdmins() {
    return new Promise(resolve => {
      setTimeout(() => {
        const data = this.getDB();
        resolve({ code: 200, data: data.admins || [] });
      }, 200);
    });
  },

  // 添加管理员（根据手机号，openId 由前端传入或模拟）
  addAdmin(adminInfo) {
    return new Promise(resolve => {
      setTimeout(() => {
        const data = this.getDB();
        if (!data.admins) data.admins = [];
        // 检查手机号是否已存在
        if (data.admins.find(a => a.phone === adminInfo.phone)) {
          resolve({ code: 400, message: '该手机号已是管理员' });
          return;
        }
        const newAdmin = {
          id: 'A' + Date.now(),
          name: adminInfo.name || '未命名',
          phone: adminInfo.phone,
          openId: adminInfo.openId || '',
          status: 1,
          createdAt: new Date().toISOString()
        };
        data.admins.push(newAdmin);
        this.saveDB(data);
        resolve({ code: 200, data: newAdmin });
      }, 300);
    });
  },

  // 删除管理员
  deleteAdmin(adminId) {
    return new Promise(resolve => {
      setTimeout(() => {
        const data = this.getDB();
        const idx = data.admins.findIndex(a => a.id === adminId);
        if (idx >= 0) {
          data.admins.splice(idx, 1);
          this.saveDB(data);
          resolve({ code: 200 });
        } else {
          resolve({ code: 404 });
        }
      }, 200);
    });
  },

  // 检查 openId 是否为管理员
  isAdminOpenId(openId) {
    const data = this.getDB();
    return (data.admins || []).some(a => a.openId === openId && a.status === 1);
  },

  getStoreOwnerByOpenId(openId) {
    const data = this.getDB();
    return (data.storeOwners || []).find(owner => owner.openId === openId && owner.status !== 0) || null;
  },

  bindStoreOwnerOpenId(phone, openId) {
    const data = this.getDB();
    const normalizedPhone = String(phone || '').trim();
    if (!/^1\d{10}$/.test(normalizedPhone)) {
      return { code: 400, message: '请输入正确的11位手机号' };
    }

    let storeOwner = (data.storeOwners || []).find(owner => owner.phone === normalizedPhone);
    if (!storeOwner) {
      const store = (data.stores || []).find(item => item.phone === normalizedPhone);
      if (!store) {
        return { code: 404, message: '未查询到已绑定的门店负责人，请联系管理员配置' };
      }

      storeOwner = {
        id: 'SO' + Date.now(),
        phone: normalizedPhone,
        storeId: store.id,
        storeName: store.name,
        role: 'store_owner',
        openId: '',
        status: 1,
        createdAt: new Date().toISOString()
      };
      data.storeOwners = data.storeOwners || [];
      data.storeOwners.push(storeOwner);
    }

    (data.storeOwners || []).forEach((owner) => {
      if (owner.openId === openId && owner.phone !== normalizedPhone) {
        owner.openId = '';
      }
    });

    storeOwner.openId = openId;
    storeOwner.status = 1;
    storeOwner.boundAt = new Date().toISOString();
    this.saveDB(data);

    return {
      code: 200,
      data: {
        ...storeOwner,
        store: (data.stores || []).find(store => store.id === storeOwner.storeId) || null
      }
    };
  },

  // 【调试工具】禁用自动推进（调用后需手动在 Admin 后台操作）
  disableAutoAdvance() {
    clearAllAutoAdvance();
    console.log('[Mock] 自动推进已禁用，请手动在 Admin 后台操作合约状态');
  },

  // 【调试工具】清除所有数据（恢复初始状态）
  clearAllData() {
    clearAllAutoAdvance();
    wx.removeStorageSync('mockDB');
    console.log('[Mock] 所有数据已清除');
  },

  // 【调试工具】强制推进合约到完成（跳过等待）
  forceComplete(contractId) {
    const data = this.getDB();
    const idx = _findContractIndex(data, contractId);
    if (idx < 0) return;
    const signedAt = new Date().toISOString();
    data.contracts[idx].status = STATES.SIGNED;
    data.contracts[idx].signedAt = signedAt;
    data.contracts[idx].logistics = _prependLogistics(
      data.contracts[idx].logistics && data.contracts[idx].logistics.length > 0
        ? data.contracts[idx].logistics
        : _buildShipLogistics(data.contracts[idx].shippedAt || signedAt),
      { status: '已签收', time: _formatTimelineTime(signedAt) }
    );
    _ensureCouponsForContract(data, data.contracts[idx]);
    _clearContractAutoAdvance(contractId, ['qualify', 'contract', 'ship', 'sign']);
    mockAPI.saveDB(data);
    console.log('[Mock] 合约', contractId, '已强制完成');
  }
};

module.exports = { mockAPI, STATES };
