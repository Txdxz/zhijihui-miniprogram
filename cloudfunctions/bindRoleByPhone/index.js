const cloud = require('wx-server-sdk');
const { checkRateLimit } = require('./rateLimit');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext();

    const rateCheck = await checkRateLimit(OPENID, 'bindRole');
    if (!rateCheck.allowed) {
      return { code: 429, message: rateCheck.message };
    }

    const now = new Date().toISOString();
    const phone = String(event.phone || '').trim();
    const roleKey = String(event.roleKey || '').trim();

    if (!/^1[3-9]\d{9}$/.test(phone)) {
      return { code: 400, message: '请输入正确的11位手机号' };
    }

    if (!['admin', 'store_owner', 'store_clerk'].includes(roleKey)) {
      return { code: 400, message: '不支持的绑定角色' };
    }

    // 直接查询待绑定邀请，无需短信验证
    const inviteRes = await db.collection('staff_invites').where({
      phone,
      roleKey,
      status: 1,
      boundOpenId: ''
    }).limit(1).get();

    const invite = inviteRes.data && inviteRes.data[0];
    if (!invite) {
      return { code: 404, message: '未找到可绑定的角色，请联系管理员配置' };
    }

    // 创建门户角色记录
    const roleCollection = db.collection('portal_roles');
    const existingRoleRes = await roleCollection.where({
      openId: OPENID,
      roleKey,
      scopeType: invite.scopeType,
      scopeId: invite.scopeId,
      status: 1
    }).limit(1).get();

    if (!existingRoleRes.data.length) {
      await roleCollection.add({
        data: {
          openId: OPENID,
          roleKey,
          name: invite.name || '',
          phone: phone,
          scopeType: invite.scopeType,
          scopeId: invite.scopeId,
          scopeName: invite.scopeName || '',
          permissions: invite.permissions || [],
          status: 1,
          boundBy: 'self_bind',
          createdAt: now,
          updatedAt: now
        }
      });
    }

    // 标记邀请为已绑定
    await db.collection('staff_invites').doc(invite._id).update({
      data: {
        boundOpenId: OPENID,
        boundAt: now,
        updatedAt: now
      }
    });

    return {
      code: 200,
      data: {
        openId: OPENID,
        roleKey,
        scopeType: invite.scopeType,
        scopeId: invite.scopeId
      }
    };
  } catch (error) {
    console.error('bindRoleByPhone 错误:', error);
    return {
      code: 500,
      message: error && error.message ? error.message : '服务异常'
    };
  }
};
