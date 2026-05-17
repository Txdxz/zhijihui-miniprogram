const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async () => {
  try {
    const { OPENID, APPID } = cloud.getWXContext();
    const now = new Date().toISOString();
    const collection = db.collection('portal_users');

  const existing = await collection.where({ openId: OPENID }).limit(1).get();
  const currentUser = existing.data && existing.data[0];

  if (!currentUser) {
    const user = {
      openId: OPENID,
      appId: APPID,
      nickName: '',
      avatarUrl: '',
      phone: '',
      status: 1,
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now
    };

    const addRes = await collection.add({ data: user });
    return {
      code: 200,
      data: {
        openId: OPENID,
        user: { _id: addRes._id, ...user }
      }
    };
  }

  await collection.doc(currentUser._id).update({
    data: {
      lastLoginAt: now,
      updatedAt: now
    }
  });

  return {
    code: 200,
    data: {
      openId: OPENID,
      user: {
        ...currentUser,
        lastLoginAt: now,
        updatedAt: now
      }
    }
  };
  } catch (error) {
    console.error('login 错误:', error);
    return {
      code: 500,
      message: error && error.message ? error.message : '服务异常'
    };
  }
};
