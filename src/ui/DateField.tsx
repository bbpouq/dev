import { useEffect, useState } from 'preact/hooks';
import type { DatePrecision, PhotoDate } from '../types';
import { isValidDate } from '../util/date';

const LABELS: Record<DatePrecision, string> = { unknown: '未知', exact: '准确日期', year: '年份', approx: '约略年份', decade: '年代' };

export function DateField(props: { value: PhotoDate; onCommit: (d: PhotoDate) => void }) {
  const [prec, setPrec] = useState<DatePrecision>(props.value.precision);
  const [val, setVal] = useState(props.value.value ?? '');
  useEffect(() => { setPrec(props.value.precision); setVal(props.value.value ?? ''); }, [props.value.precision, props.value.value]);
  const [err, setErr] = useState('');
  const commit = (p: DatePrecision, v: string) => {
    let d: PhotoDate = p === 'unknown' ? { precision: 'unknown' } : { precision: p, value: v.trim() };
    if (p === 'decade' && /^\d{3,4}$/.test(v.trim())) {
      const y = parseInt(v.trim().padEnd(4, '0'), 10);
      d = { precision: 'decade', value: String(Math.floor(y / 10) * 10) };
    }
    if (p !== 'unknown' && !d.value) { setErr(''); return; }
    if (!isValidDate(d)) { setErr(p === 'exact' ? '请选择有效日期' : '请输入四位年份，例如 1986'); return; }
    setErr('');
    props.onCommit(d);
  };
  return (
    <div class="stack tight">
      <div class="row">
        <select aria-label="日期精度" value={prec} onChange={(e) => {
          const p = (e.target as HTMLSelectElement).value as DatePrecision;
          setPrec(p);
          let v = val;
          if (p !== 'exact' && /^\d{4}/.test(v)) v = v.slice(0, 4);
          if (p === 'decade' && /^\d{4}$/.test(v)) v = String(Math.floor(+v / 10) * 10);
          setVal(v);
          commit(p, v);
        }}>
          {(Object.keys(LABELS) as DatePrecision[]).map((k) => <option value={k}>{LABELS[k]}</option>)}
        </select>
        {prec === 'exact' && <input type="date" aria-label="日期" value={val} onChange={(e) => { const v = (e.target as HTMLInputElement).value; setVal(v); commit(prec, v); }} />}
        {(prec === 'year' || prec === 'approx' || prec === 'decade') && (
          <input class="grow" inputMode="numeric" aria-label={prec === 'decade' ? '年代' : '年份'} placeholder={prec === 'decade' ? '例如 1980' : '例如 1986'}
            value={val} onInput={(e) => setVal((e.target as HTMLInputElement).value)} onBlur={() => commit(prec, val)}
            onKeyDown={(e) => e.key === 'Enter' && commit(prec, val)} />
        )}
      </div>
      {err && <p class="error">{err}</p>}
    </div>
  );
}
