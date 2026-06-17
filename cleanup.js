const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async () => {
  // 1. 清除所有 staff_invites（邀请记录）
  const invites = await db.collection('staff_invites').where({}).get();
  const inviteIds = (invites.data || []).map(r => r._id);
  let deletedInvites = 0;
  for (const id of inviteIds) {
    await db.collection('staff_invites').doc(id).remove();
    deletedInvites++;
  }

  // 2. 清除除 super_admin 外的 portal_roles
  const roles = await db.collection('portal_roles').where({
    roleKey: _.neq('super_admin')
  }).get();
  const roleIds = (roles.data || []).map(r => r._id);
  let deletedRoles = 0;
  for (const id of roleIds) {
    await db.collection('portal_roles').doc(id).remove();
    deletedRoles++;
  }

  // 3. 清除 login_sessions
  const sessions = await db.collection('login_sessions').where({}).get();
  const sessionIds = (sessions.data || []).map(r => r._id);
  let deletedSessions = 0;
  for (const id of sessionIds) {
    await db.collection('login_sessions').doc(id).remove();
    deletedSessions++;
  }

  return {
    deletedInvites,
    deletedRoles,
    deletedSessions
  };
};
