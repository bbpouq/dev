# 家影 · 家庭照片数字化

手机优先的简体中文离线 PWA：逐张扫描实体照片，按年代和家人找回回忆，整套家庭档案只保存在本机。

实现依据：`Family_Photo_Archive_BRD.html`（BRD v1.0），M1–M3 全部 P0 功能。

## 运行

```bash
npm install
npm run dev        # 开发模式（不注册 Service Worker）
npm run build      # 类型检查 + 生成 dist/（含 sw.js 预缓存清单）
npm run preview    # http://localhost:4173 预览生产构建
npm test           # 单元测试（vitest）
```

端到端验收（需要 Playwright + Chromium、Python + Pillow + numpy）：

```bash
python3 e2e/make_fixtures.py e2e/fixtures      # 生成 20 张测试照片（含损坏文件、HEIC）
npm run build && npm run e2e                    # 扫描→家庭树→模板→备份→离线→恢复
python3 e2e/make_big_backup.py e2e/out/big-500.zip 500 && node e2e/perf.cjs   # 500 张恢复与首屏
```

## 部署与首次加载

`dist/` 是纯静态文件，可部署到任意 **HTTPS** 静态托管（相对路径，可放在子目录）。无后端、无遥测、无 CDN、无外部字体；CSP 限制 `connect-src 'self'`。

1. 用 Safari 通过 HTTPS 打开，等待相册顶部显示「离线可用」（Service Worker 已缓存全部应用资源并自检）。
2. 建议在开始批量扫描前通过分享菜单「添加到主屏幕」，以后都从主屏幕打开（见下方「已知差异」）。
3. 此后可在飞行模式下扫描、编辑、查找、家庭树、模板导出与备份恢复。

## 代码结构

| 目录 | 内容 |
| --- | --- |
| `src/scan/` | 解码与 EXIF 方向（`decode.ts`）、自动找边（`detect.ts`）、透视/旋转/色调单一处理链（`process.ts`）、母版与预览渲染（`render.ts`） |
| `src/db/` | IndexedDB：每个档案一个数据库，`jiaying-meta` 记录当前档案指针（`archive.ts`）；数据访问与事务边界（`repo.ts`） |
| `src/family/` | 人物关系图、亲子无环/伴侣去重/自关联校验（`graph.ts`） |
| `src/backup/` | ZIP 读写（`zip.ts`）、清单格式与校验（`format.ts`）、导出分卷（`export.ts`）、暂存式恢复（`restore.ts`） |
| `src/templates/` | 纯照片 / 白边相纸 / 故事卡 |
| `src/ui/` | Preact 界面：相册、扫描、家庭树、照片详情、备份与恢复、回收站 |
| `src/sw-template.js` | Service Worker 模板，构建时由 `vite.config.ts` 注入预缓存清单与版本号 |

关键设计：

- **保存边界**：导入时原始字节 + 草稿在一个事务内写入；「保存并继续」时母版、缩略图、照片记录、人物标记与删除草稿在同一事务提交。照片 ID 在草稿创建时预分配，重试不会产生重复照片。
- **预览 = 导出**：预览与母版走同一个 `processPixels`（透视拉正 → 90° 旋转 → 黑白/亮度/对比度），四角使用 EXIF 校正后源图的归一化坐标。母版长边 ≤ 4096 px，源裁切更小时保持原尺寸；超过约 16 MP 的源图先按 iOS 画布上限缩放。
- **恢复**：先核验全部分卷，写入新的暂存数据库，逐个校验 SHA-256 与大小并重建缩略图，回读核对计数，最后一次写入切换档案指针；任何失败都删除暂存库，原档案不变。

备份格式见 [`docs/backup-format.md`](docs/backup-format.md)，验收记录与已知差异见 [`docs/acceptance.md`](docs/acceptance.md)。
