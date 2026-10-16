# 供应商品牌图标

`provider-marks.json` 包含 14 个按需收录的本地 SVG，来源为 [Lobe Icons](https://github.com/lobehub/lobe-icons) 的 `@lobehub/icons-static-svg` **1.95.1**。保留本目录的 MIT [LICENSE](LICENSE)。品牌名称和标志归其各自所有者。

仅移除 SVG 的标题和网页布局样式，路径与配色保持原样。应用通过现有的 react-native-svg 渲染；运行时不访问 CDN 或供应商网站。

无法识别的供应商使用 `provider-icon.tsx` 中绘制的节点图标。用户上传的 PNG、JPEG、WebP 图标保存在连接配置中，不覆盖这里的品牌资源。
