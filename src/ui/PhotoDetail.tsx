import { useEffect, useState } from 'preact/hooks';
import type { Photo, TemplateKind, TemplateParams } from '../types';
import type { Repo } from '../db/repo';
import { formatDate, isTodo, photoYear } from '../util/date';
import { TEMPLATE_NAMES, exportTemplateJpeg, renderTemplate } from '../templates/render';
import { DateField } from './DateField';
import { PeopleChips, PersonPicker } from './people';
import { Sheet, confirmDialog } from './dialog';
import { useAssetUrl } from './Thumb';
import { go, toast, useRepo } from './store';
import { fmtBytes } from '../backup/restore';
import { saveFile } from './save';

export function PhotoDetail({ id }: { id: string }) {
  const repo = useRepo();
  const photo = repo.state.photos.find((p) => p.id === id);
  const url = useAssetUrl(repo, photo?.masterAssetId);
  const [picker, setPicker] = useState(false);
  const [tpl, setTpl] = useState(false);
  if (!photo) return <div class="page"><p>照片不存在或已永久删除。</p><button class="btn" onClick={() => go('album')}>返回相册</button></div>;
  const people = repo.peopleOf(photo.id);
  const todo = isTodo(photo, people.length);
  const update = (patch: Partial<Photo>) => repo.updatePhoto({ ...photo, ...patch }).catch((e) => toast(e.message, 'error'));

  return (
    <div class="page detail">
      <header class="page-head">
        <button class="btn ghost" onClick={() => (history.length > 1 ? history.back() : go('album'))}>‹ 返回</button>
        <h1 class="ellipsis">{photo.title || formatDate(photo.date)}</h1>
        <span />
      </header>
      {photo.trashedAt && <div class="card notice">这张照片在回收站中。<button class="btn small" onClick={() => repo.restorePhoto(photo)}>恢复</button></div>}
      <div class="master">{url && <img src={url} alt={photo.title || '照片'} />}</div>
      <div class="row wrap">
        <button class="btn primary" onClick={() => setTpl(true)}>导出 JPEG</button>
        <button class="btn" onClick={() => go(`photo/${photo.id}/edit`)}>重新编辑</button>
        {!photo.trashedAt && <button class="btn danger-text" onClick={async () => {
          if (await confirmDialog('把这张照片移到回收站？', { detail: '可以在回收站恢复。', ok: '移到回收站', danger: true })) {
            await repo.trashPhoto(photo); toast('已移到回收站'); go('album');
          }
        }}>删除</button>}
      </div>

      <section class="card stack">
        <TextField label="标题" value={photo.title} onCommit={(v) => update({ title: v })} placeholder="例如：小时候的合影" />
        <div class="field"><span>原始日期</span><DateField value={photo.date} onCommit={(d) => update({ date: d })} /></div>
        <div class="field">
          <span>人物</span>
          <PeopleChips repo={repo} ids={people} onOpen={(pid) => go(`person/${pid}`)} onRemove={(pid) => repo.setPhotoPeople(photo.id, people.filter((x) => x !== pid))} />
          <button class="btn small" onClick={() => setPicker(true)}>＋ 添加或新增人物</button>
        </div>
        <TextField label="地点" value={photo.place} onCommit={(v) => update({ place: v })} />
        <TextField label="备注" value={photo.notes} multiline onCommit={(v) => update({ notes: v })} />
        <div class="row between">
          {photo.organized ? <span>已整理（手动标记）</span> : todo ? <span class="tag">待整理</span> : <span>已整理</span>}
          {photo.organized
            ? <button class="btn small" onClick={() => update({ organized: false })}>取消手动标记</button>
            : todo && <button class="btn small" onClick={() => update({ organized: true })}>日期或人物确实未知，标为已整理</button>}
        </div>
      </section>
      <AssetInfo repo={repo} photo={photo} />
      {picker && <PersonPicker repo={repo} selected={people} onChange={(ids) => repo.setPhotoPeople(photo.id, ids)} onClose={() => setPicker(false)} />}
      {tpl && url && <TemplateSheet repo={repo} photo={photo} url={url} onClose={() => setTpl(false)} />}
    </div>
  );
}

