/**
 * TypeScript 类型定义
 */

// 合约状态
export enum ContractStatus {
  REJECTED = 0,         // 已拒绝
  WAIT_VERIFY = 1,       // 待核验
  QUALIFIED = 2,         // 核验通过
  WAIT_SMSCODE = 3,      // 待验证码
  CONTRACTING = 4,       // 办理中
  CONTRACT_OK = 5,       // 合约已办
  SHIPPED = 6,           // 已发货
  SIGNED = 7,            // 已完成
  SMS_CODE_REJECTED = 8   // 验证码被驳回
}

// 门店信息
export interface Store {
  id: string;
  storeId: string;
  name: string;
  province: string;
  city: string;
  district: string;
  address: string;
  phone: string;
  owner: string;
  location?: { lat: number; lng: number };
  status: number;
  createdAt?: string;
  updatedAt?: string;
}

// 合约信息
export interface Contract {
  id: string;
  contractId: string;
  openId: string;
  phone: string;
  storeId: string;
  storeName: string;
  status: ContractStatus;
  name: string;
  address: string;
  smsCode: string;
  trackingNo: string;
  logistics?: Array<{ status: string; time: string }>;
  createdAt: string;
  updatedAt: string;
  contractOkAt?: string;
  shippedAt?: string;
  signedAt?: string;
  smsCodeRejectedAt?: string;
  smsCodeRejectReason?: string;
}

// 代金券信息
export interface Coupon {
  id: string;
  couponId: string;
  contractId: string;
  openId: string;
  storeId: string;
  storeName: string;
  amount: number;
  monthlyLimit: number;
  ruleId: string;
  period: number;
  periodMonth: string;
  status: number;
  activateDate: string;
  usedCount: number;
  usedTimes: number;
  verifyCode: string;
  verifyExpireAt: number;
  usedAt: string;
  createdAt: string;
  updatedAt: string;
}

// 角色信息
export interface Role {
  openId: string;
  roleKey: string;
  status: number;
  scopeType: string;
  scopeId: string;
  phone?: string;
  createdAt: string;
  updatedAt: string;
}

// 核销记录
export interface VerifyRecord {
  amount: number;
  phone: string;
  time: string;
  date: string;
}

// 按月归集的核销记录
export interface VerifyRecordsByMonth {
  month: string;
  list: VerifyRecord[];
  total: number;
}

// API 响应
export interface ApiResponse<T = any> {
  code: number;
  message?: string;
  data?: T;
}

// 分页参数
export interface Pagination {
  page: number;
  pageSize: number;
}

// 分页响应
export interface PaginatedResponse<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
