// pages/store/map/index.js - 门店地图展示
const { businessAPI } = require('../../../utils/business-api');

Page({
  data: {
    latitude: 37.87,
    longitude: 112.55,
    scale: 13,
    markers: [],
    stores: [],
    selectedStore: null,
    pageLoading: true,
    hasStoresWithLocation: false
  },

  onLoad() {
    this._loadMapData();
  },

  onPullDownRefresh() {
    this._loadMapData().finally(() => wx.stopPullDownRefresh());
  },

  async _loadMapData() {
    this.setData({ pageLoading: true });

    try {
      const app = getApp();

      // 获取用户位置
      let userLocation = null;
      try {
        userLocation = await app.getUserLocation();
      } catch (e) {
        console.warn('获取位置失败:', e);
      }

      // 加载门店列表
      const res = await businessAPI.getStores();
      const stores = (res && res.code === 200 && Array.isArray(res.data)) ? res.data : [];

      // 计算距离并排序
      if (userLocation && stores.length > 0) {
        stores.forEach(store => {
          if (store.location && store.location.lat && store.location.lng) {
            store.distance = app.calcDistance(
              userLocation.latitude, userLocation.longitude,
              store.location.lat, store.location.lng
            );
            store.distanceText = store.distance < 1000
              ? `${Math.round(store.distance)}m`
              : `${(store.distance / 1000).toFixed(1)}km`;
          }
        });
        stores.sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));
      }

      // 构建地图标记
      const storesWithLocation = stores.filter(s => s.location && s.location.lat && s.location.lng);
      const markers = storesWithLocation.map((store, index) => ({
        id: index,
        latitude: store.location.lat,
        longitude: store.location.lng,
        title: store.name || '',
        callout: {
          content: store.name || '',
          display: 'BYCLICK',
          textAlign: 'center',
          padding: 8,
          borderRadius: 4
        },
        width: 32,
        height: 32
      }));

      // 确定地图中心
      let centerLat = 37.87;
      let centerLng = 112.55;
      if (userLocation) {
        centerLat = userLocation.latitude;
        centerLng = userLocation.longitude;
      } else if (storesWithLocation.length > 0) {
        centerLat = storesWithLocation[0].location.lat;
        centerLng = storesWithLocation[0].location.lng;
      }

      this.setData({
        latitude: centerLat,
        longitude: centerLng,
        markers,
        stores,
        hasStoresWithLocation: storesWithLocation.length > 0,
        pageLoading: false
      });
    } catch (e) {
      console.error('加载地图数据失败:', e);
      this.setData({ pageLoading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  onMarkerTap(e) {
    const markerId = e.detail.markerId;
    const store = this.data.stores.filter(s => s.location && s.location.lat)[markerId];
    if (store) {
      this.setData({ selectedStore: store });
    }
  },

  onMapTap() {
    this.setData({ selectedStore: null });
  },

  onNavigateToStore() {
    const store = this.data.selectedStore;
    if (!store || !store.location) return;
    wx.openLocation({
      latitude: store.location.lat,
      longitude: store.location.lng,
      name: store.name || '',
      address: store.address || '',
      scale: 16
    });
  }
});
