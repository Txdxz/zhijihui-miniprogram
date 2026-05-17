const cloud = require('wx-server-sdk');
const { checkRateLimit } = require('./rateLimit');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

async function ensureSuperAdmin(openId) {
  const res = await db.collection('portal_roles').where({
    openId,
    roleKey: _.in(['super_admin']),
    status: 1
  }).limit(1).get();

  return !!(res.data && res.data.length);
}

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext();
    const action = String(event.action || '').trim();

    // 频率限制
    if (action) {
      const rateCheck = await checkRateLimit(OPENID, 'manageAdmin_' + (action || 'default'));
      if (!rateCheck.allowed) {
        return { code: 429, message: rateCheck.message };
      }
    }

    const now = new Date().toISOString();

    const isSuperAdmin = await ensureSuperAdmin(OPENID);
    if (!isSuperAdmin) {
      return { code: 403, message: '仅超级管理员可管理管理员账号' };
    }

  if (action === 'list') {
    const admins = await db.collection('portal_roles').where({
      roleKey: _.in(['admin', 'super_admin']),
      status: 1
    }).get();

    // 从 staff_invites 表补充 phone 信息（兼容旧数据）
    const roles = admins.data || [];
    const openIds = roles.map(r => r.openId).filter(Boolean);

    let inviteMap = {};
    if (openIds.length > 0) {
      const invites = await db.collection('staff_invites').where({
        boundOpenId: _.in(openIds),
        roleKey: 'admin',
        status: 1
      }).get();
      inviteMap = (invites.data || []).reduce((acc, inv) => {
        if (inv.boundOpenId) acc[inv.boundOpenId] = inv;
        return acc;
      }, {});
    }

    const mergedData = roles.map(role => {
      const invite = inviteMap[role.openId] || {};
      return {
        ...role,
        name: role.name || invite.name || '',
        phone: role.phone || invite.phone || ''
      };
    });

    return { code: 200, data: mergedData };
  }

  if (action === 'invite') {
    const phone = String(event.phone || '').trim();
    const name = String(event.name || '').trim();

    if (!name) {
      return { code: 400, message: '请填写管理员姓名' };
    }
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      return { code: 400, message: '请输入正确的11位手机号' };
    }

    const existing = await db.collection('staff_invites').where({
      phone,
      roleKey: 'admin',
      scopeType: 'system',
      scopeId: 'portal',
      status: 1
    }).limit(1).get();

    if (existing.data && existing.data.length) {
      const current = existing.data[0];
      await db.collection('staff_invites').doc(current._id).update({
        data: {
          name,
          updatedAt: now
        }
      });
      return { code: 200, data: { ...current, name, updatedAt: now } };
    }

    const invite = {
      phone,
      name,
      roleKey: 'admin',
      scopeType: 'system',
      scopeId: 'portal',
      scopeName: '智机惠管理后台',
      permissions: ['contract.manage', 'store.manage', 'coupon.rules.manage'],
      status: 1,
      boundOpenId: '',
      boundAt: '',
      createdBy: OPENID,
      createdAt: now,
      updatedAt: now
    };

    const addRes = await db.collection('staff_invites').add({ data: invite });
    return { code: 200, data: { _id: addRes._id, ...invite } };
  }

  if (action === 'update') {
    const roleId = String(event.roleId || '').trim();
    const name = String(event.name || '').trim();
    const phone = String(event.phone || '').trim();

    if (!roleId) {
      return { code: 400, message: '缺少角色标识' };
    }
    if (!name) {
      return { code: 400, message: '请填写管理员姓名' };
    }
    if (phone && !/^1[3-9]\d{9}$/.test(phone)) {
      return { code: 400, message: '请输入正确的11位手机号' };
    }

    // 更新 portal_roles 表中的管理员信息
    await db.collection('portal_roles').doc(roleId).update({
      data: {
        name,
        phone,
        updatedAt: now
      }
    });

    // 如果手机号变了，同步更新 staff_invites 表
    if (phone) {
      const inviteRes = await db.collection('staff_invites').where({
        boundOpenId: OPENID,
        roleKey: 'admin',
        status: 1
      }).limit(1).get();

      if (inviteRes.data && inviteRes.data.length) {
        await db.collection('staff_invites').doc(inviteRes.data[0]._id).update({
          data: {
            name,
            phone,
            updatedAt: now
          }
        });
      }
    }

    return { code: 200, data: { roleId, name, phone, updatedAt: now } };
  }

  if (action === 'disableRole') {
    const roleId = String(event.roleId || '').trim();
    if (!roleId) {
      return { code: 400, message: '缺少角色标识' };
    }

    // 检查要删除的角色是否是超级管理员
    const roleRes = await db.collection('portal_roles').doc(roleId).get();
    if (roleRes.data && roleRes.data.roleKey === 'super_admin') {
      return { code: 400, message: '超级管理员不能被删除' };
    }

    await db.collection('portal_roles').doc(roleId).update({
      data: {
        status: 0,
        updatedAt: now
      }
    });

    return { code: 200, data: { roleId, status: 0 } };
  }

  return { code: 400, message: '不支持的管理员操作' };
  } catch (error) {
    console.error('manageAdmin 错误:', error);
    return {
      code: 500,
      message: error && error.message ? error.message : '服务异常'
    };
  }
};
