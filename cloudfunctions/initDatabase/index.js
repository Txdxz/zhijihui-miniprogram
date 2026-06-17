/**
 * 云函数：initDatabase
 * 用途：初始化数据库集合和示例数据
 * 
 * 使用方法：
 * 1. 在微信开发者工具中右键 cloudfunctions/initDatabase → 上传并部署
 * 2. 在云开发控制台云端测试，输入 {}
 * 3. 查看返回结果确认初始化成功
 * 4. 删除此云函数（避免被滥用）
 */

// ⚠️ 安全警告：此云函数仅用于开发环境首次安装
// 上线前必须删除此云函数！删除！不是注释掉！
// 删除方法：在微信开发者工具中右键 cloudfunctions/initDatabase → 删除

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

// 初始化数据
const INIT_DATA = {
  // 中国移动权益指定门店
  stores: [
    {
      storeId: 'store_001',
      name: '猫庄宠物用品超市(众创大厦店)',
      address: '河北省石家庄市（众创大厦店）',
      province: '河北省',
      city: '石家庄市',
      district: '',
      phone: '',
      status: 1,
      location: { lat: 0, lng: 0 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      storeId: 'store_002',
      name: '裕华小甄宠物用品店',
      address: '河北省石家庄市裕华区',
      province: '河北省',
      city: '石家庄市',
      district: '裕华区',
      phone: '',
      status: 1,
      location: { lat: 0, lng: 0 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      storeId: 'store_003',
      name: '猫庄·宠物生活馆',
      address: '河北省石家庄市',
      province: '河北省',
      city: '石家庄市',
      district: '',
      phone: '',
      status: 1,
      location: { lat: 0, lng: 0 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      storeId: 'store_004',
      name: '小鹿宠物(盛邦花园六区店)',
      address: '河北省石家庄市盛邦花园六区',
      province: '河北省',
      city: '石家庄市',
      district: '',
      phone: '',
      status: 1,
      location: { lat: 0, lng: 0 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      storeId: 'store_005',
      name: '有猫腻宠物生活馆',
      address: '河北省石家庄市',
      province: '河北省',
      city: '石家庄市',
      district: '',
      phone: '',
      status: 1,
      location: { lat: 0, lng: 0 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      storeId: 'store_006',
      name: '芊宠萌宠物服务',
      address: '河北省石家庄市',
      province: '河北省',
      city: '石家庄市',
      district: '',
      phone: '',
      status: 1,
      location: { lat: 0, lng: 0 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      storeId: 'store_007',
      name: '安淇宠物医院（秦皇岛店）',
      address: '河北省秦皇岛市',
      province: '河北省',
      city: '秦皇岛市',
      district: '',
      phone: '',
      status: 1,
      location: { lat: 0, lng: 0 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ]
};

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();

  // ⚠️ 安全警告：此云函数仅用于开发环境首次安装
  // 上线前必须删除此云函数！删除！不是注释掉！
  // 删除方法：在微信开发者工具中右键 cloudfunctions/initDatabase → 删除

  // 密钥验证（防止生产环境误调用）
  const initSecret = String((event || {}).initSecret || '');
  if (initSecret !== 'zjh_init_2024') {
    return { code: 403, message: '未授权操作，请联系开发者' };
  }

  const results = {
    collections: [],
    data: [],
    errors: []
  };

  try {
    // 安全检查1：检查是否已有超级管理员
    const existingAdminCheck = await db.collection('portal_roles')
      .where({
        roleKey: 'super_admin',
        status: 1
      })
      .limit(1)
      .get();
    
    // 如果已有超级管理员，禁止再次初始化
    if (existingAdminCheck.data && existingAdminCheck.data.length > 0) {
      return {
        code: 403,
        message: '系统已初始化，禁止重复操作'
      };
    }
    
    // 安全检查2：验证调用者是否为预配置的超级管理员
    // 注意：在首次初始化时，portal_roles 集合可能还不存在，所以需要捕获错误
    let isSuperAdmin = false;
    try {
      const adminCheck = await db.collection('portal_roles')
        .where({
          openId: OPENID,
          roleKey: 'super_admin',
          status: 1
        })
        .limit(1)
        .get();
      isSuperAdmin = !!(adminCheck.data && adminCheck.data.length > 0);
    } catch (error) {
      // 集合不存在，首次初始化时会进入这里
      // 首次初始化时允许执行
      isSuperAdmin = true;
    }
    
    // 非首次初始化时，只有超级管理员可以执行
    if (!isSuperAdmin) {
      return {
        code: 403,
        message: '权限不足，只有超级管理员可以执行初始化操作'
      };
    }
    // ============================================
    // 第一步：创建集合（如果不存在）
    // ============================================
    const requiredCollections = [
      'portal_users',
      'portal_roles',
      'stores',
      'contracts',
      'coupons',
      'staff_invites',
      'coupon_rules',
      'admin_subscriptions',
      'sms_verifications',
      'rate_limits'
    ];

    for (const collectionName of requiredCollections) {
      try {
        // 尝试创建集合
        await db.createCollection(collectionName);
        results.collections.push({
          name: collectionName,
          action: 'created'
        });
      } catch (err) {
        // 如果集合已存在，会抛出错误，忽略即可
        if (err.errCode === -1 || err.message.includes('already exists')) {
          results.collections.push({
            name: collectionName,
            action: 'already_exists'
          });
        } else {
          // 其他错误，记录但不中断
          results.collections.push({
            name: collectionName,
            action: 'error',
            error: err.message
          });
        }
      }
    }

    // ============================================
    // 第二步：添加超级管理员（支持多个）
    // ============================================
    // 添加当前调用者为超级管理员
    const adminCheck = await db.collection('portal_roles')
      .where({
        openId: OPENID,
        roleKey: 'super_admin'
      })
      .limit(1)
      .get();

    if (adminCheck.data.length === 0) {
      await db.collection('portal_roles').add({
        data: {
          openId: OPENID,
          roleKey: 'super_admin',
          status: 1,
          scopeType: 'global',
          scopeId: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      });
      results.data.push({
        collection: 'portal_roles',
        action: 'added_super_admin',
        openId: OPENID
      });
    } else {
      results.data.push({
        collection: 'portal_roles',
        action: 'super_admin_already_exists',
        openId: OPENID
      });
    }

    // ============================================    // 第三步：添加测试门店    // ============================================
    for (const store of INIT_DATA.stores) {
      const storeCheck = await db.collection('stores')
        .where({ storeId: store.storeId })
        .limit(1)
        .get();

      if (storeCheck.data.length === 0) {
        await db.collection('stores').add({ data: store });
        results.data.push({
          collection: 'stores',
          action: 'added_store',
          storeId: store.storeId
        });
      } else {
        results.data.push({
          collection: 'stores',
          action: 'store_already_exists',
          storeId: store.storeId
        });
      }
    }

    // ============================================
    // 第四步：添加数据库索引
    // ============================================
    try {
      // 为 contracts 集合添加索引
      await db.collection('contracts').createIndex({
        openId: 1
      });
      await db.collection('contracts').createIndex({
        contractId: 1
      });
      await db.collection('contracts').createIndex({
        status: 1
      });
      await db.collection('contracts').createIndex({
        createdAt: -1
      });

      // 为 coupons 集合添加索引
      await db.collection('coupons').createIndex({
        contractId: 1
      });
      await db.collection('coupons').createIndex({
        storeId: 1
      });
      await db.collection('coupons').createIndex({
        verifyCode: 1
      });
      await db.collection('coupons').createIndex({
        status: 1
      });

      // 为 stores 集合添加索引
      await db.collection('stores').createIndex({
        storeId: 1
      });
      await db.collection('stores').createIndex({
        status: 1
      });

      // 为 portal_roles 集合添加索引
      await db.collection('portal_roles').createIndex({
        openId: 1
      });
      await db.collection('portal_roles').createIndex({
        roleKey: 1
      });
      await db.collection('portal_roles').createIndex({
        status: 1
      });

      // 为 portal_users 集合添加索引
      await db.collection('portal_users').createIndex({
        openId: 1
      });

      // 为 staff_invites 集合添加索引
      await db.collection('staff_invites').createIndex({
        phone: 1
      });
      await db.collection('staff_invites').createIndex({
        status: 1
      });

      // 为 coupon_rules 集合添加索引
      await db.collection('coupon_rules').createIndex({
        status: 1
      });

      // 为 rate_limits 集合添加索引（频率限制用）
      await db.collection('rate_limits').createIndex({
        key: 1
      });
      await db.collection('rate_limits').createIndex({
        timestamp: -1
      });

      // 为 sms_verifications 集合添加索引
      await db.collection('sms_verifications').createIndex({
        phone: 1
      });
      await db.collection('sms_verifications').createIndex({
        code: 1
      });

      results.data.push({
        collection: 'indexes',
        action: 'added_indexes',
        message: '数据库索引添加成功'
      });
    } catch (err) {
      console.error('添加索引失败:', err);
      results.errors.push({
        message: '添加索引失败: ' + err.message
      });
    }

    return {
      code: 200,
      message: '数据库初始化成功',
      data: results
    };

  } catch (error) {
    console.error('数据库初始化失败:', error);
    results.errors.push({
      message: error.message,
      stack: error.stack
    });

    return {
      code: 500,
      message: '数据库初始化失败',
      data: results,
      error: error.message
    };
  }
};
