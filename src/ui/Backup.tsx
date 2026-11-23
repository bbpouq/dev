import { useEffect, useState } from 'preact/hooks';
import { buildVolume, planExport, DEFAULT_VOLUME_BYTES, type ExportPlan } from '../backup/export';
import { executeRestore, fmtBytes, inspectBackup, type Progress, type RestorePlan } from '../backup/restore';
import { saveFile } from './save';
import { OfflineBadge } from './Library';
import { go, isStandalone, toast, useRepo } from './store';

type VolState = 'idle' | 'working' | 'saved' | 'handed' | 'confirmed' | 'error';

export function Backup() {
  const repo = useRepo();
  const { photos, persons, drafts, settings } = repo.state;
  const live = photos.filter((p) => !p.trashedAt);
  const [persisted, setPersisted] = useState<boolean | undefined>();
  const [est, setEst] = useState<{ usage?: number; quota?: number }>({});
  const [volLimit, setVolLimit] = useState(DEFAULT_VOLUME_BYTES);
  const [plan, setPlan] = useState<ExportPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [vols, setVols] = useState<VolState[]>([]);

  const refreshStorage = () => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => {});
    navigator.storage?.estimate?.().then(setEst).catch(() => {});
  };
  useEffect(refreshStorage, [photos.length]);

  const makePlan = async () => {
    setPlanning(true);
    try {
      const p = await planExport(repo, volLimit);
      setPlan(p);
      setVols(p.volumes.map(() => 'idle'));
    } catch (e) { toast((e as Error).message, 'error'); }
    finally { setPlanning(false); }
  };

  const saveVol = async (k: number) => {
    if (!plan) return;
    const set = (s: VolState) => setVols((v) => v.map((x, i) => (i === k - 1 ? s : x)));
    set('working');
    try {
      const blob = buildVolume(plan, k);
      const r = await saveFile(blob, plan.volumes[k - 1].fileName, 'application/zip');
      set(r === 'saved' ? 'saved' : r === 'cancelled' ? 'idle' : 'handed');
    } catch (e) {
      set('error');
      toast(`生成第 ${k} 卷失败：${(e as Error).message}`, 'error');
    }
  };

  useEffect(() => {
    if (plan && vols.length && vols.every((s) => s === 'saved' || s === 'confirmed')) {
      repo.saveSettings({ lastBackupAt: Date.parse(plan.manifest.exportedAt) });
    }
  }, [vols]);

  return (
    <div class="page">
      <header class="page-head">
        <button class="btn ghost" onClick={() => go('album')}>‹ 相册</button>
        <h1>备份与恢复</h1>
        <span />
      </header>

      <div class="card notice">
        <strong>档案只保存在这台设备的这个浏览器里。</strong>
        <p>清理 Safari 网站数据、长时间不用或更换设备前，请先导出备份。备份包含原图和家庭信息，未加密：请存到「文件」中的本机目录或你自己控制的位置。应用不会上传任何内容。</p>
      </div>

      <section class="card stack tight">
        <h2>本机档案</h2>
        <p>{live.length} 张照片 · {persons.length} 位人物{drafts.length ? ` · 队列中 ${drafts.length} 张未保存` : ''}</p>
        {est.usage !== undefined && <p class="muted small">已用约 {fmtBytes(est.usage)}{est.quota ? `，浏览器配额约 ${fmtBytes(est.quota)}` : ''}</p>}
        <p class="small">持久存储：{persisted === undefined ? '无法确认' : persisted ? '已获准（浏览器不会自动清理）' : '未获准（空间紧张时浏览器可能清理，务必定期备份）'}
          {persisted === false && <button class="btn small" onClick={async () => { await navigator.storage?.persist?.(); refreshStorage(); }}>再次请求</button>}</p>
        <p class="small">打开方式：{isStandalone() ? '主屏幕应用' : '浏览器标签页'} · <OfflineBadge /></p>
        <p class="small">上次备份：{settings.lastBackupAt ? new Date(settings.lastBackupAt).toLocaleString('zh-CN') : '从未'}</p>
      </section>

      <section class="card stack">
        <h2>导出备份</h2>
        <label class="field"><span>每卷大小上限</span>
          <select value={volLimit} onChange={(e) => { setVolLimit(+(e.target as HTMLSelectElement).value); setPlan(null); }}>
            {[...(location.search.includes('smallvolumes') ? [1] : []), 100, 200, 500, 1000].map((m) => <option value={m * 1024 * 1024}>{m >= 1000 ? '1 GB' : m === 1 ? '1 MB（测试）' : `${m} MB`}</option>)}
          </select>
        </label>
        {!plan ? (
          <button class="btn primary" disabled={planning} onClick={makePlan}>{planning ? '正在整理…' : '生成家庭档案备份'}</button>
        ) : (
          <div class="stack tight">
            <p>共 {plan.manifest.totals.photos} 张照片、{plan.manifest.totals.persons} 位人物、{plan.manifest.totals.relationships} 条关系，约 {fmtBytes(plan.manifest.totals.assetBytes)}，分 {plan.volumes.length} 卷。</p>
            {(plan.excludedDrafts > 0 || plan.excludedTrash > 0) && (
              <p class="warn-text">本次备份不包含：{[plan.excludedDrafts && `扫描队列中尚未保存的 ${plan.excludedDrafts} 张`, plan.excludedTrash && `回收站里的 ${plan.excludedTrash} 张`].filter(Boolean).join('；')}。</p>
            )}
            <ul class="list vols">
              {plan.volumes.map((v, i) => (
                <li class="row between wrap">
                  <span>第 {v.index}/{plan.volumes.length} 卷 · {fmtBytes(v.bytes)}<br /><small class="muted">{v.fileName}</small></span>
                  <span class="row">
                    <VolStatus s={vols[i]} />
                    {vols[i] === 'handed' && <button class="btn small" onClick={() => setVols((x) => x.map((s, j) => (j === i ? 'confirmed' : s)))}>我已确认存好</button>}
                    <button class="btn small primary" disabled={vols[i] === 'working'} onClick={() => saveVol(v.index)}>{vols[i] === 'idle' || vols[i] === 'error' ? '保存' : '再次保存'}</button>
                  </span>
                </li>
              ))}
            </ul>
            <p class="muted small">「已生成」表示文件已交给系统；请在「文件」App 中确认它已落盘，再点「我已确认存好」。</p>
            <button class="btn ghost small" onClick={() => setPlan(null)}>重新生成</button>
          </div>
        )}
      </section>

      <RestoreSection />
    </div>
  );
}

