// utils/region.js - 省市区数据工具类

/**
 * 获取省份列表（从门店数据中提取）
 * @param {Array} stores 门店列表
 * @returns {Array} 省份列表，包含'全部'
 */
function getProvinces(stores) {
  if (!stores || stores.length === 0) return ['全部'];
  
  const provinceSet = new Set();
  stores.forEach(store => {
    if (store.province) {
      provinceSet.add(store.province);
    }
  });
  
  return ['全部', ...Array.from(provinceSet).sort()];
}

/**
 * 根据省份获取城市列表
 * @param {Array} stores 门店列表
 * @param {string} province 省份名称
 * @returns {Array} 城市列表，包含'全部'
 */
function getCities(stores, province) {
  if (!stores || stores.length === 0 || !province || province === '全部') return ['全部'];
  
  const citySet = new Set();
  stores.forEach(store => {
    if (store.province === province && store.city) {
      citySet.add(store.city);
    }
  });
  
  return ['全部', ...Array.from(citySet).sort()];
}

/**
 * 根据省份和城市获取区县列表
 * @param {Array} stores 门店列表
 * @param {string} province 省份名称
 * @param {string} city 城市名称
 * @returns {Array} 区县列表，包含'全部'
 */
function getDistricts(stores, province, city) {
  if (!stores || stores.length === 0 || !province || province === '全部' || !city || city === '全部') return ['全部'];
  
  const districtSet = new Set();
  stores.forEach(store => {
    if (store.province === province && store.city === city && store.district) {
      districtSet.add(store.district);
    }
  });
  
  return ['全部', ...Array.from(districtSet).sort()];
}

/**
 * 获取完整的地址显示
 * @param {Object} store 门店对象
 * @returns {string} 完整地址
 */
function getFullAddress(store) {
  if (!store) return '';
  
  const parts = [];
  if (store.province) parts.push(store.province);
  if (store.city) parts.push(store.city);
  if (store.district) parts.push(store.district);
  if (store.address) parts.push(store.address);
  
  return parts.join('');
}

/**
 * 检查门店是否符合筛选条件
 * @param {Object} store 门店对象
 * @param {Object} filter 筛选条件 {province, city, district, keyword}
 * @returns {boolean} 是否通过筛选
 */
function checkStoreFilter(store, filter) {
  if (!store) return false;
  
  // 省份筛选
  if (filter.province && filter.province !== '全部') {
    if (store.province !== filter.province) return false;
  }
  
  // 城市筛选
  if (filter.city && filter.city !== '全部') {
    if (store.city !== filter.city) return false;
  }
  
  // 区县筛选
  if (filter.district && filter.district !== '全部') {
    if (store.district !== filter.district) return false;
  }
  
  // 关键词搜索
  if (filter.keyword && filter.keyword.trim()) {
    const keyword = filter.keyword.trim().toLowerCase();
    const searchFields = [
      store.name,
      store.owner,
      store.phone,
      getFullAddress(store)
    ];
    
    const match = searchFields.some(field => 
      field && field.toString().toLowerCase().includes(keyword)
    );
    
    if (!match) return false;
  }
  
  return true;
}

/**
 * 获取门店统计信息
 * @param {Array} stores 门店列表
 * @returns {Object} 统计信息
 */
function getStoreStats(stores) {
  const stats = {
    total: 0,
    byProvince: {},
    byCity: {},
    byDistrict: {}
  };
  
  if (!stores || stores.length === 0) return stats;
  
  stats.total = stores.length;
  
  stores.forEach(store => {
    // 按省份统计
    if (store.province) {
      stats.byProvince[store.province] = (stats.byProvince[store.province] || 0) + 1;
    }
    
    // 按城市统计
    if (store.province && store.city) {
      const key = `${store.province}-${store.city}`;
      stats.byCity[key] = (stats.byCity[key] || 0) + 1;
    }
    
    // 按区县统计
    if (store.province && store.city && store.district) {
      const key = `${store.province}-${store.city}-${store.district}`;
      stats.byDistrict[key] = (stats.byDistrict[key] || 0) + 1;
    }
  });
  
  return stats;
}

module.exports = {
  getProvinces,
  getCities,
  getDistricts,
  getFullAddress,
  checkStoreFilter,
  getStoreStats
};