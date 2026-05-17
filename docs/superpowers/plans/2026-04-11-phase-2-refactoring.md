# 智机惠小程序第二阶段重构计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成产品评价报告中第二阶段的代码重构工作，提升代码可维护性。

**Architecture:** 按照报告中的建议，分6个主要任务进行代码重构，每个任务都是独立可验证的。

**Tech Stack:** 微信小程序 + 微信云开发

---

## 先完成第一阶段遗留任务

### Task 0: 更新剩余云函数的 package.json

**Files:**
- Modify: `cloudfunctions/manageAdmin/package.json`
- Modify: `cloudfunctions/login/package.json`
- Modify: `cloudfunctions/bindRoleByPhone/package.json`
- Modify: `cloudfunctions/resolveLaunchContext/package.json`

**背景：** 还有 4 个云函数的 wx-server-sdk 版本未统一。

**目标：** 统一所有云函数使用 ^3.0.1 版本。

---

## 第二阶段任务清单

### Task 1: 清理死代码和冗余代码

**Files:**
- Check: 项目中各文件
- Modify: 包含死代码的文件

**背景：** 项目中存在多处未使用的函数和变量。

**目标：** 清理死代码，减少包体积。

- [ ] 查找并清理未使用的代码

---

### Task 2: 统一手机号正则表达式

**Files:**
- Check: 所有使用手机号验证的文件
- Modify: 验证规则不一致的文件

**背景：** 项目中手机号正则表达式不统一。

**目标：** 全部使用 /^1[3-9]\d{9}$/。

---

### Task 3: 为列表查询添加分页支持（如果需要）

**Files:**
- Check: portalBiz/index.js 中的列表查询
- Modify: 需要分页的查询函数

**背景：** 列表查询无分页，超过 20 条数据会丢失。

**目标：** 为列表查询添加分页支持。

---

### Task 4: 检查并补充云函数的错误处理

**Files:**
- Check: 所有云函数
- Modify: 缺少错误处理的云函数

**背景：** 需要为所有云函数添加全局 try-catch 错误处理。

**目标：** 确保所有云函数都有完善的错误处理。

---

### Task 5: 清理调试日志

**Files:**
- Check: 项目中各文件的 console.log
- Modify: 包含调试日志的文件

**背景：** 还有一些调试日志需要清理。

**目标：** 清理不必要的 console.log。

---

## 验证清单

完成以上任务后，请验证：

- [ ] 所有云函数的 package.json 中 wx-server-sdk 版本统一为 ^3.0.1
- [ ] 死代码已清理
- [ ] 手机号正则表达式统一
- [ ] 云函数错误处理完善
- [ ] 调试日志已清理
