# 智机惠小程序 - 数据库初始化指南

## 一、云开发控制台入口

### 方法一：微信开发者工具顶部工具栏
1. 打开微信开发者工具
2. 顶部工具栏找到 **「云开发」** 按钮（云朵图标 ☁️）
3. 点击即可打开云开发控制台

### 方法二：快捷键
- Windows: `Ctrl + Shift + D`
- Mac: `Cmd + Shift + D`

---

## 二、创建数据库集合

### 步骤
1. 打开云开发控制台
2. 左侧菜单点击 **「数据库」**
3. 点击 **「添加集合」** 按钮
4. 输入集合名称，点击确定
5. 重复以上步骤，创建以下 6 个集合

### 需要创建的集合列表

| 序号 | 集合名称 | 用途 |
|------|---------|------|
| 1 | `portal_users` | 用户表（存储 openId、角色、当前合约） |
| 2 | `portal_roles` | 角色权限表（管理员、门店负责人） |
| 3 | `stores` | 门店表（门店信息、地址、定位） |
| 4 | `contracts` | 合约表（客户办理记录） |
| 5 | `coupons` | 代金券表（优惠券发放记录） |
| 6 | `staff_invites` | 员工邀请表（绑定手机号邀请） |
| 7 | `coupon_rules` | 代金券规则表（面额、有效期等配置） |
| 8 | `admin_subscriptions` | 管理员消息订阅记录 |
| 9 | `sms_verifications` | 短信验证码记录 |
| 10 | `rate_limits` | API 调用频率限制记录 |

---

## 三、设置数据库权限

### 权限规则（重要！）

每个集合创建后，需要设置权限：

#### 步骤
1. 点击集合名称
2. 点击 **「权限设置」** 标签
3. 选择 **「自定义安全规则」**
4. 粘贴以下规则（所有集合通用）：

```json
{
  "read": false,
  "write": false
}
```

#### 说明
- `read: false` - 禁止客户端直接读取，所有数据访问通过云函数进行
- `write: false` - 禁止客户端直接写入，所有数据操作通过云函数进行

---

## 四、初始化示例数据

### 方法一：通过云开发控制台手动添加

#### 1. 添加超级管理员（portal_roles）

**步骤：**
1. 点击 `portal_roles` 集合
2. 点击 **「添加记录」**
3. 切换到 **「JSON」** 模式
4. 粘贴以下数据：

```json
{
  "openId": "你的微信 openId",
  "roleKey": "super_admin",
  "status": 1,
  "scopeType": "global",
  "scopeId": "",
  "createdAt": "2026-04-10T08:00:00.000Z",
  "updatedAt": "2026-04-10T08:00:00.000Z"
}
```

**⚠️ 重要：**
- `openId` 需要替换为你的真实 openId
- 获取 openId 方法：
  1. 部署 `login` 云函数
  2. 小程序中调用登录
  3. 查看云函数日志，获取 openId

#### 2. 添加测试门店（stores）

```json
{
  "storeId": "store_001",
  "name": "多尼斯宠物店（测试门店）",
  "address": "山西省太原市小店区体育路88号",
  "province": "山西省",
  "city": "太原市",
  "district": "小店区",
  "phone": "0351-1234567",
  "status": 1,
  "location": {
    "lat": 37.7968,
    "lng": 112.5602
  },
  "createdAt": "2026-04-10T08:00:00.000Z",
  "updatedAt": "2026-04-10T08:00:00.000Z"
}
```

#### 3. 添加门店负责人角色（portal_roles）

```json
{
  "openId": "门店负责人的微信 openId",
  "roleKey": "store_owner",
  "status": 1,
  "scopeType": "store",
  "scopeId": "store_001",
  "createdAt": "2026-04-10T08:00:00.000Z",
  "updatedAt": "2026-04-10T08:00:00.000Z"
}
```

---

### 方法二：通过云函数批量初始化（推荐）

已为你准备好初始化云函数 `initDatabase`，使用步骤：

#### 步骤 1：上传初始化云函数

1. 在微信开发者工具中，找到 `cloudfunctions/initDatabase/` 文件夹
2. 右键点击 `initDatabase` 文件夹
3. 选择 **「上传并部署：云端安装依赖」**
4. 等待上传完成

#### 步骤 2：调用初始化云函数

**方法一：在小程序中调用**

打开 `pages/launch/index.js`，在 `onLoad` 中添加：

```javascript
// 临时调用初始化（仅首次部署时使用）
wx.cloud.callFunction({
  name: 'initDatabase',
  success: (res) => {
    console.log('数据库初始化结果:', res);
    if (res.result.code === 200) {
      console.log('✅ 数据库初始化成功');
      console.log('创建的集合:', res.result.data.collections);
      console.log('添加的数据:', res.result.data.data);
    } else {
      console.error('❌ 数据库初始化失败:', res.result.message);
    }
  },
  fail: (err) => {
    console.error('调用云函数失败:', err);
  }
});
```