function VolStatus({ s }: { s: VolState }) {
  const t = { idle: '未保存', working: '正在生成…', saved: '已保存', handed: '已生成备份', confirmed: '已确认保存', error: '失败' }[s];
  return <span class={'tag' + (s === 'saved' || s === 'confirmed' ? ' ok' : s === 'error' ? ' err' : '')} data-testid="vol-status">{t}</span>;
}

function RestoreSection() {
  const repo = useRepo();
  const { photos, persons } = repo.state;
  const [files, setFiles] = useState<File[]>([]);
  const [plan, setPlan] = useState<RestorePlan | null>(null);
  const [err, setErr] = useState('');
  const [checking, setChecking] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const nonEmpty = photos.length > 0 || persons.length > 0;

  const pick = async (list: FileList | null) => {
    if (!list?.length) return;
    // Merge with previous selection so volumes can be picked one at a time.
    const merged = [...files];
    for (const f of list) if (!merged.some((m) => m.name === f.name && m.size === f.size)) merged.push(f);
    setFiles(merged);
    setErr(''); setPlan(null); setChecking(true);
    try { setPlan(await inspectBackup(merged)); }
    catch (e) { setErr((e as Error).message); }
    finally { setChecking(false); }
  };

  const run = async () => {
    if (!plan) return;
    setErr('');
    try {
      await executeRestore(plan, repo.id, setProgress);
      setProgress({ done: 1, total: 1, label: '恢复完成，正在重新打开档案…' });
      repo.db.close();
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      setProgress(null);
      setErr(`恢复失败：${(e as Error).message} 原档案未受影响，仍可正常使用。`);
    }
  };

  const m = plan?.manifest;
  const blocked = !plan || plan.errors.length > 0 || plan.missing.length > 0;
  return (
    <section class="card stack">
      <h2>从备份恢复</h2>
      <p class="muted small">选择同一次备份的全部分卷（可分几次选择）。恢复前会先核验；任何损坏、缺卷或空间不足都不会改动当前档案。可以断网进行。</p>
      <label class="btn">
        选择备份文件…
        <input type="file" accept=".zip,application/zip" multiple hidden data-testid="restore-input"
          onChange={(e) => { const t = e.target as HTMLInputElement; pick(t.files).then(() => (t.value = '')); }} />
      </label>
      {files.length > 0 && <p class="small">已选择 {files.length} 个文件 <button class="btn ghost small" onClick={() => { setFiles([]); setPlan(null); setErr(''); }}>清空</button></p>}
      {checking && <p class="muted">正在核验…</p>}
      {err && <p class="error" role="alert">{err}</p>}
      {plan && m && (
        <div class="stack tight" data-testid="restore-summary">
          <p>备份时间：{new Date(m.exportedAt).toLocaleString('zh-CN')}</p>
          <p>将恢复 <strong>{m.photos.length}</strong> 张照片、<strong>{m.persons.length}</strong> 位人物、{m.relationships.length} 条关系</p>
          {plan.totalBytes > 0 && <p class="small">数据约 {fmtBytes(plan.totalBytes)}，预估需要 {fmtBytes(plan.neededBytes)}{plan.available !== undefined ? `，当前可用约 ${fmtBytes(plan.available)}` : '（无法读取可用空间）'}</p>}
          <p class="small">分卷：{Array.from({ length: m.volumeCount || 0 }, (_, i) => i + 1).map((k) => (
            <span class={'tag' + (plan.missing.includes(k) ? ' err' : ' ok')}>第 {k} 卷{plan.missing.includes(k) ? ' 缺失' : ' ✓'}</span>
          ))}</p>
          {plan.missing.length > 0 && <p class="error">还缺少第 {plan.missing.join('、')} 卷，请继续选择。</p>}
          {plan.errors.length > 0 && <ul class="error">{plan.errors.map((e) => <li>{e}</li>)}</ul>}
          {!blocked && nonEmpty && (
            <label class="check warn-text">
              <input type="checkbox" checked={confirmReplace} onChange={(e) => setConfirmReplace((e.target as HTMLInputElement).checked)} />
              我确认用此备份整体替换当前档案（当前 {photos.length} 张照片、{persons.length} 位人物将被替换）
            </label>
          )}
          {progress ? (
            <div><progress max={progress.total} value={progress.done} /> <span class="small">{progress.label} {progress.done}/{progress.total}</span></div>
          ) : (
            <button class="btn primary" disabled={blocked || (nonEmpty && !confirmReplace)} onClick={run}>{nonEmpty ? '替换并恢复' : '开始恢复'}</button>
          )}
        </div>
      )}
    </section>
  );
}
