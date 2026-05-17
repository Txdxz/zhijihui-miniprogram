# 智机惠小程序第三阶段体验优化计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成产品评价报告中第三阶段的体验优化工作，提升用户体验一致性。

**Architecture:** 按照报告中的建议，分5个主要任务进行体验优化，每个任务都是独立可验证的。

**Tech Stack:** 微信小程序 + 微信云开发

---

## 第三阶段任务清单

### Task 1: 查找并了解门店选择方式

**Files:**
- Check: `pages/index/index.js` 和 `pages/index/index.wxml`

**背景：** 首页同时存在 wx.showActionSheet 和 Vant Picker 两种门店选择方式，体验不统一。

**目标：** 了解当前门店选择方式的实现。

---

### Task 2: 修复步骤标签 bug

**Files:**
- Check: `pages/index/index.wxml`

**背景：** 首页合约流程第 3 步的 badge 显示为 "Step 2"，与实际步骤不一致。

**目标：** 修复步骤标签显示错误。

---

### Task 3: 检查绑定页输入框

**Files:**
- Check: `pages/bind/index.js` 和 `pages/bind/index.wxml`

**背景：** 角色绑定页使用原生 <input> 组件，而其他页面均使用 Vant Field，视觉和交互不一致。

**目标：** 检查并统一为 Vant Field。

---

### Task 4: 检查 skeleton 组件使用情况

**Files:**
- Check: 所有列表页面

**背景：** 部分页面在数据加载时缺少加载指示器或骨架屏，用户可能看到空白页面。虽然已有 skeleton 组件，但并未在所有列表页面使用。

**目标：** 检查并确保重要页面使用骨架屏。

---

### Task 5: 检查并优化配置文件

**Files:**
- Check: `sitemap.json`
- Check: `project.config.json`

**背景：** sitemap 未限制管理页，管理后台可被搜索索引；packOptions 未配置，可能包含非必要文件。

**目标：** 优化 sitemap.json 和 packOptions 配置。

---

## 验证清单

完成以上任务后，请验证：

- [ ] 步骤标签 bug 已修复
- [ ] 绑定页输入框与其他页面一致
- [ ] 重要页面有加载状态
- [ ] sitemap.json 和 packOptions 配置已优化
