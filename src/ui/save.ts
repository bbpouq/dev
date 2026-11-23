export type SaveResult = 'saved' | 'shared' | 'downloaded' | 'cancelled';

const isTouch = () => matchMedia('(pointer: coarse)').matches;

/**
 * Hands a generated file to the user.
 * 'saved' = written via a file picker (confirmed on disk);
 * 'shared' / 'downloaded' = handed over, the user must confirm it landed.
 */
export async function saveFile(blob: Blob, name: string, type: string): Promise<SaveResult> {
  const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> };
  if (w.showSaveFilePicker && !isTouch()) {
    try {
      const ext = name.slice(name.lastIndexOf('.'));
      const h = await w.showSaveFilePicker({ suggestedName: name, types: [{ description: name, accept: { [type]: [ext] } }] });
      const ws = await h.createWritable();
      await ws.write(blob);
      await ws.close();
      return 'saved';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
      // fall through to download
    }
  }
  const file = new File([blob], name, { type });
  if (isTouch() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'downloaded';
}
