/**
 * 性能优化工具集
 */

/**
 * 防抖函数
 * @param {Function} fn 需要防抖的函数
 * @param {Number} delay 延迟时间（毫秒）
 */
export function debounce(fn, delay = 300) {
  let timer = null;
  return function(...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn.apply(this, args);
    }, delay);
  };
}

/**
 * 节流函数
 * @param {Function} fn 需要节流的函数
 * @param {Number} delay 间隔时间（毫秒）
 */
export function throttle(fn, delay = 300) {
  let lastTime = 0;
  return function(...args) {
    const now = Date.now();
    if (now - lastTime >= delay) {
      fn.apply(this, args);
      lastTime = now;
    }
  };
}

/**
 * setData 优化器
 * 合并多次 setData 调用，减少性能开销
 */
export class SetDataOptimizer {
  constructor(page) {
    this.page = page;
    this.pendingData = {};
    this.timer = null;
  }

  /**
   * 添加数据到待更新队列
   * @param {Object} data 需要更新的数据
   */
  add(data) {
    Object.assign(this.pendingData, data);
    
    // 清除之前的定时器
    if (this.timer) clearTimeout(this.timer);
    
    // 延迟执行合并更新
    this.timer = setTimeout(() => {
      this.flush();
    }, 16); // 一帧时间
  }

  /**
   * 立即执行更新
   */
  flush() {
    if (Object.keys(this.pendingData).length > 0) {
      this.page.setData(this.pendingData);
      this.pendingData = {};
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * 销毁
   */
  destroy() {
    this.flush();
    this.page = null;
  }
}

/**
 * 数据差异对比器
 * 对比新旧数据，只返回变化的部分
 */
export function diffData(oldData, newData) {
  const diff = {};
  
  for (const key in newData) {
    if (oldData[key] !== newData[key]) {
      // 简单对比，对于对象和数组需要深度对比
      if (typeof newData[key] === 'object' && newData[key] !== null) {
        if (JSON.stringify(oldData[key]) !== JSON.stringify(newData[key])) {
          diff[key] = newData[key];
        }
      } else {
        diff[key] = newData[key];
      }
    }
  }
  
  return diff;
}

/**
 * 列表数据路径更新
 * 避免更新整个列表，只更新特定项
 * @param {String} listPath 列表在 data 中的路径
 * @param {Number} index 列表项索引
 * @param {Object} itemData 新数据
 * @returns {Object} setData 参数
 */
export function updateListItem(listPath, index, itemData) {
  const result = {};
  for (const key in itemData) {
    result[`${listPath}[${index}].${key}`] = itemData[key];
  }
  return result;
}