function AssetInfo({ repo, photo }: { repo: Repo; photo: Photo }) {
  const [sizes, setSizes] = useState<[number, number]>();
  useEffect(() => {
    Promise.all([repo.getAsset(photo.originalAssetId), repo.getAsset(photo.masterAssetId)]).then(([o, m]) => setSizes([o?.size ?? 0, m?.size ?? 0]));
  }, [photo.masterAssetId]);
  return (
    <details class="card small">
      <summary>文件信息</summary>
      <p>扫描于 {new Date(photo.scannedAt).toLocaleString('zh-CN')}</p>
      <p>原件：{photo.originalName}（{photo.originalType || '未知类型'}{sizes ? `，${fmtBytes(sizes[0])}` : ''}）</p>
      <p>扫描母版：{photo.width} × {photo.height} JPEG{sizes ? `，${fmtBytes(sizes[1])}` : ''}</p>
    </details>
  );
}

function TextField(props: { label: string; value: string; onCommit: (v: string) => void; multiline?: boolean; placeholder?: string }) {
  const [v, setV] = useState(props.value);
  useEffect(() => setV(props.value), [props.value]);
  const commit = () => { if (v !== props.value) props.onCommit(v.trim()); };
  return (
    <label class="field">
      <span>{props.label}</span>
      {props.multiline
        ? <textarea rows={3} value={v} onInput={(e) => setV((e.target as HTMLTextAreaElement).value)} onBlur={commit} />
        : <input value={v} placeholder={props.placeholder} onInput={(e) => setV((e.target as HTMLInputElement).value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />}
    </label>
  );
}

function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
}

function TemplateSheet({ repo, photo, url, onClose }: { repo: Repo; photo: Photo; url: string; onClose: () => void }) {
  const [t, setT] = useState<TemplateParams>({ ...photo.template, title: photo.template.title || photo.title });
  const [img, setImg] = useState<HTMLImageElement>();
  const [preview, setPreview] = useState<string>();
  const [busy, setBusy] = useState(false);
  const names = repo.peopleOf(photo.id).map((id) => repo.state.persons.find((p) => p.id === id)?.displayName).filter(Boolean).join('、');
  const text = { title: t.title.trim(), date: t.showDate && photo.date.precision !== 'unknown' ? formatDate(photo.date) : undefined, people: t.showPeople && names ? names : undefined };

  useEffect(() => { loadImg(url).then(setImg); }, [url]);
  useEffect(() => {
    if (!img) return;
    const s = Math.min(1, 700 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    setPreview(renderTemplate(c, t, text).toDataURL('image/jpeg', 0.85));
  }, [img, t.kind, t.title, t.showDate, t.showPeople]);

  const doExport = async () => {
    if (!img) return;
    setBusy(true);
    try {
      await repo.updatePhoto({ ...photo, template: t });
      const blob = await exportTemplateJpeg(img, t, text);
      // ASCII names survive every browser's download / share path.
      const year = photoYear(photo.date);
      const r = await saveFile(blob, `jiaying-${year ?? 'undated'}-${t.kind}-${photo.id.slice(0, 6)}.jpg`, 'image/jpeg');
      if (r !== 'cancelled') toast(r === 'saved' ? '已导出' : '已生成 JPEG，请确认已存好');
    } catch (e) { toast(`导出失败：${(e as Error).message}`, 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Sheet title="照片模板" onClose={onClose} wide>
      <div class="stack">
        <div class="chips">
          {(Object.keys(TEMPLATE_NAMES) as TemplateKind[]).map((k) => (
            <button class={'chip' + (t.kind === k ? ' on' : '')} aria-pressed={t.kind === k} onClick={() => setT({ ...t, kind: k })}>{TEMPLATE_NAMES[k]}</button>
          ))}
        </div>
        <div class="tpl-preview">{preview && <img src={preview} alt="导出预览" />}</div>
        {t.kind === 'story' && (
          <div class="stack tight">
            <label class="field"><span>标题</span><input value={t.title} placeholder="例如：小时候的合影" onInput={(e) => setT({ ...t, title: (e.target as HTMLInputElement).value })} /></label>
            <label class="check"><input type="checkbox" checked={t.showDate} onChange={(e) => setT({ ...t, showDate: (e.target as HTMLInputElement).checked })} /> 显示原始日期{photo.date.precision === 'unknown' ? '（未填写）' : `（${formatDate(photo.date)}）`}</label>
            <label class="check"><input type="checkbox" checked={t.showPeople} onChange={(e) => setT({ ...t, showPeople: (e.target as HTMLInputElement).checked })} /> 显示人物姓名{names ? `（${names}）` : '（未标人物）'}</label>
          </div>
        )}
        <p class="muted small">模板只用于导出副本，扫描母版保持不变。导出的 JPEG 不含原图的 EXIF 信息。</p>
        <button class="btn primary" disabled={!img || busy} onClick={doExport}>{busy ? '正在生成…' : '导出 JPEG'}</button>
      </div>
    </Sheet>
  );
}
