import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Brain, ChevronLeft, Download, FileText, FolderOpen, Image as ImageIcon, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { addFileToMemory, deleteFile, fileObjectUrl, formatBytes, listFiles, removeFileFromMemory, uploadFile, type HellFile } from '../../lib/files-api';
import { useMobile } from '../MobileShell';
import '../gestures/gestures.css';
import './apps.css';

const errMsg = (e: unknown, f: string) => (e instanceof Error ? e.message : f);

/**
 * Files on your HELL server: send files from this iPhone, open or save them,
 * and add readable ones (text, Markdown, CSV, JSON, PDF, Word) to HELL's
 * memory so its replies can use them.
 */
export function FilesScreen() {
  const navigate = useNavigate();
  const { online } = useMobile();
  const [files, setFiles] = useState<HellFile[] | null>(null);
  const [total, setTotal] = useState(0);
  const [max, setMax] = useState(25 * 1024 * 1024);
  const [busy, setBusy] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const b = await listFiles();
      setFiles(b.files);
      setTotal(b.total_bytes);
      setMax(b.max_file_bytes);
    } catch (e) {
      toast.error(errMsg(e, 'Could not load files'));
      setFiles([]);
    }
  }, []);
  useEffect(() => {
    if (online !== false) void load();
  }, [online, load]);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview.url);
  }, [preview]);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  const onPick = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy('upload');
    let ok = 0;
    for (const f of Array.from(list)) {
      if (f.size > max) {
        toast.error(`${f.name} is larger than ${formatBytes(max)}`);
        continue;
      }
      try {
        await uploadFile(f);
        ok++;
      } catch (e) {
        toast.error(errMsg(e, `Could not upload ${f.name}`));
      }
    }
    if (ok) toast.success(ok === 1 ? 'File sent to HELL' : `${ok} files sent to HELL`);
    if (input.current) input.current.value = '';
    setBusy(null);
    await load();
  };

  const open = async (f: HellFile) => {
    setBusy(f.id);
    try {
      const url = await fileObjectUrl(f.id);
      if (f.type.startsWith('image/')) {
        setPreview({ url, name: f.name });
      } else {
        // Saves (or previews, on iPhone) the file.
        const a = document.createElement('a');
        a.href = url;
        a.download = f.name;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (e) {
      toast.error(errMsg(e, 'Could not open the file'));
    } finally {
      setBusy(null);
    }
  };

  const toggleMemory = async (f: HellFile) => {
    setBusy(f.id);
    try {
      if (f.in_memory) {
        await removeFileFromMemory(f.id);
        toast('Removed from HELL’s memory');
      } else {
        const r = await addFileToMemory(f.id);
        toast.success(`Added to memory${r.secrets_removed ? ` — ${r.secrets_removed} secret(s) left out` : ''}`);
      }
    } catch (e) {
      toast.error(errMsg(e, 'Could not change memory'));
    } finally {
      setBusy(null);
      await load();
    }
  };

  const remove = async (f: HellFile) => {
    if (armed !== f.id) return setArmed(f.id);
    setArmed(null);
    setBusy(f.id);
    try {
      await deleteFile(f.id);
      toast('Deleted');
    } catch (e) {
      toast.error(errMsg(e, 'Could not delete'));
    } finally {
      setBusy(null);
      await load();
    }
  };

  return (
    <div className="jm-scroll ges">
      <button type="button" onClick={() => navigate('/m')} className="jm-icon-btn ges-back">
        <ChevronLeft size={20} aria-hidden="true" /> HELL
      </button>
      <header className="ges-head">
        <FolderOpen size={32} strokeWidth={1.6} aria-hidden="true" />
        <h1>Files</h1>
      </header>
      <p className="ges-lead">Files on your HELL server. Send them from this iPhone, and add documents to HELL’s memory so it can answer questions about them.</p>

      <input ref={input} type="file" multiple className="sr-only" id="files-pick" onChange={(e) => void onPick(e.target.files)} />
      <label htmlFor="files-pick" className="jm-primary-btn files-pick" aria-disabled={busy === 'upload' || online === false}>
        <Upload size={18} aria-hidden="true" /> {busy === 'upload' ? 'Sending…' : 'Send files to HELL'}
      </label>
      <p className="ges-note">Up to {formatBytes(max)} each. Stored on your server only. {files?.length ? `${files.length} file(s), ${formatBytes(total)}.` : ''}</p>

      {files && files.length === 0 && <p className="files-empty">No files yet.</p>}
      <ul className="mem-list">
        {(files ?? []).map((f) => {
          const Icon = f.type.startsWith('image/') ? ImageIcon : FileText;
          return (
            <li key={f.id} className="jm-panel files-row">
              <button type="button" className="files-open" onClick={() => void open(f)} disabled={busy === f.id} aria-label={`Open ${f.name}`}>
                <Icon size={20} aria-hidden="true" />
                <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <span className="files-name">{f.name}</span>
                  <span className="mem-meta">
                    {formatBytes(f.size)} · {new Date(f.created_at * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    {f.in_memory && (
                      <span className="files-tag">
                        <Brain size={12} aria-hidden="true" /> In memory
                      </span>
                    )}
                  </span>
                </span>
                <Download size={16} aria-hidden="true" className="files-dl" />
              </button>
              <div className="files-actions">
                {f.can_add_to_memory && (
                  <button type="button" className="jm-icon-btn files-act" onClick={() => void toggleMemory(f)} disabled={busy === f.id} aria-pressed={f.in_memory}>
                    <Brain size={16} aria-hidden="true" /> {f.in_memory ? 'Remove from memory' : 'Add to memory'}
                  </button>
                )}
                <button
                  type="button"
                  className="jm-icon-btn files-act mem-danger"
                  data-armed={armed === f.id || undefined}
                  onClick={() => void remove(f)}
                  disabled={busy === f.id}
                  aria-label={armed === f.id ? `Tap again to delete ${f.name}` : `Delete ${f.name}`}
                >
                  <Trash2 size={16} aria-hidden="true" /> {armed === f.id ? 'Tap again' : 'Delete'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {preview && (
        <div className="hell-sheet-backdrop files-preview" role="dialog" aria-label={preview.name} onClick={() => setPreview(null)}>
          <img src={preview.url} alt={preview.name} />
          <button type="button" className="jm-primary-btn" onClick={() => setPreview(null)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}
