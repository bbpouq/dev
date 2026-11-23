import type { Photo, PhotoDate } from '../types';

export function photoYear(d: PhotoDate): number | undefined {
  if (d.precision === 'unknown' || !d.value) return undefined;
  const y = parseInt(d.value.slice(0, 4), 10);
  return Number.isFinite(y) ? y : undefined;
}

export function decadeOf(d: PhotoDate): number | undefined {
  const y = photoYear(d);
  return y === undefined ? undefined : Math.floor(y / 10) * 10;
}

export function formatDate(d: PhotoDate): string {
  if (d.precision === 'unknown' || !d.value) return '年代未知';
  switch (d.precision) {
    case 'exact': {
      const [y, m, day] = d.value.split('-');
      return `${y} 年 ${parseInt(m, 10)} 月 ${parseInt(day, 10)} 日`;
    }
    case 'year': return `${d.value.slice(0, 4)} 年`;
    case 'approx': return `约 ${d.value.slice(0, 4)} 年`;
    case 'decade': return `${d.value.slice(0, 4)} 年代`;
  }
  return '年代未知';
}

/** Sort key: dated photos by date ascending, unknown last. */
export function dateSortKey(d: PhotoDate): string {
  if (d.precision === 'unknown' || !d.value) return '9999';
  const v = d.value;
  if (d.precision === 'exact') return v;
  if (d.precision === 'decade') return `${v.slice(0, 4)}-00-00`;
  return `${v.slice(0, 4)}-00-01`;
}

export function isValidDate(d: PhotoDate): boolean {
  if (d.precision === 'unknown') return true;
  const v = d.value ?? '';
  if (d.precision === 'exact') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const t = new Date(v + 'T00:00:00Z');
    return !isNaN(t.getTime()) && t.toISOString().slice(0, 10) === v;
  }
  if (!/^\d{4}$/.test(v)) return false;
  if (d.precision === 'decade' && parseInt(v, 10) % 10 !== 0) return false;
  return true;
}

/** 待整理: missing original year or no people, unless manually marked organized. */
export function isTodo(p: Photo, personCount: number): boolean {
  if (p.organized) return false;
  return photoYear(p.date) === undefined || personCount === 0;
}
