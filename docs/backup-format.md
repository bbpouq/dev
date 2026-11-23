# 家影备份格式（schemaVersion 1）

一次备份 = 1 个或多个 ZIP 分卷（`jiaying-backup-YYYYMMDD-HHmm-<k>of<n>.zip`），全部条目使用 **store（不压缩）**，UTF-8 文件名，无 ZIP64（单卷 < 4 GB，界面可选 100 MB–1 GB 分卷上限，默认 200 MB）。

每个分卷包含：

| 路径 | 内容 |
| --- | --- |
| `volume.json` | `{ format: "jiaying-archive", exportId, volume, volumeCount }` |
| `manifest.json` | 完整清单（每卷相同，任意一卷即可识别整套备份与缺失分卷） |
| `assets/<assetId>.<ext>` | 本卷承载的原始文件与扫描母版 |

`manifest.json` 字段：

- `format`、`schemaVersion`、`archiveId`、`exportId`、`exportedAt`、`app`、`volumeCount`、`meId`
- `persons[]`、`relationships[]`（`parent_of` 有向；`partner_of` ID 对排序后规范化，`id = type:a:b`）
- `photos[]`：编辑参数（四角、旋转、色调）、模板参数、原始日期与精度、标题/地点/备注、整理状态、时间戳；`thumbAssetId` 为空（恢复端重建）
- `photoPersons[]`
- `assets[]`：`{ id, purpose: original|master, type, size, sha256, path, volume }`
- `totals`：照片数、人物数、关系数、资源总字节数

不包含：扫描队列中未保存的草稿、回收站中的照片（导出前界面会提示数量）、缩略图。备份**未加密**。

恢复时的检查：格式与版本；ID/路径唯一且安全（`assets/` 下的白名单文件名，拒绝 `..`）；引用完整（照片→原件/母版、标记→照片/人物、`meId`）；关系无自关联、无重复、无祖先环；每卷只含清单中属于该卷的条目且大小一致；读取单个条目前按清单大小设上限（防 ZIP 炸弹），逐个校验 CRC32 与 SHA-256；按 `navigator.storage.estimate()` 估算空间。大库逐文件读取（`Blob.slice`），不会把整卷解包进内存。
