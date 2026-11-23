import { render } from 'preact';
import { Repo } from './db/repo';
import { App } from './ui/App';
import { offlineStatus } from './ui/store';
import './styles.css';

async function setupOffline() {
  if (!import.meta.env.PROD) { offlineStatus.set('dev'); return; }
  if (!('serviceWorker' in navigator)) { offlineStatus.set('unsupported'); return; }
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'offline-status') offlineStatus.set(e.data.ok ? 'ready' : 'failed');
  });
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    const ask = () => navigator.serviceWorker.controller?.postMessage({ type: 'check-offline' }) ?? reg.active?.postMessage({ type: 'check-offline' });
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) ask();
    navigator.serviceWorker.addEventListener('controllerchange', ask);
    // In case the first check raced the install, re-check shortly.
    setTimeout(ask, 1500);
  } catch {
    offlineStatus.set('failed');
  }
}

async function boot() {
  const root = document.getElementById('app')!;
  try {
    const repo = await Repo.open();
    repo.db.onversionchange = () => repo.db.close();
    root.textContent = '';
    render(<App repo={repo} />, root);
  } catch (e) {
    root.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'fatal';
    p.textContent = `无法打开本地档案：${(e as Error).message}。若在隐私浏览模式下，请改用普通模式。`;
    root.append(p);
  }
  setupOffline();
}

boot();