**方法二：在云开发控制台调用**

1. 打开云开发控制台
2. 左侧菜单 → 云函数
3. 点击 `initDatabase` 云函数
4. 点击 **「云端测试」** 标签
5. 输入 `{}`（空对象）
6. 点击 **「运行测试」**
7. 查看返回结果

#### 步骤 3：验证初始化结果

1. 打开云开发控制台 → 数据库
2. 检查是否创建了 6 个集合
3. 点击 `portal_roles` 集合，查看是否有超级管理员记录
4. 点击 `stores` 集合，查看是否有测试门店数据

#### 步骤 4：删除初始化云函数（重要！）

**⚠️ 为了安全，初始化完成后必须删除此云函数：**

1. 云开发控制台 → 云函数
2. 找到 `initDatabase` 云函数
3. 点击右侧 **「删除」** 按钮
4. 确认删除

**原因：** 避免被恶意调用，重复创建数据

---

## 五、初始化内容说明

### 自动创建的内容

#### 1. 数据库集合（6 个）
- ✅ `portal_users` - 用户表
- ✅ `portal_roles` - 角色权限表
- ✅ `stores` - 门店表
- ✅ `contracts` - 合约表
- ✅ `coupons` - 代金券表
- ✅ `staff_invites` - 员工邀请表

#### 2. 超级管理员（自动添加）
- 当前调用云函数的微信号会自动成为超级管理员
- 角色权限：`super_admin`
- 权限范围：全局（`scopeType: 'global'`）

#### 3. 测试门店（2 个）
- **门店 1**：多尼斯宠物店（体育路店）
  - 地址：山西省太原市小店区体育路88号
  - storeId：`store_001`

- **门店 2**：多尼斯宠物店（迎泽大街店）
  - 地址：山西省太原市迎泽区迎泽大街128号
  - storeId：`store_002`

---

## 六、数据库索引优化（可选但推荐）

### 需要创建的索引

在云开发控制台 → 数据库 → 对应集合 → 索引管理：

#### portal_users 集合
```json
{
  "keys": [{ "openId": 1 }],
  "options": { "unique": true }
}
```

#### portal_roles 集合
```json
{
  "keys": [
    { "openId": 1 },
    { "roleKey": 1 }
  ],
  "options": { "unique": false }
}
```

#### stores 集合
```json
{
  "keys": [{ "storeId": 1 }],
  "options": { "unique": true }
}
```

#### contracts 集合
```json
{
  "keys": [{ "contractId": 1 }],
  "options": { "unique": true }
}
```

```json
{
  "keys": [{ "openId": 1 }],
  "options": { "unique": false }
}
```

#### coupons 集合
```json
{
  "keys": [{ "couponId": 1 }],
  "options": { "unique": true }
}
```

---

## 七、常见问题

### Q1：云函数调用失败，提示「环境未初始化」？
**解决：** 确保 `utils/cloud-env.js` 中已配置正确的云环境 ID

### Q2：集合已存在，还需要初始化吗？
**答：** 不需要，云函数会自动跳过已存在的集合，只添加缺失的数据

### Q3：如何添加更多门店？
**方法一：** 修改 `initDatabase/index.js` 中的 `INIT_DATA.stores` 数组，重新上传云函数

**方法二：** 在云开发控制台 → 数据库 → `stores` 集合 → 手动添加记录

### Q4：如何给其他微信号添加管理员权限？
**方法：** 在 `portal_roles` 集合中添加记录：
```json
{
  "openId": "对方的 openId",
  "roleKey": "admin",
  "status": 1,
  "scopeType": "global",
  "scopeId": "",
  "createdAt": "2026-04-10T08:00:00.000Z",
  "updatedAt": "2026-04-10T08:00:00.000Z"
}
```

### Q5：如何获取某个微信号的 openId？
**方法：**
1. 让对方打开小程序
2. 小程序调用 `wx.cloud.callFunction({ name: 'login' })`
3. 在云开发控制台 → 云函数 → `login` → 日志中查看返回的 openId

---

## 八、下一步操作

初始化完成后，你需要：

1. ✅ **测试登录流程**
   - 打开小程序
   - 点击首页进入
   - 查看是否能正常识别管理员身份

2. ✅ **测试管理后台**
   - 管理后台应该能正常进入
   - 检查门店列表是否显示测试门店

3. ✅ **添加真实门店数据**
   - 在管理后台添加真实门店信息
   - 或直接在数据库中批量导入

4. ✅ **配置其他管理员**
   - 在 `portal_roles` 中添加其他管理员的 openId

---

## 九、联系与支持

如有问题，请检查：
1. 云函数日志（云开发控制台 → 云函数 → 日志）
2. 数据库权限设置
3. 云环境 ID 配置

祝部署顺利！🎉