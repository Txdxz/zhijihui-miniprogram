/**
 * 骨架屏组件
 * 提升页面加载体验，避免白屏
 */

Component({
  properties: {
    // 是否显示
    loading: {
      type: Boolean,
      value: true
    },
    // 骨架屏类型：card / list / text
    type: {
      type: String,
      value: 'list'
    },
    // 列表项数量
    itemCount: {
      type: Number,
      value: 3
    },
    // 是否显示动画
    animate: {
      type: Boolean,
      value: true
    }
  },

  data: {
    // 根据 type 生成占位项
    items: []
  },

  observers: {
    'itemCount': function(count) {
      this.setData({
        items: new Array(count).fill({})
      });
    }
  },

  attached() {
    this.setData({
      items: new Array(this.properties.itemCount).fill({})
    });
  }
});
