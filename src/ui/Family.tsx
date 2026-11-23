import { useState } from 'preact/hooks';
import type { Person } from '../types';
import type { Repo } from '../db/repo';
import { Graph } from '../family/graph';
import { NewPersonFields, PersonLabel, emptyPerson, parsePerson, personHint, type NewPerson } from './people';
import { Sheet, confirmDialog } from './dialog';
import { PhotoGrid, sortPhotos } from './Library';
import { go, toast, useRepo } from './store';

type RelKind = 'parent' | 'partner' | 'child' | 'sibling';
const REL_TITLE: Record<RelKind, string> = { parent: '父母', partner: '伴侣', child: '子女', sibling: '兄弟姐妹' };

function photoCount(repo: Repo, personId: string) {
  const live = new Set(repo.state.photos.filter((p) => !p.trashedAt).map((p) => p.id));
  return repo.state.photoPersons.filter((t) => t.personId === personId && live.has(t.photoId)).length;
}

export function Family() {
  const repo = useRepo();
  const { persons, settings } = repo.state;
  const [centerSel, setCenter] = useState<string | null>(() => sessionStorage.getItem('center'));
  const [addRel, setAddRel] = useState<RelKind | null>(null);
  const [edit, setEdit] = useState<Person | null>(null);
  const [creating, setCreating] = useState(false);
  const byId = new Map(persons.map((p) => [p.id, p]));
  const centerId = (centerSel && byId.has(centerSel) ? centerSel : settings.meId && byId.has(settings.meId) ? settings.meId : persons[0]?.id) ?? null;
  const pick = (id: string) => { setCenter(id); sessionStorage.setItem('center', id); };

  if (!persons.length) {
    return (
      <div class="page">
        <header class="page-head"><h1>家庭树</h1></header>
        <div class="card stack">
          <p>从「我」开始，再添加父母、祖辈等家人。资料不齐时可以只写称呼。</p>
          <button class="btn primary" onClick={async () => {
            const me = await repo.addPerson({ displayName: '我' });
            await repo.saveSettings({ meId: me.id });
          }}>从「我」开始</button>
          <button class="btn" onClick={() => setCreating(true)}>添加其他家人</button>
        </div>
        {creating && <CreatePersonSheet repo={repo} onClose={() => setCreating(false)} onCreated={pick} />}
      </div>
    );
  }

  const g = repo.graph();
  const center = byId.get(centerId!)!;
  const parents = g.parentsOf(center.id);
  const grand = parents.map((p) => ({ of: p, ps: g.parentsOf(p) }));
  const partners = g.partnersOf(center.id);
  const siblings = g.siblingsOf(center.id);
  const children = g.childrenOf(center.id);
  const node = (id: string, cls = '') => {
    const p = byId.get(id)!;
    return (
      <button class={'node ' + cls} onClick={() => pick(id)} aria-current={id === center.id ? 'true' : undefined}>
        {p.displayName}{id === settings.meId && id !== center.id ? '（我）' : ''}
        {personHint(p, persons) && <small>{personHint(p, persons)}</small>}
      </button>
    );
  };
  const pairRow = (ids: string[], gg: Graph) => {
    // Render partners next to each other with a 「伴侣」 connector.
    const out: preact.JSX.Element[] = [];
    const used = new Set<string>();
    for (const id of ids) {
      if (used.has(id)) continue;
      used.add(id);
      const mate = ids.find((o) => !used.has(o) && gg.partnersOf(id).includes(o));
      if (mate) {
        used.add(mate);
        out.push(<span class="pair">{node(id)}<span class="link">伴侣</span>{node(mate)}</span>);
      } else out.push(node(id));
    }
    return out;
  };
  const unconnected = persons.filter((p) => !g.hasRelation(p.id));
  const count = photoCount(repo, center.id);
  const rels = repo.state.rels.filter((r) => r.a === center.id || r.b === center.id);
  const relText = (r: typeof rels[number]) => {
    const other = byId.get(r.a === center.id ? r.b : r.a)?.displayName ?? '?';
    if (r.type === 'partner_of') return `伴侣：${other}`;
    return r.a === center.id ? `子女：${other}` : `父母：${other}`;
  };

  return (
    <div class="page family">
      <header class="page-head">
        <h1>家庭树</h1>
        <button class="btn small" onClick={() => setCreating(true)}>添加家人</button>
      </header>

      <section class="card tree" aria-label="家庭树">
        {grand.some((x) => x.ps.length) && (
          <div class="tier">{grand.filter((x) => x.ps.length).map((x) => <span class="group">{pairRow(x.ps, g)}</span>)}</div>
        )}
        {parents.length > 0 && <div class="tier">{pairRow(parents, g)}</div>}
        <div class="tier center-tier">
          {node(center.id, 'center')}
          {partners.map((p) => <><span class="link">伴侣</span>{node(p)}</>)}
        </div>
        {siblings.length > 0 && <div class="tier sib"><span class="tier-label">兄弟姐妹</span>{siblings.map((s) => node(s))}</div>}
        {children.length > 0 && <div class="tier"><span class="tier-label">子女</span>{children.map((c) => node(c))}</div>}
      </section>

      <section class="card stack">
        <div class="row between">
          <div>
            <strong><PersonLabel p={center} all={persons} />{center.id === settings.meId ? '（我）' : ''}</strong>
            <div class="muted">{count} 张照片</div>
          </div>
          <button class="btn primary small" onClick={() => go(`person/${center.id}`)}>查看照片</button>
        </div>
        <div class="chips wrap">
          {(['parent', 'partner', 'child', 'sibling'] as RelKind[]).map((k) => (
            <button class="chip" disabled={k === 'sibling' && !parents.length} title={k === 'sibling' && !parents.length ? '先添加父母，兄弟姐妹通过共同的父母关联' : undefined}
              onClick={() => setAddRel(k)}>＋ {REL_TITLE[k]}</button>
          ))}
        </div>
        {!parents.length && <p class="muted small">兄弟姐妹通过共同的父母关联，可先添加父母（只写称呼也可以）。</p>}
        <div class="row wrap">
          <button class="btn small" onClick={() => setEdit(center)}>编辑资料</button>
          {settings.meId !== center.id && <button class="btn small" onClick={() => repo.saveSettings({ meId: center.id })}>设为「我」</button>}
        </div>
        {rels.length > 0 && (
          <details>
            <summary>关系（{rels.length}）</summary>
            <ul class="list">
              {rels.map((r) => (
                <li class="row between"><span>{relText(r)}</span>
                  <button class="btn small" onClick={async () => { if (await confirmDialog(`解除「${relText(r)}」这条关系？`, { ok: '解除', danger: true })) repo.removeRel(r.id); }}>解除</button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section class="card">
        <h2>全部人物（{persons.length}）</h2>
        <div class="chips wrap">
          {persons.map((p) => <button class={'chip' + (p.id === center.id ? ' on' : '')} onClick={() => pick(p.id)}><PersonLabel p={p} all={persons} /></button>)}
        </div>
        {unconnected.length > 0 && <p class="muted small">{unconnected.length} 位人物尚未与其他人关联。</p>}
      </section>

      {addRel && <AddRelSheet repo={repo} center={center} kind={addRel} onClose={() => setAddRel(null)} />}
      {edit && <EditPersonSheet repo={repo} person={edit} onClose={() => setEdit(null)} onDeleted={() => { setCenter(null); sessionStorage.removeItem('center'); }} />}
      {creating && <CreatePersonSheet repo={repo} onClose={() => setCreating(false)} onCreated={pick} />}
    </div>
  );
}

function CreatePersonSheet({ repo, onClose, onCreated }: { repo: Repo; onClose: () => void; onCreated: (id: string) => void }) {
  const [v, setV] = useState<NewPerson>(emptyPerson());
  return (
    <Sheet title="添加家人" onClose={onClose}>
      <div class="stack">
        <NewPersonFields value={v} onChange={setV} autoFocus />
        <p class="muted small">之后可以在家庭树里为 TA 添加父母、伴侣或子女关系。</p>
        <button class="btn primary" onClick={async () => {
          try { const p = await repo.addPerson(parsePerson(v)); onCreated(p.id); onClose(); } catch (e) { toast((e as Error).message, 'error'); }
        }}>保存</button>
      </div>
    </Sheet>
  );
}

function AddRelSheet({ repo, center, kind, onClose }: { repo: Repo; center: Person; kind: RelKind; onClose: () => void }) {
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [v, setV] = useState<NewPerson>(emptyPerson());
  const [sel, setSel] = useState('');
  const [err, setErr] = useState('');
  const persons = repo.state.persons.filter((p) => p.id !== center.id);

  const link = async (otherId: string) => {
    const g = repo.graph();
    if (kind === 'parent') await repo.addRel('parent_of', otherId, center.id);
    else if (kind === 'child') await repo.addRel('parent_of', center.id, otherId);
    else if (kind === 'partner') await repo.addRel('partner_of', center.id, otherId);
    else {
      const ps = g.parentsOf(center.id).filter((p) => !g.parentsOf(otherId).includes(p));
      if (!ps.length) throw new Error('TA 已经是兄弟姐妹。');
      for (const p of ps) await repo.addRel('parent_of', p, otherId);
    }
  };

  const submit = async () => {
    setErr('');
    try {
      if (mode === 'existing') {
        if (!sel) throw new Error('请选择一位人物。');
        await link(sel);
      } else {
        const data = parsePerson(v);
        const p = await repo.addPerson(data);
        try { await link(p.id); } catch (e) { await repo.deletePerson(p.id); throw e; }
      }
      toast('已添加');
      onClose();
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <Sheet title={`为「${center.displayName}」添加${REL_TITLE[kind]}`} onClose={onClose}>
      <div class="stack">
        <div class="chips">
          <button class={'chip' + (mode === 'new' ? ' on' : '')} onClick={() => setMode('new')}>新增人物</button>
          <button class={'chip' + (mode === 'existing' ? ' on' : '')} disabled={!persons.length} onClick={() => setMode('existing')}>选择已有人物</button>
        </div>
        {mode === 'new' ? <NewPersonFields value={v} onChange={setV} autoFocus /> : (
          <select aria-label="选择人物" value={sel} onChange={(e) => setSel((e.target as HTMLSelectElement).value)}>
            <option value="">请选择…</option>
            {persons.map((p) => <option value={p.id}>{p.displayName}{personHint(p, repo.state.persons) ? `（${personHint(p, repo.state.persons)}）` : ''}</option>)}
          </select>
        )}
        {kind === 'sibling' && <p class="muted small">兄弟姐妹会关联到「{center.displayName}」的父母。</p>}
        {err && <p class="error" role="alert">{err}</p>}
        <button class="btn primary" onClick={submit}>添加</button>
      </div>
    </Sheet>
  );
}

function EditPersonSheet({ repo, person, onClose, onDeleted }: { repo: Repo; person: Person; onClose: () => void; onDeleted: () => void }) {
  const [v, setV] = useState<NewPerson>({ displayName: person.displayName, fullName: person.fullName ?? '', birthYear: person.birthYear ? String(person.birthYear) : '' });
  const count = photoCount(repo, person.id);
  return (
    <Sheet title="编辑人物" onClose={onClose}>
      <div class="stack">
        <NewPersonFields value={v} onChange={setV} />
        <p class="muted small">改名后，所有标记了 TA 的照片会同步显示新名字。</p>
        <button class="btn primary" onClick={async () => {
          try {
            const d = parsePerson(v);
            await repo.updatePerson({ id: person.id, createdAt: person.createdAt, ...d });
            onClose();
          } catch (e) { toast((e as Error).message, 'error'); }
        }}>保存</button>
        <button class="btn danger-text" onClick={async () => {
          if (await confirmDialog(`删除人物「${person.displayName}」？`, { detail: `TA 的 ${count} 张照片会保留，只解除人物标记和家庭关系。`, ok: '删除人物', danger: true })) {
            await repo.deletePerson(person.id);
            onDeleted();
            onClose();
            toast('已删除人物，照片已保留');
          }
        }}>删除人物</button>
      </div>
    </Sheet>
  );
}

export function PersonPage({ id }: { id: string }) {
  const repo = useRepo();
  const p = repo.state.persons.find((x) => x.id === id);
  if (!p) return <div class="page"><p>人物不存在。</p><button class="btn" onClick={() => go('family')}>返回家庭树</button></div>;
  const ids = new Set(repo.state.photoPersons.filter((t) => t.personId === id).map((t) => t.photoId));
  const photos = sortPhotos(repo.state.photos.filter((x) => ids.has(x.id) && !x.trashedAt));
  return (
    <div class="page">
      <header class="page-head">
        <button class="btn ghost" onClick={() => (history.length > 1 ? history.back() : go('family'))}>‹ 返回</button>
        <h1><PersonLabel p={p} all={repo.state.persons} /></h1>
        <button class="btn small" onClick={() => { sessionStorage.setItem('center', p.id); go('family'); }}>在家庭树中查看</button>
      </header>
      <p class="muted">{photos.length} 张照片 · 按原始日期从早到晚</p>
      <PhotoGrid repo={repo} photos={photos} />
    </div>
  );
}
