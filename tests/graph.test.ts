import { describe, expect, it } from 'vitest';
import { Graph, makeRel, validateAllRels, validateRel } from '../src/family/graph';
import type { Relationship } from '../src/types';

const people = ['gpa', 'gma', 'mom', 'dad', 'me', 'sis', 'kid', 'me2'].map((id) => ({ id }));

function build(rels: Relationship[]) { return new Graph(people, rels); }

describe('family graph', () => {
  const rels = [
    makeRel('parent_of', 'gpa', 'mom'), makeRel('parent_of', 'gma', 'mom'), makeRel('partner_of', 'gpa', 'gma'),
    makeRel('parent_of', 'mom', 'me'), makeRel('parent_of', 'mom', 'sis'), makeRel('parent_of', 'me', 'kid'),
  ];
  const g = build(rels);

  it('derives siblings from shared parents (single parent ok)', () => {
    expect(g.siblingsOf('me')).toEqual(['sis']);
    expect(g.parentsOf('me')).toEqual(['mom']);
  });

  it('partners are symmetric and normalized', () => {
    expect(g.partnersOf('gma')).toEqual(['gpa']);
    expect(makeRel('partner_of', 'gpa', 'gma').id).toBe(makeRel('partner_of', 'gma', 'gpa').id);
    expect(validateRel(g, rels, 'partner_of', 'gma', 'gpa')).toBe('duplicate');
  });

  it('rejects self, duplicates and ancestor cycles', () => {
    expect(validateRel(g, rels, 'parent_of', 'me', 'me')).toBe('self');
    expect(validateRel(g, rels, 'parent_of', 'mom', 'me')).toBe('duplicate');
    expect(validateRel(g, rels, 'parent_of', 'kid', 'gpa')).toBe('cycle');
    expect(validateRel(g, rels, 'parent_of', 'me', 'mom')).toBe('cycle');
    expect(validateRel(g, rels, 'parent_of', 'dad', 'me')).toBeNull();
    expect(validateRel(g, rels, 'partner_of', 'me', 'kid')).toBe('parent_partner');
  });

  it('allows multiple partners and unconnected people', () => {
    const r2 = [...rels, makeRel('partner_of', 'me', 'dad')];
    expect(validateRel(build(r2), r2, 'partner_of', 'me', 'me2')).toBeNull();
    expect(build(rels).hasRelation('me2')).toBe(false);
  });

  it('validates whole sets (restore)', () => {
    expect(validateAllRels(new Set(people.map((p) => p.id)), rels)).toBeNull();
    const bad = [...rels, makeRel('parent_of', 'kid', 'gpa')];
    expect(validateAllRels(new Set(people.map((p) => p.id)), bad)).toMatch(/祖先/);
    expect(validateAllRels(new Set(['a']), [makeRel('parent_of', 'a', 'zz')])).toMatch(/不存在/);
  });
});
