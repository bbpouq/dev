import { useEffect } from 'preact/hooks';
import type { Repo } from '../db/repo';
import { RepoCtx, go, toastSignal, useRepo, useRoute, useSignal } from './store';
import { DialogHost } from './dialog';
import { Library } from './Library';
import { PhotoDetail } from './PhotoDetail';
import { ReEdit, Scan } from './Scan';
import { Family, PersonPage } from './Family';
import { Backup } from './Backup';
import { Trash } from './Trash';

function Toast() {
  const t = useSignal(toastSignal);
  return <div class="toast-host" aria-live="polite">{t && <div class={'toast ' + t.kind} key={t.id}>{t.text}</div>}</div>;
}

function Nav({ tab, pending }: { tab: string; pending: number }) {
  const items: [string, string, string][] = [['album', '相册', '▦'], ['scan', '扫描', '◉'], ['family', '家庭树', '⌂']];
  return (
    <nav class="bottom-nav" aria-label="主导航">
      {items.map(([k, label, icon]) => (
        <a href={`#/${k}`} class={tab === k ? 'on' : ''} aria-current={tab === k ? 'page' : undefined}>
          <span class="ico" aria-hidden="true">{icon}</span>{label}
          {k === 'scan' && pending > 0 && <span class="dot">{pending}</span>}
        </a>
      ))}
    </nav>
  );
}

export function App({ repo }: { repo: Repo }) {
  const route = useRoute();
  useEffect(() => { window.scrollTo(0, 0); }, [route.join('/')]);
  const [r0, r1, r2] = route;
  let view;
  let tab = r0;
  switch (r0) {
    case 'album': view = <Library />; break;
    case 'scan': view = <Scan />; break;
    case 'family': view = <Family />; break;
    case 'photo': view = r2 === 'edit' ? <ReEdit photoId={r1} /> : <PhotoDetail id={r1} />; tab = 'album'; break;
    case 'person': view = <PersonPage id={r1} />; tab = 'family'; break;
    case 'backup': view = <Backup />; tab = 'album'; break;
    case 'trash': view = <Trash />; tab = 'album'; break;
    default: go('album');
  }
  return (
    <RepoCtx.Provider value={repo}>
      <main>{view}</main>
      <NavWithRepo tab={tab} />
      <DialogHost />
      <Toast />
    </RepoCtx.Provider>
  );
}

function NavWithRepo({ tab }: { tab: string }) {
  const repo = useRepo();
  return <Nav tab={tab} pending={repo.state.drafts.filter((d) => d.stage === 'pending').length} />;
}
