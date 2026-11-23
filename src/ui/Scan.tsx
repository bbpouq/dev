import { useEffect, useRef, useState } from 'preact/hooks';
import { makeAsset, type Repo } from '../db/repo';
import type { Draft, EditParams, Photo } from '../types';
import { defaultParams, loadSource, renderMaster, type Source } from '../scan/render';
import { DecodeError } from '../scan/decode';
import { isQuotaError } from '../db/idb';
import { DEFAULT_TEMPLATE } from '../templates/render';
import { Editor } from './Editor';
import { PeopleChips, PersonPicker } from './people';
import { confirmDialog } from './dialog';
import { go, isStandalone, toast, useRepo } from './store';

let persistAsked = false;
export async function askPersist() {
  if (persistAsked) return;
  persistAsked = true;
  try { await navigator.storage?.persist?.(); } catch { /* runtime decides */ }
}

export function Scan() {
  const repo = useRepo();
  const { drafts, settings } = repo.state;
  const pending = drafts.filter((d) => d.stage === 'pending');
  const failed = drafts.filter((d) => d.stage === 'failed');
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);
  const [savedThisSession, setSaved] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const camRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const current = drafts.find((d) => d.id === currentId && d.stage === 'pending') ?? pending[0];

  const addFiles = async (files: FileList | null, source: Draft['source']) => {
    if (!files?.length) return;
    const list = [...files];
    setImporting({ done: 0, total: list.length });
    let first: Draft | undefined;
    try {
      for (let i = 0; i < list.length; i++) {
        const d = await repo.addDraft(list[i], source);
        first ??= d;
        setImporting({ done: i + 1, total: list.length });
      }
    } catch (e) {
      toast(isQuotaError(e) ? '设备存储空间不足，部分照片未加入队列。已保存的照片不受影响，建议先到「备份与恢复」导出备份。' : `加入队列失败：${(e as Error).message}`, 'error');
    } finally {
      setImporting(null);
    }
    if (first && !current) setCurrentId(first.id);
  };

  const showNotice = !isStandalone() && !settings.entryNoticeDismissed;

  return (
    <div class="page scan">
      <header class="page-head">
        <h1>扫描</h1>
        <span class="muted">{pending.length ? `待处理 ${pending.length} 张` : savedThisSession ? `本次已保存 ${savedThisSession} 张` : ''}</span>
      </header>

      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden data-testid="camera-input"
        onChange={(e) => { const t = e.target as HTMLInputElement; addFiles(t.files, 'camera').then(() => (t.value = '')); }} />
      <input ref={fileRef} type="file" accept="image/*" multiple hidden data-testid="file-input"
        onChange={(e) => { const t = e.target as HTMLInputElement; addFiles(t.files, 'import').then(() => (t.value = '')); }} />

      {showNotice && (
        <div class="card notice">
          <strong>开始批量扫描前，先决定使用方式</strong>
          <p>在 iPhone 上，Safari 标签页和「添加到主屏幕」的应用可能各自保存一份档案，互不相通。建议先通过分享菜单「添加到主屏幕」，之后都从主屏幕打开。若已在两处都有照片，可用「备份与恢复」迁移。</p>
          <button class="btn" onClick={() => repo.saveSettings({ entryNoticeDismissed: true })}>知道了</button>
        </div>
      )}

      {importing && <div class="card"><progress max={importing.total} value={importing.done} /> 正在加入队列 {importing.done}/{importing.total}</div>}

      {current ? (
        <DraftEditor key={current.id} repo={repo} draft={current} remaining={pending.length}
          onSaved={() => { setSaved((n) => n + 1); setCurrentId(null); }}
          onRetake={async () => {
            if (current.source === 'camera') { camRef.current?.click(); await repo.removeDraft(current); return; }
            if (await confirmDialog(`从队列移除「${current.fileName}」？`, { ok: '移除', danger: true })) await repo.removeDraft(current);
          }} />
      ) : (
        <div class="card capture">
          <p class="lead">一盒接一盒地扫。每次拍一张实体照片，年份和人物可以以后再补。</p>
          <button class="btn primary big" onClick={() => camRef.current?.click()}>{savedThisSession ? '继续拍照' : '开始扫描 · 拍照'}</button>
          <button class="btn big" onClick={() => fileRef.current?.click()}>从相册或文件选择（可多选）</button>
          <p class="muted small">建议每批约 20 张。退出或关闭应用后，未处理的照片会留在队列里。</p>
        </div>
      )}

      {drafts.length > 0 && (
        <section class="card">
          <h2 data-testid="queue-title">队列 <small class="muted">{pending.length} 待处理{failed.length ? ` · ${failed.length} 失败` : ""}</small></h2>
          <ul class="queue">
            {drafts.filter((d, i) => showAll || d.stage === 'failed' || i < 5 || d.id === current?.id).map((d) => (
              <li class={d.stage} key={d.id}>
                <span class="q-name">{drafts.indexOf(d) + 1}. {d.fileName}</span>
                {d.stage === 'pending' && (d.id === current?.id ? <span class="tag">处理中</span>
                  : <button class="btn small" onClick={() => setCurrentId(d.id)}>处理</button>)}
                {d.stage === 'failed' && (
                  <>
                    <span class="tag err">失败</span>
                    <p class="error small">{d.error}</p>
                    <span class="row">
                      <button class="btn small" onClick={() => repo.updateDraft({ ...d, stage: 'pending', error: undefined })}>重试</button>
                      <button class="btn small" onClick={async () => { if (await confirmDialog(`从队列移除「${d.fileName}」？`, { ok: '移除', danger: true })) repo.removeDraft(d); }}>移除</button>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
          {!showAll && drafts.length > 5 && <button class="btn ghost small" onClick={() => setShowAll(true)}>显示全部 {drafts.length} 张</button>}
          {failed.length > 0 && <p class="muted small">失败的照片不会影响其他照片的保存。</p>}
          <div class="row">
            <button class="btn small" onClick={() => fileRef.current?.click()}>继续添加</button>
          </div>
        </section>
      )}
    </div>
  );
}

function DraftEditor(props: { repo: Repo; draft: Draft; remaining: number; onSaved: () => void; onRetake: () => void }) {
  const { repo, draft } = props;
  const [source, setSource] = useState<Source>();
  const [params, setParams] = useState<EditParams>();
  const [year, setYear] = useState('');
  const [people, setPeople] = useState<string[]>([]);
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const sticky = !!repo.state.settings.stickyMeta;

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const asset = await repo.getAsset(draft.originalAssetId);
        if (!asset) throw new DecodeError('原始文件丢失，请移除后重新选择。');
        const src = await loadSource(asset.blob);
        if (!live) return;
        setSource(src);
        setParams(draft.params ?? defaultParams(src));
        if (sticky) {
          const s = JSON.parse(sessionStorage.getItem('sticky') ?? '{}');
          setYear(s.year ?? ''); setPeople((s.people ?? []).filter((id: string) => repo.state.persons.some((p) => p.id === id)));
        }
      } catch (e) {
        if (!live) return;
        const msg = e instanceof DecodeError ? e.message : `无法打开：${(e as Error).message}`;
        await repo.updateDraft({ ...draft, stage: 'failed', error: msg });
        toast(`「${draft.fileName}」无法读取，已标为失败，可继续处理下一张。`, 'error');
      }
    })();
    return () => { live = false; };
  }, [draft.id]);

  // Persist edit params so an interrupted session resumes where it stopped.
  useEffect(() => {
    if (!params) return;
    const t = setTimeout(() => repo.updateDraft({ ...draft, params }).catch(() => {}), 600);
    return () => clearTimeout(t);
  }, [params]);

  const save = async () => {
    if (!source || !params) return;
    const y = year.trim();
    if (y && !/^\d{4}$/.test(y)) { toast('年份请填写四位数字，或留空以后再补。', 'error'); return; }
    setSaving(true);
    try {
      const out = await renderMaster(source, params);
      const master = await makeAsset(out.master, 'master', 'image/jpeg');
      const thumb = await makeAsset(out.thumb, 'thumb', 'image/jpeg');
      const now = Date.now();
      const photo: Photo = {
        id: draft.photoId,
        originalAssetId: draft.originalAssetId, masterAssetId: master.id, thumbAssetId: thumb.id,
        originalName: draft.fileName, originalType: draft.fileType || source.kind,
        exifOrientation: source.orientation, width: out.width, height: out.height,
        edit: params, template: { ...DEFAULT_TEMPLATE },
        date: y ? { precision: 'year', value: y } : { precision: 'unknown' },
        title: '', place: '', notes: '', organized: false,
        createdAt: draft.createdAt, scannedAt: now, updatedAt: now,
      };
      await repo.commitDraft(draft, photo, master, thumb, people);
      if (sticky) sessionStorage.setItem('sticky', JSON.stringify({ year, people }));
      askPersist();
      toast(props.remaining > 1 ? '已保存，继续下一张' : '已保存');
      props.onSaved();
    } catch (e) {
      toast(isQuotaError(e) ? '存储空间不足，这张未保存，已保存的照片不受影响。请到「备份与恢复」导出备份或清理空间。' : `保存失败：${(e as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!source || !params) return <div class="card"><p class="muted">正在读取「{draft.fileName}」…</p></div>;

  return (
    <section class="card workbench" aria-label="扫描工作台">
      <Editor source={source} params={params} onChange={setParams} />
      {!params.autoDetected && params.corners.every((c, i) => c[0] === [0, 1, 1, 0][i] && c[1] === [0, 0, 1, 1][i]) &&
        <p class="muted small">未自动找到边缘，显示的是整张图片。拖动四个角对齐照片边缘。</p>}
      <div class="row">
        <input class="grow" inputMode="numeric" aria-label="年份" placeholder="年份 · 可稍后填" value={year} onInput={(e) => setYear((e.target as HTMLInputElement).value)} />
        <button class="btn grow" onClick={() => setPicker(true)}>{people.length ? `人物 · ${people.length} 位` : '人物 · 可稍后标'}</button>
      </div>
      {people.length > 0 && <PeopleChips repo={repo} ids={people} onRemove={(id) => setPeople(people.filter((x) => x !== id))} />}
      <label class="check small"><input type="checkbox" checked={sticky} onChange={(e) => repo.saveSettings({ stickyMeta: (e.target as HTMLInputElement).checked })} /> 下一张沿用年份和人物</label>
      <div class="row sticky-actions">
        <button class="btn" onClick={props.onRetake} disabled={saving}>{draft.source === 'camera' ? '重拍' : '移除此张'}</button>
        <button class="btn primary grow" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存并继续'}</button>
      </div>
      {picker && <PersonPicker repo={repo} selected={people} onChange={setPeople} onClose={() => setPicker(false)} />}
    </section>
  );
}

export function ReEdit({ photoId }: { photoId: string }) {
  const repo = useRepo();
  const photo = repo.state.photos.find((p) => p.id === photoId);
  const [source, setSource] = useState<Source>();
  const [params, setParams] = useState<EditParams>();
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!photo) return;
    repo.getAsset(photo.originalAssetId).then(async (a) => {
      if (!a) { toast('原件丢失，无法重新编辑', 'error'); return; }
      try {
        const s = await loadSource(a.blob);
        setSource(s);
        setParams(photo.edit);
      } catch (e) { toast((e as Error).message, 'error'); }
    });
  }, [photoId]);
  if (!photo) return <div class="page"><p>照片不存在。</p></div>;
  const save = async () => {
    if (!source || !params) return;
    setSaving(true);
    try {
      const out = await renderMaster(source, params);
      const master = await makeAsset(out.master, 'master', 'image/jpeg');
      const thumb = await makeAsset(out.thumb, 'thumb', 'image/jpeg');
      await repo.replaceRender({ ...photo, edit: params, width: out.width, height: out.height }, master, thumb);
      toast('已更新母版');
      history.back();
    } catch (e) {
      toast(isQuotaError(e) ? '存储空间不足，修改未保存。' : `保存失败：${(e as Error).message}`, 'error');
    } finally { setSaving(false); }
  };
  return (
    <div class="page">
      <header class="page-head"><button class="btn ghost" onClick={() => history.back()}>‹ 返回</button><h1>重新编辑</h1><span /></header>
      {source && params ? (
        <section class="card workbench">
          <Editor source={source} params={params} onChange={setParams} />
          <p class="muted small">基于原始文件重新生成扫描母版，人物、日期等信息不变。</p>
          <div class="row sticky-actions">
            <button class="btn" onClick={() => go(`photo/${photo.id}`)}>取消</button>
            <button class="btn primary grow" disabled={saving} onClick={save}>{saving ? '保存中…' : '保存修改'}</button>
          </div>
        </section>
      ) : <p class="muted">正在读取原件…</p>}
    </div>
  );
}
