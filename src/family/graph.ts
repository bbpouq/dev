import type { Person, Relationship, RelType } from '../types';

export function relId(type: RelType, a: string, b: string): string {
  if (type === 'partner_of' && a > b) [a, b] = [b, a];
  return `${type}:${a}:${b}`;
}

export function makeRel(type: RelType, a: string, b: string): Relationship {
  if (type === 'partner_of' && a > b) [a, b] = [b, a];
  return { id: relId(type, a, b), type, a, b };
}

export class Graph {
  parents = new Map<string, Set<string>>();
  children = new Map<string, Set<string>>();
  partners = new Map<string, Set<string>>();
  ids = new Set<string>();

  constructor(persons: Iterable<Pick<Person, 'id'>>, rels: Iterable<Relationship>) {
    for (const p of persons) this.ids.add(p.id);
    for (const r of rels) this.add(r);
  }

  private static push(m: Map<string, Set<string>>, k: string, v: string) {
    let s = m.get(k);
    if (!s) m.set(k, (s = new Set()));
    s.add(v);
  }

  add(r: Relationship) {
    if (r.type === 'parent_of') {
      Graph.push(this.children, r.a, r.b);
      Graph.push(this.parents, r.b, r.a);
    } else {
      Graph.push(this.partners, r.a, r.b);
      Graph.push(this.partners, r.b, r.a);
    }
  }

  parentsOf(id: string): string[] { return [...(this.parents.get(id) ?? [])]; }
  childrenOf(id: string): string[] { return [...(this.children.get(id) ?? [])]; }
  partnersOf(id: string): string[] { return [...(this.partners.get(id) ?? [])]; }

  /** Siblings: share at least one parent. */
  siblingsOf(id: string): string[] {
    const out = new Set<string>();
    for (const p of this.parentsOf(id)) for (const c of this.childrenOf(p)) if (c !== id) out.add(c);
    return [...out];
  }

  isDescendant(of: string, candidate: string): boolean {
    const stack = [of];
    const seen = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      for (const c of this.children.get(cur) ?? []) {
        if (c === candidate) return true;
        if (!seen.has(c)) { seen.add(c); stack.push(c); }
      }
    }
    return false;
  }

  hasRelation(id: string): boolean {
    return !!(this.parents.get(id)?.size || this.children.get(id)?.size || this.partners.get(id)?.size);
  }
}

export type RelError = 'self' | 'duplicate' | 'cycle' | 'missing' | 'parent_partner';

export const REL_ERROR_TEXT: Record<RelError, string> = {
  self: '不能把人物和自己关联。',
  duplicate: '这条关系已经存在。',
  cycle: '这样会让某人成为自己的祖先，已拒绝。',
  missing: '人物不存在。',
  parent_partner: '父母与子女之间不能设为伴侣。',
};

/** Validate adding relation (type, a, b) to existing graph. Returns null if OK. */
export function validateRel(g: Graph, rels: Iterable<Relationship>, type: RelType, a: string, b: string): RelError | null {
  if (!g.ids.has(a) || !g.ids.has(b)) return 'missing';
  if (a === b) return 'self';
  const id = relId(type, a, b);
  for (const r of rels) if (r.id === id) return 'duplicate';
  if (type === 'parent_of') {
    if (g.parentsOf(b).includes(a)) return 'duplicate';
    // a must not already be a descendant of b (or equal): otherwise a cycle.
    if (g.isDescendant(b, a)) return 'cycle';
    if (g.partnersOf(a).includes(b)) return 'parent_partner';
  } else {
    if (g.parentsOf(a).includes(b) || g.parentsOf(b).includes(a)) return 'parent_partner';
  }
  return null;
}

/** Validate a whole relationship set (used by restore). */
export function validateAllRels(personIds: Set<string>, rels: Relationship[]): string | null {
  const g = new Graph([...personIds].map((id) => ({ id })), []);
  const seen: Relationship[] = [];
  const ids = new Set<string>();
  for (const r of rels) {
    if (r.type !== 'parent_of' && r.type !== 'partner_of') return `未知关系类型 ${String(r.type)}`;
    if (r.id !== relId(r.type, r.a, r.b)) return `关系 ID 不规范：${r.id}`;
    if (ids.has(r.id)) return `关系重复：${r.id}`;
    const err = validateRel(g, seen, r.type, r.a, r.b);
    if (err) return `${REL_ERROR_TEXT[err]}（${r.id}）`;
    g.add(r);
    seen.push(r);
    ids.add(r.id);
  }
  return null;
}
