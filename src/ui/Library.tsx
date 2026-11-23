import { useMemo, useState } from 'preact/hooks';
import type { Repo } from '../db/repo';
import type { Photo } from '../types';
import { dateSortKey, decadeOf, formatDate, isTodo } from '../util/date';
import { Thumb } from './Thumb';
import { PersonLabel } from './people';
import { go, offlineStatus, useRepo, useSignal } from './store';

type Tab = 'all' | 'todo' | 'year' | 'person';

export function sortPhotos(ps: Photo[]): Photo[] {
  return [...ps].sort((a, b) => dateSortKey(a.date).localeCompare(dateSortKey(b.date)) || a.scannedAt - b.scannedAt);
}

export function PhotoGrid({ repo, photos }: { repo: Repo; photos: Photo[] }) {
  if (!photos.length) return <p class="muted empty">没有符合条件的照片。</p>;
  return (
    <ul class="grid">
      {photos.map((p) => (
        <li key={p.id}>
          <a href={`#/photo/${p.id}`} aria-label={p.title || formatDate(p.date)}>
            <Thumb repo={repo} assetId={p.thumbAssetId} alt={p.title || formatDate(p.date)} />
            <span class="cap">{p.title || formatDate(p.date)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function OfflineBadge() {
  const s = useSignal(offlineStatus);
  const text = { dev: '开发模式', unsupported: '此浏览器不支持离线', preparing: '正在准备离线…', ready: '离线可用', failed: '离线资源未就绪' }[s];
  return <span class={'badge ' + (s === 'ready' ? 'ok' : s === 'failed' || s === 'unsupported' ? 'warn' : '')} data-testid="offline-badge">{text}</span>;
}

export function Library() {
  const repo = useRepo();
  const { photos: allPhotos, persons, photoPersons } = repo.state;
  const [tab, setTab] = useState<Tab>(() => (sessionStorage.getItem('lib-tab') as Tab) || 'all');
  const [q, setQ] = useState('');
  const [decade, setDecade] = useState<number | 'unknown' | null>(null);
  const [personFilter, setPersonFilter] = useState<string>('');
  const selectTab = (t: Tab) => { setTab(t); sessionStorage.setItem('lib-tab', t); setDecade(null); setPersonFilter(''); };

  const live = useMemo(() => allPhotos.filter((p) => !p.trashedAt), [allPhotos]);
  const peopleOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const t of photoPersons) { let a = m.get(t.photoId); if (!a) m.set(t.photoId, (a = [])); a.push(t.personId); }
    return m;
  }, [photoPersons]);
  const trashCount = allPhotos.length - live.length;
  const todo = live.filter((p) => isTodo(p, peopleOf.get(p.id)?.length ?? 0));

  const query = q.trim().toLowerCase();
  const matches = (p: Photo) => !query || [p.title, p.notes, p.place, p.originalName].some((s) => s?.toLowerCase().includes(query));
  const byPerson = (p: Photo) => !personFilter || (peopleOf.get(p.id) ?? []).includes(personFilter);

  let body;
  if (query) {
    body = <PhotoGrid repo={repo} photos={sortPhotos(live.filter(matches))} />;
  } else if (tab === 'all') {
    body = <PhotoGrid repo={repo} photos={sortPhotos(live)} />;
  } else if (tab === 'todo') {
    body = (
      <>
        <p class="muted small">尚未填写原始年份或未标人物的照片。可以在照片详情补录，或在确实未知时标为已整理。</p>
        <PhotoGrid repo={repo} photos={sortPhotos(todo)} />
      </>
    );
  } else if (tab === 'year') {
    const groups = new Map<number | 'unknown', Photo[]>();
    for (const p of live) {
      const d = decadeOf(p.date) ?? 'unknown';
      let g = groups.get(d); if (!g) groups.set(d, (g = [])); g.push(p);
    }
    const keys = [...groups.keys()].sort((a, b) => (a === 'unknown' ? 1 : b === 'unknown' ? -1 : a - b));
    if (decade !== null) {
      const ps = groups.get(decade) ?? [];
      const ids = new Set(ps.flatMap((p) => peopleOf.get(p.id) ?? []));
      body = (
        <>
          <div class="row between">
            <button class="btn ghost" onClick={() => { setDecade(null); setPersonFilter(''); }}>‹ 全部年代</button>
            <strong>{decade === 'unknown' ? '年代未知' : `${decade} 年代`}</strong>
          </div>
          {ids.size > 0 && (
            <div class="chips wrap">
              <button class={'chip' + (!personFilter ? ' on' : '')} onClick={() => setPersonFilter('')}>所有人</button>
              {persons.filter((p) => ids.has(p.id)).map((p) => (
                <button class={'chip' + (personFilter === p.id ? ' on' : '')} onClick={() => setPersonFilter(p.id)}><PersonLabel p={p} all={persons} /></button>
              ))}
            </div>
          )}
          <PhotoGrid repo={repo} photos={sortPhotos(ps.filter(byPerson))} />
        </>
      );
    } else {
      body = keys.length ? (
        <ul class="list">
          {keys.map((k) => (
            <li><button class="list-item" onClick={() => setDecade(k)}>
              <strong>{k === 'unknown' ? '年代未知' : `${k} 年代`}</strong>
              <span class="muted">{groups.get(k)!.length} 张 · {k === 'unknown' ? '以后可以补录' : '可按人物继续筛选'}</span>
            </button></li>
          ))}
        </ul>
      ) : <p class="muted empty">还没有照片。</p>;
    }
  } else {
    const counts = new Map<string, number>();
    const liveIds = new Set(live.map((p) => p.id));
    for (const t of photoPersons) if (liveIds.has(t.photoId)) counts.set(t.personId, (counts.get(t.personId) ?? 0) + 1);
    const untagged = live.filter((p) => !(peopleOf.get(p.id)?.length)).length;
    body = persons.length ? (
      <ul class="list">
        {[...persons].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0)).map((p) => (
          <li><button class="list-item" onClick={() => go(`person/${p.id}`)}>
            <strong><PersonLabel p={p} all={persons} /></strong><span class="muted">{counts.get(p.id) ?? 0} 张</span>
          </button></li>
        ))}
        {untagged > 0 && <li class="muted small pad">另有 {untagged} 张照片未标人物</li>}
      </ul>
    ) : <p class="muted empty">还没有人物。可以在「家庭树」或照片详情里添加。</p>;
  }

  return (
    <div class="page">
      <header class="page-head">
        <h1>相册</h1>
        <div class="row">
          <OfflineBadge />
          <button class="btn small" onClick={() => go('backup')}>备份与恢复</button>
        </div>
      </header>
      <input type="search" class="search" placeholder="搜索标题、地点或备注" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      {!query && (
        <div class="chips tabs" role="tablist">
          {([['all', `全部 ${live.length}`], ['todo', `待整理 ${todo.length}`], ['year', '按年份'], ['person', '按人物']] as [Tab, string][]).map(([k, label]) => (
            <button role="tab" aria-selected={tab === k} class={'chip' + (tab === k ? ' on' : '')} onClick={() => selectTab(k)}>{label}</button>
          ))}
        </div>
      )}
      {live.length === 0 && !query ? (
        <div class="card empty-state">
          <p>还没有照片。</p>
          <button class="btn primary" onClick={() => go('scan')}>开始扫描</button>
        </div>
      ) : body}
      <footer class="lib-foot">
        <p class="muted small">档案保存在此设备。请定期导出备份。</p>
        {trashCount > 0 && <button class="btn ghost small" onClick={() => go('trash')}>回收站（{trashCount}）</button>}
      </footer>
    </div>
  );
}
