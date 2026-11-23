import { useState } from 'preact/hooks';
import type { Repo } from '../db/repo';
import type { Person } from '../types';
import { Sheet } from './dialog';
import { toast } from './store';

/** Secondary text that tells same-named people apart. */
export function personHint(p: Person, all: Person[]): string {
  const parts: string[] = [];
  if (p.fullName && p.fullName !== p.displayName) parts.push(p.fullName);
  if (p.birthYear) parts.push(`${p.birthYear} 年生`);
  const twins = all.filter((o) => o.displayName === p.displayName && o.id !== p.id);
  if (twins.length && !parts.length) parts.push(`#${p.id.slice(0, 4)}`);
  return parts.join(' · ');
}

export function PersonLabel({ p, all }: { p: Person; all: Person[] }) {
  const h = personHint(p, all);
  return <span>{p.displayName}{h && <small class="muted"> {h}</small>}</span>;
}

export function NewPersonFields(props: { value: NewPerson; onChange: (v: NewPerson) => void; autoFocus?: boolean }) {
  const v = props.value;
  return (
    <div class="stack">
      <label class="field">
        <span>显示名或称呼 *</span>
        <input value={v.displayName} autoFocus={props.autoFocus} placeholder="例如：外婆、妈妈、小明"
          onInput={(e) => props.onChange({ ...v, displayName: (e.target as HTMLInputElement).value })} />
      </label>
      <div class="row">
        <label class="field grow">
          <span>姓名（可空）</span>
          <input value={v.fullName} onInput={(e) => props.onChange({ ...v, fullName: (e.target as HTMLInputElement).value })} />
        </label>
        <label class="field" style="width:7.5em">
          <span>出生年（可空）</span>
          <input inputMode="numeric" value={v.birthYear} placeholder="1950"
            onInput={(e) => props.onChange({ ...v, birthYear: (e.target as HTMLInputElement).value })} />
        </label>
      </div>
    </div>
  );
}

export interface NewPerson { displayName: string; fullName: string; birthYear: string }
export const emptyPerson = (): NewPerson => ({ displayName: '', fullName: '', birthYear: '' });

export function parsePerson(v: NewPerson): Omit<Person, 'id' | 'createdAt'> {
  const displayName = v.displayName.trim();
  if (!displayName) throw new Error('请填写显示名或称呼。');
  const out: Omit<Person, 'id' | 'createdAt'> = { displayName };
  if (v.fullName.trim()) out.fullName = v.fullName.trim();
  if (v.birthYear.trim()) {
    const y = parseInt(v.birthYear, 10);
    if (!/^\d{4}$/.test(v.birthYear.trim()) || y < 1000 || y > 3000) throw new Error('出生年应为四位数字，例如 1950。');
    out.birthYear = y;
  }
  return out;
}

/** Multi-select people with search and inline "add new". */
export function PersonPicker(props: { repo: Repo; selected: string[]; onClose: () => void; onChange: (ids: string[]) => void; title?: string }) {
  const { repo } = props;
  const all = repo.state.persons;
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState<NewPerson | null>(null);
  const sel = new Set(props.selected);
  const list = all
    .filter((p) => !q || p.displayName.includes(q) || (p.fullName ?? '').includes(q))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh'));
  const toggle = (id: string) => {
    const n = new Set(sel);
    if (n.has(id)) n.delete(id); else n.add(id);
    props.onChange([...n]);
  };
  const create = async () => {
    try {
      const p = await repo.addPerson(parsePerson(adding!));
      props.onChange([...sel, p.id]);
      setAdding(null);
    } catch (e) { toast((e as Error).message, 'error'); }
  };
  return (
    <Sheet title={props.title ?? '标记人物'} onClose={props.onClose}>
      {adding ? (
        <div class="stack">
          <NewPersonFields value={adding} onChange={setAdding} autoFocus />
          <div class="row end">
            <button class="btn" onClick={() => setAdding(null)}>返回</button>
            <button class="btn primary" onClick={create}>新增并勾选</button>
          </div>
        </div>
      ) : (
        <div class="stack">
          {all.length > 6 && <input type="search" placeholder="搜索人物" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />}
          {list.length === 0 && <p class="muted">还没有人物。可以先只写称呼，之后再补姓名或关系。</p>}
          <div class="chips wrap">
            {list.map((p) => (
              <button class={'chip' + (sel.has(p.id) ? ' on' : '')} aria-pressed={sel.has(p.id)} onClick={() => toggle(p.id)}>
                {sel.has(p.id) ? '✓ ' : ''}<PersonLabel p={p} all={all} />
              </button>
            ))}
          </div>
          <div class="row between">
            <button class="btn" onClick={() => setAdding({ ...emptyPerson(), displayName: q })}>＋ 新增人物</button>
            <button class="btn primary" onClick={props.onClose}>完成</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

export function PeopleChips(props: { repo: Repo; ids: string[]; onRemove?: (id: string) => void; onOpen?: (id: string) => void }) {
  const all = props.repo.state.persons;
  const byId = new Map(all.map((p) => [p.id, p]));
  return (
    <div class="chips wrap">
      {props.ids.map((id) => byId.get(id)).filter(Boolean).map((p) => (
        <span class="chip on static">
          <button class="linklike" onClick={() => props.onOpen?.(p!.id)}><PersonLabel p={p!} all={all} /></button>
          {props.onRemove && <button class="x" aria-label={`解除标记 ${p!.displayName}`} onClick={() => props.onRemove!(p!.id)}>×</button>}
        </span>
      ))}
    </div>
  );
}
