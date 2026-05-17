/**
 * 权限管理工具函数
 */

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

/**
 * 检查用户是否具有指定角色
 * @param {string} openId - 用户的 openId
 * @param {array} roleKeys - 角色键数组
 * @returns {boolean} 是否具有指定角色
 */
async function ensureRole(openId, roleKeys = []) {
  const res = await db.collection('portal_roles').where({
    openId,
    roleKey: _.in(roleKeys),
    status: 1
  }).limit(1).get();
  return !!(res.data && res.data.length);
}

/**
 * 检查用户是否为超级管理员
 * @param {string} openId - 用户的 openId
 * @returns {boolean} 是否为超级管理员
 */
async function ensureSuperAdmin(openId) {
  const res = await db.collection('portal_roles').where({
    openId,
    roleKey: 'super_admin',
    status: 1
  }).limit(1).get();
  return !!(res.data && res.data.length);
}

/**
 * 检查用户是否具有门店角色
 * @param {string} openId - 用户的 openId
 * @param {string} storeId - 门店 ID
 * @returns {boolean} 是否具有门店角色
 */
async function ensureStoreRole(openId, storeId) {
  const res = await db.collection('portal_roles').where({
    openId,
    roleKey: _.in(['store_owner', 'store_clerk']),
    scopeType: 'store',
    scopeId: storeId,
    status: 1
  }).limit(1).get();
  return !!(res.data && res.data.length);
}

/**
 * 根据门店 ID 获取门店信息
 * @param {string} storeId - 门店 ID
 * @returns {object} 门店信息
 */
async function getStoreById(storeId) {
  const res = await db.collection('stores').where({
    storeId,
    status: _.neq(0)
  }).limit(1).get();
  return res.data && res.data[0] ? res.data[0] : null;
}

/**
 * 设置用户的当前合约 ID
 * @param {string} openId - 用户的 openId
 * @param {string} contractId - 合约 ID
 */
async function setCurrentContractId(openId, contractId) {
  const users = db.collection('portal_users');
  const now = new Date().toISOString();
  const existing = await users.where({ openId }).limit(1).get();
  if (existing.data && existing.data.length) {
    await users.doc(existing.data[0]._id).update({
      data: {
        currentContractId: contractId || '',
        updatedAt: now
      }
    });
    return;
  }
  await users.add({
    data: {
      openId,
      status: 1,
      currentContractId: contractId || '',
      createdAt: now,
      updatedAt: now
    }
  });
}

/**
 * 更新用户的手机号
 * 在用户办理业务时自动同步手机号到用户表
 * @param {string} openId - 用户的 openId
 * @param {string} phone - 手机号
 */
async function updateUserPhone(openId, phone) {
  if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
    return;
  }

  const users = db.collection('portal_users');
  const now = new Date().toISOString();
  const existing = await users.where({ openId }).limit(1).get();

  if (existing.data && existing.data.length) {
    // 更新现有用户记录的手机号
    await users.doc(existing.data[0]._id).update({
      data: {
        phone,
        updatedAt: now
      }
    });
  } else {
    // 创建新用户记录（兜底，理论上不应该走到这里）
    await users.add({
      data: {
        openId,
        phone,
        nickName: '',
        avatarUrl: '',
        status: 1,
        createdAt: now,
        updatedAt: now
      }
    });
  }
}

module.exports = {
  ensureRole,
  ensureSuperAdmin,
  ensureStoreRole,
  getStoreById,
  setCurrentContractId,
  updateUserPhone
};