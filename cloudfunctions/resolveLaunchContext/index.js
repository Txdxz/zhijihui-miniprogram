const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function buildCustomerTarget() {
  return {
    key: 'customer',
    title: '客户首页',
    desc: '办理合约与查看权益',
    url: '/pages/index/index',
    routeType: 'switchTab'
  };
}

function buildBindTarget(inviteType) {
  const typeNames = {
    admin: '管理员',
    store_owner: '门店负责人',
    store_clerk: '店员'
  };
  return {
    key: 'bind',
    title: '身份绑定',
    desc: `检测到${typeNames[inviteType] || '待绑定'}邀请，请绑定手机号完成身份认证`,
    url: `/pages/bind/index?inviteType=${inviteType}`,
    routeType: 'reLaunch',
    inviteType
  };
}

function buildTargetByRole(role, storeMap) {
  if (!role || role.status !== 1) {
    return null;
  }

  if (role.roleKey === 'super_admin' || role.roleKey === 'admin') {
    return {
      key: role.roleKey,
      title: '管理后台',
      desc: role.roleKey === 'super_admin' ? '系统与管理员权限管理' : '合约、门店与运营配置',
      url: '/packageAdmin/pages/admin/index',
      routeType: 'reLaunch'
    };
  }

  if (role.roleKey === 'store_owner' || role.roleKey === 'store_clerk') {
    const store = storeMap.get(role.scopeId);
    if (!store) {
      return null;
    }

    return {
      key: role.roleKey,
      title: '门店核销',
      desc: `${store.name} 核销工作台`,
      url: `/pages/store/verify?storeId=${store.storeId}`,
      routeType: 'reLaunch',
      storeId: store.storeId
    };
  }

  return null;
}

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext();
    const lastPortalRole = String(event.lastPortalRole || '');
    const customerTarget = buildCustomerTarget();

    // 确保 portal_users 记录存在
    try {
      const usersCollection = db.collection('portal_users');
      const existingUser = await usersCollection.where({ openId: OPENID }).limit(1).get();
      if (existingUser.data.length === 0) {
        const now = Date.now();
        await usersCollection.add({
          data: {
            openId: OPENID,
            appId: '',
            nickName: '',
            avatarUrl: '',
            phone: '',
            status: 1,
            lastLoginAt: now,
            createdAt: now,
            updatedAt: now
          }
        });
      }
    } catch (e) {
      console.error('resolveLaunchContext createUser error:', e);
    }

  const roleRes = await db.collection('portal_roles').where({
    openId: OPENID,
    status: 1
  }).get();

  const roles = roleRes.data || [];
  const storeIds = roles
    .filter(item => item.scopeType === 'store' && item.scopeId)
    .map(item => item.scopeId);

  const uniqueStoreIds = Array.from(new Set(storeIds));
  let storeMap = new Map();

  if (uniqueStoreIds.length > 0) {
    const storeRes = await db.collection('stores').where({
      storeId: db.command.in(uniqueStoreIds)
    }).get();

    storeMap = new Map((storeRes.data || []).map(store => [store.storeId, store]));
  }

  const roleOptions = roles
    .map(role => buildTargetByRole(role, storeMap))
    .filter(Boolean);

  // 用户没有任何已绑定角色时，检查是否有待绑定的邀请
  if (!roleOptions.length) {
    const inviteRes = await db.collection('staff_invites').where({
      boundOpenId: '',
      status: 1
    }).limit(1).get();

    const pendingInvite = inviteRes.data && inviteRes.data[0];
    if (pendingInvite) {
      // 尝试自动绑定：用户手机号匹配邀请手机号时自动创建角色
      let autoBound = false;
      let userHasPhone = false;
      try {
        const userRes = await db.collection('portal_users').where({ openId: OPENID }).limit(1).get();
        const user = userRes.data && userRes.data[0];
        userHasPhone = !!(user && user.phone);
        if (user && user.phone && user.phone === pendingInvite.phone) {
          const existing = await db.collection('portal_roles').where({
            openId: OPENID,
            roleKey: pendingInvite.roleKey,
            scopeType: pendingInvite.scopeType,
            scopeId: pendingInvite.scopeId,
            status: 1
          }).limit(1).get();

          if (existing.data.length === 0) {
            const now = new Date().toISOString();
            await db.collection('portal_roles').add({
              data: {
                openId: OPENID,
                roleKey: pendingInvite.roleKey,
                name: pendingInvite.name || '',
                phone: user.phone,
                scopeType: pendingInvite.scopeType,
                scopeId: pendingInvite.scopeId,
                scopeName: pendingInvite.scopeName || '',
                permissions: pendingInvite.permissions || [],
                status: 1,
                boundBy: 'auto_bind',
                createdAt: now,
                updatedAt: now
              }
            });
            await db.collection('staff_invites').doc(pendingInvite._id).update({
              data: { boundOpenId: OPENID, boundAt: now, updatedAt: now }
            });
          }
          autoBound = true;
        }
      } catch (e) {
        console.error('auto-bind error:', e);
      }

      if (autoBound) {
        // 自动绑定成功 → 正常分流
        const newRoleRes = await db.collection('portal_roles').where({
          openId: OPENID,
          status: 1
        }).get();

        const newRoles = newRoleRes.data || [];
        const newStoreIds = newRoles
          .filter(r => r.scopeType === 'store' && r.scopeId)
          .map(r => r.scopeId);
        let newStoreMap = storeMap;
        if (newStoreIds.length > 0 && !storeMap.size) {
          const sr = await db.collection('stores').where({
            storeId: db.command.in([...new Set(newStoreIds)])
          }).get();
          newStoreMap = new Map((sr.data || []).map(s => [s.storeId, s]));
        }

        const newRoleOptions = newRoles
          .map(r => buildTargetByRole(r, newStoreMap))
          .filter(Boolean);

        if (newRoleOptions.length > 0) {
          // 返回自动绑定后的角色目标
          return {
            code: 200,
            data: {
              openId: OPENID,
              role: newRoleOptions[0].key,
              target: newRoleOptions[0],
              roleOptions: [customerTarget].concat(newRoleOptions),
              needsChoice: false
            }
          };
        }
      }

      // 自动绑定不适用，引导用户去绑定页面
      return {
        code: 200,
        data: {
          openId: OPENID,
          role: 'bind',
          target: buildBindTarget(pendingInvite.roleKey),
          roleOptions: [],
          needsChoice: false,
          needsPhoneBind: !userHasPhone,
          pendingInvite: {
            roleKey: pendingInvite.roleKey,
            name: pendingInvite.name || ''
          }
        }
      };
    }

    // 没有待绑定邀请，作为普通客户
    return {
      code: 200,
      data: {
        openId: OPENID,
        role: 'customer',
        target: customerTarget,
        roleOptions: [],
        needsChoice: false
      }
    };
  }

  // 用户有其他身份（管理员/门店）时，即使上次去了客户页，也展示完整入口
  if (lastPortalRole === 'customer' && !roleOptions.length) {
    return {
      code: 200,
      data: {
        openId: OPENID,
        role: 'customer',
        target: customerTarget,
        roleOptions: [],
        needsChoice: false
      }
    };
  }

  if (lastPortalRole === 'customer' && roleOptions.length > 0) {
    return {
      code: 200,
      data: {
        openId: OPENID,
        role: '',
        target: null,
        roleOptions: [customerTarget].concat(roleOptions),
        needsChoice: true
      }
    };
  }

  const remembered = roleOptions.find(item => item.key === lastPortalRole);
  if (remembered) {
    return {
      code: 200,
      data: {
        openId: OPENID,
        role: remembered.key,
        target: remembered,
        roleOptions,
        needsChoice: false
      }
    };
  }

  if (roleOptions.length === 1) {
    return {
      code: 200,
      data: {
        openId: OPENID,
        role: roleOptions[0].key,
        target: roleOptions[0],
        roleOptions: [customerTarget].concat(roleOptions),
        needsChoice: false
      }
    };
  }

  return {
    code: 200,
    data: {
      openId: OPENID,
      role: '',
      target: null,
      roleOptions: [customerTarget].concat(roleOptions),
      needsChoice: true
    }
  };
  } catch (error) {
    console.error('resolveLaunchContext 错误:', error);
    return {
      code: 500,
      message: error && error.message ? error.message : '服务异常'
    };
  }
};
