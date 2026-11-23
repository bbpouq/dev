import { Thumb } from './Thumb';
import { confirmDialog } from './dialog';
import { go, toast, useRepo } from './store';
import { formatDate } from '../util/date';

export function Trash() {
  const repo = useRepo();
  const items = repo.state.photos.filter((p) => p.trashedAt).sort((a, b) => b.trashedAt! - a.trashedAt!);
  return (
    <div class="page">
      <header class="page-head">
        <button class="btn ghost" onClick={() => go('album')}>‹ 相册</button>
        <h1>回收站</h1>
        {items.length > 0 ? <button class="btn small danger-text" onClick={async () => {
          if (await confirmDialog(`永久删除回收站中的 ${items.length} 张照片？`, { detail: '原件、母版和人物标记都会被删除，无法恢复。', ok: '永久删除', danger: true })) {
            for (const p of items) await repo.purgePhoto(p);
            toast('已清空回收站');
          }
        }}>清空</button> : <span />}
      </header>
      {!items.length && <p class="muted empty">回收站是空的。</p>}
      <ul class="list">
        {items.map((p) => (
          <li class="trash-item">
            <Thumb repo={repo} assetId={p.thumbAssetId} alt={p.title || '照片'} />
            <div class="grow">
              <div>{p.title || formatDate(p.date)}</div>
              <small class="muted">删除于 {new Date(p.trashedAt!).toLocaleString('zh-CN')}</small>
            </div>
            <button class="btn small" onClick={() => repo.restorePhoto(p)}>恢复</button>
            <button class="btn small danger-text" onClick={async () => {
              if (await confirmDialog('永久删除这张照片？', { detail: '无法恢复。', ok: '永久删除', danger: true })) await repo.purgePhoto(p);
            }}>永久删除</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
