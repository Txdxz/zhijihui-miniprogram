# 智机惠小程序 - 世纪恒通API对接说明

> 文档版本：v1.0
> 创建时间：2026-06-24
> 文档目的：说明智机惠与世纪恒通荟采平台的API对接方案

---

## 目录

- [1. 对接概述](#1-对接概述)
- [2. 接口清单](#2-接口清单)
- [3. 鉴权与加密](#3-鉴权与加密)
- [4. 接口详情](#4-接口详情)
- [5. 配置项清单](#5-配置项清单)
- [6. 对接联调步骤](#6-对接联调步骤)
- [7. 注意事项](#7-注意事项)

---

## 1. 对接概述

### 1.1 角色定义

| 角色 | 主体 | 说明 |
|------|------|------|
| 服务提供方 | 智机惠 | 提供权益充值、代金券生成与核销能力，对外暴露 API |
| 接入方 | 世纪恒通 | 调用智机惠 API 完成权益订单的创建、查询与回调接收 |

### 1.2 业务背景

- 世纪恒通是中国移动的第三方对接平台（荟采平台）。
- 用户在中国移动「移动权益优选」小程序领取权益后，由世纪恒通荟采平台调用智机惠 API。
- 智机惠收到请求后生成代金券，并将券信息（卡号、卡密、有效期等）回传给世纪恒通。

### 1.3 业务流程

```
移动权益优选小程序          世纪恒通荟采平台              智机惠
       │                        │                        │
       │  1. 用户领取权益         │                        │
       │  ─────────────────────→│                        │
       │                        │  2. 调用 /order/create  │
       │                        │  ─────────────────────→│
       │                        │                        │  生成代金券
       │                        │  3. 返回订单+券信息      │
       │                        │  ←─────────────────────│
       │                        │                        │
       │                        │  4. 异步回调 notifyUrl  │
       │                        │  ←─────────────────────│  核销状态回传
       │                        │  5. 返回回调结果        │
       │                        │  ─────────────────────→│
       │                        │                        │
       │                        │  6. 查询 /order/query   │
       │                        │  ─────────────────────→│
       │                        │  7. 返回订单详情        │
       │                        │  ←─────────────────────│
```

---

## 2. 接口清单

| 接口 | 方向 | 路径 | 说明 |
|------|------|------|------|
| 创建权益充值订单 | 世纪恒通 → 智机惠 | `/order/create` | 世纪恒通下单，智机惠生成代金券并同步返回券信息 |
| 订单详情查询 | 世纪恒通 → 智机惠 | `/order/query` | 世纪恒通主动查询订单状态及券信息 |
| 订单状态回调 | 智机惠 → 世纪恒通 | `notifyUrl`（由世纪恒通提供） | 智机惠在核销等状态变更后，POST 回调世纪恒通 |

> 所有接口均通过智机惠 `mobileIntegration` 云函数的 HTTP 触发器对外暴露，基础 URL 形如：
> `https://{云环境ID}.service.tcloudbasegateway.com/mobileIntegration`

---

## 3. 鉴权与加密

### 3.1 鉴权方式

- **鉴权要素**：`appId` + `appSecret` + MD5 签名（32 位小写）
- `appId`、`appSecret` 由智机惠分配给世纪恒通，双方妥善保管，严禁泄露。
- `appSecret` 仅参与签名计算，**不随请求传输**。

### 3.2 加密方式

- **算法**：3DES
- **模式**：ECB
- **填充**：PKCS5Padding
- **输出**：hex 字符串（小写）
- **密钥**：24 位 3DES 密钥（`desKey`），由世纪恒通提供

### 3.3 签名算法

1. 收集参与签名的参数：
   - 系统参数：`appId`、`traceId`、`timestamp`、`nonceStr`
   - 业务参数：请求体解密后的业务字段（值为空字符串或 null 的参数**不参与签名**）
2. 将所有参与签名的参数按 **key 字典序（ASCII A-Z）** 排序。
3. 按 `key1=value1&key2=value2&...` 拼接（不含 `appSecret`）。
4. 在拼接串末尾追加 `appSecret`。
5. 对完整字符串做 MD5，输出 **32 位小写** 十六进制字符串，即为 `sign`。

签名串示意：

```
appId={appId}&nonceStr={nonceStr}&timestamp={timestamp}&traceId={traceId}&{业务参数字典排序}{appSecret}
```

### 3.4 系统参数（Header）

每次请求需在 HTTP Header 中携带以下系统参数：

| Header 字段 | 说明 | 示例 |
|-------------|------|------|
| `appId` | 智机惠分配的应用 ID | `zjh_appid_001` |
| `traceId` | 请求追踪 ID，32 位 | `a1b2c3...`（32 位） |
| `timestamp` | 时间戳，13 位毫秒 | `1719216000000` |
| `nonceStr` | 随机字符串，10 位 | `Ab3Xy9Kp1z` |
| `sign` | 签名值，32 位小写 MD5 | `e10adc3949ba59abbe56e057f20f883e` |

### 3.5 请求体加密

请求 Body 统一为 JSON，且业务参数经 3DES 加密后封装为：

```json
{
  "ciphertext": "加密后的hex字符串"
}
```

> 接收方需用 `desKey` 对 `ciphertext` 解密后得到业务参数 JSON。
> 响应 Body 同样采用上述加密结构返回。

---

## 4. 接口详情

### 4.1 创建权益充值订单 /order/create

世纪恒通调用此接口创建权益充值订单，智机惠同步生成代金券并返回券信息。

#### 请求参数（解密后业务参数）

| 参数 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `orderNo` | 是 | string | 世纪恒通订单号（用于幂等查重） |
| `rechargeAccount` | 是 | string | 充值账号（手机号） |
| `skuId` | 是 | string | 商品 SKU ID |
| `notifyUrl` | 是 | string | 订单状态回调地址（由世纪恒通提供） |
| `expandData` | 否 | string | 扩展数据，最大 200 字符 |
| `number` | 是 | number | 充值数量，默认 1 |

#### 响应参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `code` | number | 响应码，200 表示成功 |
| `msg` | string | 响应信息 |
| `data` | object | 业务数据 |
| `data.orderNo` | string | 世纪恒通订单号 |
| `data.spOrderNo` | string | 智机惠平台订单号 |
| `data.rechargeStatus` | number | 充值状态：`0`=充值中，`1`=成功，`2`=失败 |
| `data.cards` | array | 卡券列表 |
| `data.cards[].cardNo` | string | 卡号 |
| `data.cards[].cardPassword` | string | 卡密 |
| `data.cards[].cardDeadline` | string | 卡有效期，格式 `yyyy-MM-dd HH:mm:ss` |

#### 幂等说明

- 按 `orderNo` 查重：相同 `orderNo` 重复请求不会重复生成代金券，直接返回已有订单结果。

#### 时间格式

- 所有时间字段统一使用 `yyyy-MM-dd HH:mm:ss`。

#### 请求示例

```http
POST /mobileIntegration/order/create HTTP/1.1
Host: {云环境ID}.service.tcloudbasegateway.com
appId: zjh_appid_001
traceId: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6
timestamp: 1719216000000
nonceStr: Ab3Xy9Kp1z
sign: e10adc3949ba59abbe56e057f20f883e
Content-Type: application/json

{
  "ciphertext": "加密后的hex字符串"
}
```

解密后业务参数示例：

```json
{
  "orderNo": "HT202606240001",
  "rechargeAccount": "13800138000",
  "skuId": "zjh_sku_001",
  "notifyUrl": "https://api.hengtong.com/notify",
  "expandData": "",
  "number": 1
}
```

响应示例（解密后）：

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "orderNo": "HT202606240001",
    "spOrderNo": "ZJH20260624000001",
    "rechargeStatus": 1,
    "cards": [
      {
        "cardNo": "ZJH20260624000001",
        "cardPassword": "AB12CD34EF56",
        "cardDeadline": "2026-07-24 00:00:00"
      }
    ]
  }
}
```

> ⚠️ `/order/create` 响应**不含** `verifyStatus` 和 `verifyTime` 字段，核销状态需通过回调或查询接口获取。

---

### 4.2 订单状态回调（notifyUrl）

由世纪恒通在 `/order/create` 时提供 `notifyUrl`，智机惠在订单状态变更（如核销完成）后主动 POST 回调。

#### 请求说明

- **方向**：智机惠 → 世纪恒通
- **方法**：POST
- **请求 Body**：3DES 加密后的 `ciphertext` 结构
- **请求 Header**：`appId`、`traceId`、`timestamp`、`nonceStr`、`sign`（签名算法同 3.3）

#### 请求参数（解密后业务参数）

| 参数 | 类型 | 说明 |
|------|------|------|
| `orderNo` | string | 世纪恒通订单号 |
| `spOrderNo` | string | 智机惠平台订单号 |
| `rechargeAccount` | string | 充值账号（手机号） |
| `rechargeStatus` | number | 充值状态：`0`=充值中，`1`=成功，`2`=失败 |
| `orderCreateTime` | string | 订单创建时间，`yyyy-MM-dd HH:mm:ss` |
| `rechargeCompleteTime` | string | 充值完成时间，`yyyy-MM-dd HH:mm:ss` |
| `rechargeFailMessage` | string | 充值失败原因（成功时为空） |
| `expandData` | string | 扩展数据（透传下单时的 `expandData`） |
| `cards` | array | 卡券列表 |
| `cards[].cardNo` | string | 卡号 |
| `cards[].cardPassword` | string | 卡密 |
| `cards[].cardDeadline` | string | 卡有效期，`yyyy-MM-dd HH:mm:ss` |
| `cards[].verifyStatus` | number | 核销状态：`0`=待核销，`1`=已核销 |
| `cards[].verifyTime` | string | 核销时间，`yyyy-MM-dd HH:mm:ss`（未核销时为空） |

#### 响应要求

| 参数 | 类型 | 说明 |
|------|------|------|
| `code` | number | `200` 表示成功；非 `200` 世纪恒通会重试 |

> ⚠️ 回调需保证**幂等**：智机惠可能因超时未收到响应而重试，世纪恒通需对同一 `orderNo` 的重复回调做幂等处理。

#### 回调请求示例

```http
POST {notifyUrl} HTTP/1.1
Host: api.hengtong.com
appId: zjh_appid_001
traceId: b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7
timestamp: 1719216060000
nonceStr: Kp1zAb3Xy9
sign: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6
Content-Type: application/json

{
  "ciphertext": "加密后的hex字符串"
}
```

解密后业务参数示例：

```json
{
  "orderNo": "HT202606240001",
  "spOrderNo": "ZJH20260624000001",
  "rechargeAccount": "13800138000",
  "rechargeStatus": 1,
  "orderCreateTime": "2026-06-24 10:00:00",
  "rechargeCompleteTime": "2026-06-24 10:00:05",
  "rechargeFailMessage": "",
  "expandData": "",
  "cards": [
    {
      "cardNo": "ZJH20260624000001",
      "cardPassword": "AB12CD34EF56",
      "cardDeadline": "2026-07-24 00:00:00",
      "verifyStatus": 1,
      "verifyTime": "2026-06-25 14:30:00"
    }
  ]
}
```

响应示例：

```json
{
  "code": 200,
  "msg": "success"
}
```

---

### 4.3 订单详情查询 /order/query

世纪恒通主动查询订单状态及券信息，响应结构与回调接口的 body 结构一致。

#### 请求参数（解密后业务参数）

| 参数 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `spOrderNo` | 是 | string | 智机惠平台订单号 |
| `orderNo` | 是 | string | 世纪恒通订单号 |

#### 响应参数

响应结构与 [4.2 订单状态回调](#42-订单状态回调notifyurl) 的业务参数结构一致，包含 `orderNo`、`spOrderNo`、`rechargeAccount`、`rechargeStatus`、`orderCreateTime`、`rechargeCompleteTime`、`rechargeFailMessage`、`expandData`、`cards`（含 `verifyStatus`、`verifyTime`）等字段。

#### 请求示例

```http
POST /mobileIntegration/order/query HTTP/1.1
Host: {云环境ID}.service.tcloudbasegateway.com
appId: zjh_appid_001
traceId: c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8
timestamp: 1719216120000
nonceStr: Xy9Kp1zAb3
sign: b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7
Content-Type: application/json

{
  "ciphertext": "加密后的hex字符串"
}
```

解密后业务参数示例：

```json
{
  "orderNo": "HT202606240001",
  "spOrderNo": "ZJH20260624000001"
}
```

响应示例（解密后）：

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "orderNo": "HT202606240001",
    "spOrderNo": "ZJH20260624000001",
    "rechargeAccount": "13800138000",
    "rechargeStatus": 1,
    "orderCreateTime": "2026-06-24 10:00:00",
    "rechargeCompleteTime": "2026-06-24 10:00:05",
    "rechargeFailMessage": "",
    "expandData": "",
    "cards": [
      {
        "cardNo": "ZJH20260624000001",
        "cardPassword": "AB12CD34EF56",
        "cardDeadline": "2026-07-24 00:00:00",
        "verifyStatus": 1,
        "verifyTime": "2026-06-25 14:30:00"
      }
    ]
  }
}
```

---

## 5. 配置项清单

| 配置项 | 提供方 | 当前值 | 说明 |
|--------|--------|--------|------|
| `appId` | 智机惠 | `zjh_appid_001`（占位） | 智机惠分配给世纪恒通的应用 ID |
| `appSecret` | 智机惠 | `zjh_secret_2026`（占位） | 智机惠分配给世纪恒通的应用密钥 |
| `desKey` | 世纪恒通 | 待提供 | 24 位 3DES 密钥，用于请求体加解密 |
| 接口域名 | 智机惠 | 需配置 HTTP 触发器 | 形如 `https://{云环境ID}.service.tcloudbasegateway.com/mobileIntegration` |

> 以上配置项需写入 `cloudfunctions/mobileIntegration/config.js`，配置方法详见 `docs/handover/05-运维部署手册.md` 的 2.2.1 节。

---

## 6. 对接联调步骤

1. **双方交换 appId / appSecret / desKey**
   - 智机惠提供 `appId`、`appSecret`（占位值待替换为正式值）
   - 世纪恒通提供 `desKey`（24 位 3DES 密钥）

2. **智机惠配置 HTTP 触发器**
   - 在微信云开发控制台为 `mobileIntegration` 云函数创建 HTTP 触发器
   - 将完整接口地址提供给世纪恒通

3. **世纪恒通调用 /order/create 创建测试订单**
   - 使用测试手机号、测试 SKU 下单
   - 验证签名、加解密链路是否通畅

4. **验证券生成、回调、查询**
   - 确认 `/order/create` 返回的 `cards` 信息正确
   - 触发核销后验证回调 `notifyUrl` 是否正常送达
   - 调用 `/order/query` 验证订单详情一致性

5. **签名验证、加解密验证**
   - 双方互验签名算法（字典排序、MD5 32 位小写）
   - 互验 3DES-ECB/PKCS5Padding 加解密结果

6. **幂等测试**
   - 相同 `orderNo` 重复调用 `/order/create`，确认不重复生成券
   - 重复回调 `notifyUrl`，确认世纪恒通侧幂等处理正确

---

## 7. 注意事项

1. **时间格式统一**：所有时间字段统一使用 `yyyy-MM-dd HH:mm:ss`，时区为东八区（UTC+8）。

2. **响应字段统一**：响应信息字段统一使用 `msg`（不使用 `message`）。

3. **/order/create 响应不含核销字段**：`/order/create` 的响应中 `cards` 仅包含 `cardNo`、`cardPassword`、`cardDeadline`，**不含** `verifyStatus` 和 `verifyTime`。核销状态需通过回调或 `/order/query` 获取。

4. **回调需保证幂等**：智机惠在未收到世纪恒通成功响应（`code: 200`）时会重试回调，世纪恒通必须对同一 `orderNo` 的重复回调做幂等处理。

5. **智机惠回传重试机制**：智机惠侧 `notifyHengtongSettle` 采用**同步重试 + 定时补推**双重保障：
   - **同步重试**：核销/结算时立即回传，失败后自动重试 3 次，间隔 1秒/3秒/5秒（总耗时约 9 秒，在云函数 20 秒超时限制内）。
   - **定时补推**：`notifyRetry` 云函数每 30 分钟扫描已结算但 `mobileNotifiedAt` 为空的券，重新回传（每批最多 50 条，单券重试 2 次，间隔 2秒/4秒）。
   - **成功标记**：回传成功后写入 `mobileNotifiedAt` 字段，补推任务据此跳过已成功的券。
   - **人工介入**：若同步重试和定时补推均失败（如世纪恒通接口长期不可用），需通过云函数日志排查并人工处理。

6. **签名时业务参数值为空的不参与签名**：业务参数值为空字符串 `""` 或 `null` 的字段**不参与签名**计算。

7. **业务参数需字典排序**：签名时业务参数须按 key 的 ASCII 序（A-Z）字典排序后拼接。

8. **密钥安全**：`appSecret` 和 `desKey` 严禁明文传输或记录到日志，双方应通过安全渠道交换并妥善保管。

---

> 📌 **文档维护说明**
> 本文档随对接进度持续更新。联调过程中如发现实际接口行为与文档不一致，请以双方确认的最终协议为准并同步更新本文档。
