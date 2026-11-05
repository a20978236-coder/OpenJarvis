import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  Activity,
  AlignCenter,
  AudioLines,
  Camera,
  Check,
  ChevronLeft,
  Clock,
  CloudSun,
  Copy,
  Eye,
  FilePlus2,
  FolderOpen,
  Gauge,
  Globe,
  LineChart,
  Magnet,
  Map as MapIcon,
  Maximize2,
  Monitor,
  Network,
  Orbit,
  Pencil,
  Plus,
  Redo2,
  Save,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  Type,
  Undo2,
  Wand2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { useHolo } from './holo-store';
import { starterLayout, type AlignMode } from './holo-ops';
import { CATALOG, HOLO_TYPES, LIMITS, SWATCHES, VARIANTS, type HoloObject, type HoloType, type PanelShape } from './holo-types';
import { deleteHologram, listHolograms, loadHologram, type HologramSummary } from './holo-api';
import { saveCurrentHologram } from './holo-runner';
import { CommandSheet } from './CommandSheet';
import './hologram.css';

// The 3D scene (three.js + React Three Fiber) loads on demand.
const HoloScene = lazy(() => import('./HoloScene').then((m) => ({ default: m.HoloScene })));

export const TYPE_ICONS: Record<HoloType, LucideIcon> = {
  screen: Monitor,
  sphere: Orbit,
  orb: Sparkles,
  panel: SlidersHorizontal,
  camera: Camera,
  weather: CloudSun,
  clock: Clock,
  graph: LineChart,
  diagnostics: Activity,
  map: MapIcon,
  text: Type,
  waveform: AudioLines,
  rotating: Globe,
  memory: Network,
  widget: Gauge,
};

// ---------------------------------------------------------------------------
// Sheet scaffold
// ---------------------------------------------------------------------------

function Sheet({ title, onClose, children, tall }: { title: string; onClose: () => void; children: React.ReactNode; tall?: boolean }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="holo-sheet" role="dialog" aria-modal="false" aria-label={title} data-tall={tall || undefined}>
      <div className="holo-sheet-head">
        <h2>{title}</h2>
        <button ref={closeRef} type="button" className="jm-icon-btn" onClick={onClose} aria-label={`Close ${title}`}>
          <X size={18} />
        </button>
      </div>
      <div className="holo-sheet-body">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inspector controls (live while dragging; one undo step per gesture)
// ---------------------------------------------------------------------------

function useObjectEditor(id: string) {
  const { applyTransient, commitGesture } = useHolo.getState();
  return {
    live: (props: Partial<HoloObject>) => applyTransient({ op: 'update', id, props }),
    commit: () => commitGesture(),
    set: (props: Partial<HoloObject>) => {
      const err = useHolo.getState().apply({ op: 'update', id, props });
      if (err) toast.error(err);
    },
  };
}

function Range({ label, value, min, max, step, onLive, onCommit, format }: {
  label: string; value: number; min: number; max: number; step: number;
  onLive: (v: number) => void; onCommit: () => void; format?: (v: number) => string;
}) {
  const id = useMemo(() => `r-${label.replace(/\W+/g, '-').toLowerCase()}-${Math.random().toString(36).slice(2, 7)}`, [label]);
  return (
    <div className="holo-range">
      <div className="holo-range-head">
        <label htmlFor={id}>{label}</label>
        <span>{format ? format(value) : value.toFixed(2)}</span>
      </div>
      <input
        id={id}
        type="range"
        className="hell-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onLive(Number(e.target.value))}
        onPointerUp={onCommit}
        onTouchEnd={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
      />
    </div>
  );
}

function Inspector({ obj, onClose }: { obj: HoloObject; onClose: () => void }) {
  const ed = useObjectEditor(obj.id);
  const entry = CATALOG[obj.type];
  const pos = (i: 0 | 1 | 2) => (v: number) => {
    const p = [...obj.position] as HoloObject['position'];
    p[i] = v;
    ed.live({ position: p });
  };
  const rot = (i: 0 | 1 | 2) => (v: number) => {
    const r = [...obj.rotation] as HoloObject['rotation'];
    r[i] = v;
    ed.live({ rotation: r });
  };
  const deg = (v: number) => `${Math.round(v)}°`;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const num = (v: number) => v.toFixed(2);
  return (
    <Sheet title={`Edit ${obj.name}`} onClose={onClose} tall>
      <label className="holo-field">
        <span>Name</span>
        <input className="jm-field" value={obj.name} maxLength={LIMITS.maxName} onChange={(e) => ed.live({ name: e.target.value })} onBlur={ed.commit} />
      </label>
      {entry.uses.text && (
        <label className="holo-field">
          <span>{entry.uses.text}</span>
          <input className="jm-field" value={obj.text} maxLength={LIMITS.maxText} onChange={(e) => ed.live({ text: e.target.value })} onBlur={ed.commit} />
        </label>
      )}
      {entry.uses.value && (
        <label className="holo-field">
          <span>{entry.uses.value}</span>
          <input className="jm-field" value={obj.value} maxLength={LIMITS.maxText} onChange={(e) => ed.live({ value: e.target.value })} onBlur={ed.commit} />
        </label>
      )}
      {entry.uses.variant && VARIANTS[obj.type] && (
        <div className="holo-field">
          <span>Style</span>
          <div role="radiogroup" aria-label="Style" className="holo-choices">
            {VARIANTS[obj.type]!.map((v) => (
              <button key={v} type="button" role="radio" aria-checked={obj.variant === v} className="jm-icon-btn hell-choice" onClick={() => ed.set({ variant: v })}>
                {v}
              </button>
            ))}
          </div>
        </div>
      )}

      <h3 className="jm-label">Position</h3>
      <Range label="Left / right" value={obj.position[0]} min={-LIMITS.position} max={LIMITS.position} step={0.05} onLive={pos(0)} onCommit={ed.commit} format={num} />
      <Range label="Down / up" value={obj.position[1]} min={-LIMITS.position} max={LIMITS.position} step={0.05} onLive={pos(1)} onCommit={ed.commit} format={num} />
      <Range label="Depth (back / front)" value={obj.position[2]} min={-LIMITS.position} max={LIMITS.position} step={0.05} onLive={pos(2)} onCommit={ed.commit} format={num} />
      <Range label="Size" value={obj.scale} min={LIMITS.scale[0]} max={LIMITS.scale[1]} step={0.05} onLive={(v) => ed.live({ scale: v })} onCommit={ed.commit} format={pct} />

      <h3 className="jm-label">Rotation</h3>
      <Range label="Tilt (X)" value={obj.rotation[0]} min={-180} max={180} step={1} onLive={rot(0)} onCommit={ed.commit} format={deg} />
      <Range label="Turn (Y)" value={obj.rotation[1]} min={-180} max={180} step={1} onLive={rot(1)} onCommit={ed.commit} format={deg} />
      <Range label="Roll (Z)" value={obj.rotation[2]} min={-180} max={180} step={1} onLive={rot(2)} onCommit={ed.commit} format={deg} />
      <Range label="Spin speed" value={obj.rotSpeed} min={LIMITS.rotSpeed[0]} max={LIMITS.rotSpeed[1]} step={1} onLive={(v) => ed.live({ rotSpeed: v })} onCommit={ed.commit} format={(v) => `${Math.round(v)}°/s`} />

      <h3 className="jm-label">Look</h3>
      <div className="holo-field">
        <span>Color</span>
        <div className="holo-swatches">
          {SWATCHES.map((c) => (
            <button key={c} type="button" aria-label={`Color ${c}`} aria-pressed={obj.color === c} onClick={() => ed.set({ color: c })} style={{ background: c }} />
          ))}
          <label className="holo-custom-color" aria-label="Custom color">
            <input type="color" value={obj.color} onChange={(e) => ed.live({ color: e.target.value })} onBlur={ed.commit} />
          </label>
        </div>
      </div>
      <Range label="Transparency" value={obj.opacity} min={LIMITS.opacity[0]} max={LIMITS.opacity[1]} step={0.05} onLive={(v) => ed.live({ opacity: v })} onCommit={ed.commit} format={(v) => `${Math.round((1 - v) * 100)}%`} />
      <Range label="Glow" value={obj.glow} min={LIMITS.glow[0]} max={LIMITS.glow[1]} step={0.05} onLive={(v) => ed.live({ glow: v })} onCommit={ed.commit} format={pct} />
      {entry.uses.density && (
        <Range label={obj.type === 'map' || obj.type === 'waveform' ? 'Detail' : 'Particle density'} value={obj.density} min={LIMITS.density[0]} max={LIMITS.density[1]} step={0.05} onLive={(v) => ed.live({ density: v })} onCommit={ed.commit} format={pct} />
      )}
      <Range label="Animation speed" value={obj.animSpeed} min={LIMITS.animSpeed[0]} max={LIMITS.animSpeed[1]} step={0.05} onLive={(v) => ed.live({ animSpeed: v })} onCommit={ed.commit} format={(v) => (v === 0 ? 'Still' : pct(v))} />
      {entry.uses.shape && (
        <>
          <div className="holo-field">
            <span>Panel shape</span>
            <div role="radiogroup" aria-label="Panel shape" className="holo-choices">
              {(['chamfer', 'rect', 'round'] as PanelShape[]).map((s) => (
                <button key={s} type="button" role="radio" aria-checked={obj.shape === s} className="jm-icon-btn hell-choice" onClick={() => ed.set({ shape: s })}>
                  {s === 'chamfer' ? 'Angled' : s === 'rect' ? 'Square' : 'Rounded'}
                </button>
              ))}
            </div>
          </div>
          <label className="holo-toggle">
            <input type="checkbox" className="hell-switch" checked={obj.border} onChange={(e) => ed.set({ border: e.target.checked })} />
            <span>Glowing border</span>
          </label>
        </>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Other sheets
// ---------------------------------------------------------------------------

function AddSheet({ onClose }: { onClose: () => void }) {
  const count = useHolo((s) => s.layout.objects.length);
  return (
    <Sheet title="Add to hologram" onClose={onClose} tall>
      <p className="holo-note">{count}/{LIMITS.maxObjects} objects</p>
      <div className="holo-palette">
        {HOLO_TYPES.map((t) => {
          const Icon = TYPE_ICONS[t];
          return (
            <button
              key={t}
              type="button"
              className="holo-palette-item jm-panel"
              onClick={() => {
                const err = useHolo.getState().apply({ op: 'add', type: t });
                if (err) toast.error(err);
                else onClose();
              }}
            >
              <Icon size={22} aria-hidden="true" />
              <span className="holo-palette-label">{CATALOG[t].label}</span>
              <span className="holo-palette-hint">{CATALOG[t].hint}</span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

const ALIGNS: Array<[AlignMode, string]> = [
  ['center', 'Center'],
  ['center-x', 'Center horizontally'],
  ['center-y', 'Center vertically'],
  ['left', 'Left edge'],
  ['right', 'Right edge'],
  ['top', 'Top edge'],
  ['bottom', 'Bottom edge'],
  ['grid', 'Snap to grid'],
  ['face', 'Face forward'],
];

function AlignSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const snap = useHolo((s) => s.snap);
  return (
    <Sheet title="Align" onClose={onClose}>
      <label className="holo-toggle">
        <input type="checkbox" className="hell-switch" checked={snap} onChange={(e) => useHolo.getState().setSnap(e.target.checked)} />
        <span>Snap to grid while dragging</span>
      </label>
      <div className="holo-grid2">
        {ALIGNS.map(([mode, label]) => (
          <button key={mode} type="button" className="jm-icon-btn" style={{ width: '100%' }} onClick={() => { useHolo.getState().apply({ op: 'align', id, mode }); onClose(); }}>
            {label}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function SceneSheet({ onClose }: { onClose: () => void }) {
  const scene = useHolo((s) => s.layout.scene);
  const { applyTransient, commitGesture, apply } = useHolo.getState();
  return (
    <Sheet title="Scene" onClose={onClose}>
      <div className="holo-field">
        <span>Background</span>
        <div role="radiogroup" aria-label="Background" className="holo-choices">
          {(['grid', 'stars', 'void'] as const).map((b) => (
            <button key={b} type="button" role="radio" aria-checked={scene.background === b} className="jm-icon-btn hell-choice" onClick={() => apply({ op: 'scene', props: { background: b } })}>
              {b === 'grid' ? 'Grid floor' : b === 'stars' ? 'Starfield' : 'None'}
            </button>
          ))}
        </div>
      </div>
      <Range label="Lighting" value={scene.lighting} min={LIMITS.lighting[0]} max={LIMITS.lighting[1]} step={0.05} onLive={(v) => applyTransient({ op: 'scene', props: { lighting: v } })} onCommit={commitGesture} format={(v) => `${Math.round(v * 100)}%`} />
    </Sheet>
  );
}

function LayoutsSheet({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<HologramSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const savedId = useHolo((s) => s.savedId);
  const dirty = useHolo((s) => s.dirty);
  const refresh = () =>
    listHolograms()
      .then((l) => {
        setItems(l);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load'));
  useEffect(() => {
    void refresh();
  }, []);

  const confirmDiscard = () => !dirty || window.confirm('Discard unsaved changes to the current hologram?');

  return (
    <Sheet title="Saved holograms" onClose={onClose} tall>
      <button
        type="button"
        className="jm-primary-btn"
        onClick={() => {
          if (!confirmDiscard()) return;
          useHolo.getState().replace(starterLayout(), null);
          onClose();
        }}
      >
        <FilePlus2 size={18} aria-hidden="true" /> New hologram
      </button>
      {error && <p className="holo-note" style={{ color: 'var(--jm-danger)' }}>{error}</p>}
      {items && items.length === 0 && <p className="holo-note">Nothing saved yet. Use Save to keep a layout on your server.</p>}
      <ul className="holo-list">
        {items?.map((h) => (
          <li key={h.id} className="jm-panel" data-current={h.id === savedId || undefined}>
            <button
              type="button"
              className="holo-list-open"
              onClick={async () => {
                if (!confirmDiscard()) return;
                try {
                  const { id, layout } = await loadHologram(h.id);
                  useHolo.getState().replace(layout, id);
                  toast(`Opened “${layout.name}”`);
                  onClose();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : 'Could not open');
                }
              }}
            >
              <span className="holo-list-name">{h.name}</span>
              <span className="holo-list-meta">{h.objects} object{h.objects === 1 ? '' : 's'} · {new Date(h.updated_at * 1000).toLocaleDateString()}</span>
            </button>
            <button
              type="button"
              className="jm-icon-btn"
              aria-label={`Delete ${h.name}`}
              onClick={async () => {
                if (!window.confirm(`Delete “${h.name}”? This can't be undone.`)) return;
                try {
                  await deleteHologram(h.id);
                  if (h.id === useHolo.getState().savedId) useHolo.setState({ savedId: null, dirty: true });
                  void refresh();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : 'Could not delete');
                }
              }}
            >
              <Trash2 size={17} />
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

function RenameSheet({ onClose }: { onClose: () => void }) {
  const name = useHolo((s) => s.layout.name);
  const [v, setV] = useState(name);
  return (
    <Sheet title="Rename" onClose={onClose}>
      <form
        style={{ display: 'flex', gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          useHolo.getState().apply({ op: 'rename', name: v });
          onClose();
        }}
      >
        <label className="sr-only" htmlFor="holo-rename">Hologram name</label>
        <input id="holo-rename" className="jm-field" value={v} maxLength={LIMITS.maxName} onChange={(e) => setV(e.target.value)} autoFocus />
        <button type="submit" className="jm-primary-btn" aria-label="Save name" style={{ width: 44, padding: 0 }}>
          <Check size={18} />
        </button>
      </form>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type SheetKind = 'add' | 'edit' | 'align' | 'scene' | 'layouts' | 'rename' | 'ask' | null;

export function HologramBuilder() {
  const navigate = useNavigate();
  const layout = useHolo((s) => s.layout);
  const selectedId = useHolo((s) => s.selectedId);
  const canUndo = useHolo((s) => s.past.length > 0);
  const canRedo = useHolo((s) => s.future.length > 0);
  const snap = useHolo((s) => s.snap);
  const mode = useHolo((s) => s.mode);
  const dirty = useHolo((s) => s.dirty);
  const savedId = useHolo((s) => s.savedId);
  // A command spoken on the dashboard ("HELL, build me a planet") arrives here.
  const location = useLocation();
  const incoming = (location.state as { command?: string } | null)?.command;
  const [pendingCommand, setPendingCommand] = useState<string | undefined>(incoming);
  const [sheet, setSheet] = useState<SheetKind>(incoming ? 'ask' : null);
  useEffect(() => {
    if (incoming) navigate(location.pathname, { replace: true, state: null });
  }, [incoming]); // eslint-disable-line react-hooks/exhaustive-deps
  const [saving, setSaving] = useState(false);
  const [exitVisible, setExitVisible] = useState(true);
  const selected = layout.objects.find((o) => o.id === selectedId) ?? null;

  // Close object sheets if the selection goes away (deleted, undone).
  useEffect(() => {
    if (!selected && (sheet === 'edit' || sheet === 'align')) setSheet(null);
  }, [selected, sheet]);

  // Fullscreen hides even the exit button; it reappears for a few seconds on any tap.
  useEffect(() => {
    if (mode !== 'fullscreen') return;
    setExitVisible(false);
    let t: ReturnType<typeof setTimeout>;
    const show = () => {
      setExitVisible(true);
      clearTimeout(t);
      t = setTimeout(() => setExitVisible(false), 3000);
    };
    window.addEventListener('pointerdown', show);
    return () => {
      window.removeEventListener('pointerdown', show);
      clearTimeout(t);
    };
  }, [mode]);

  const save = async () => {
    setSaving(true);
    try {
      const name = await saveCurrentHologram();
      toast.success(`Saved “${name}”`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const run = (fn: () => string | undefined | void) => {
    const err = fn();
    if (typeof err === 'string') toast.error(err);
  };

  const editing = mode === 'edit';

  return (
    <div className="holo" data-mode={mode}>
      <Suspense fallback={<div className="holo-loading">Loading 3D workspace…</div>}>
        <HoloScene />
      </Suspense>

      {!editing && (
        <button
          type="button"
          className="holo-exit jm-icon-btn"
          data-hidden={(mode === 'fullscreen' && !exitVisible) || undefined}
          onClick={() => useHolo.getState().setMode('edit')}
          aria-label="Back to editing"
        >
          <X size={20} />
        </button>
      )}

      {editing && (
        <>
          <header className="holo-top">
            <button type="button" className="jm-icon-btn" onClick={() => navigate('/m')} aria-label="Back to HELL">
              <ChevronLeft size={22} />
            </button>
            <button type="button" className="holo-title" onClick={() => setSheet('rename')} aria-label={`Rename hologram: ${layout.name}`}>
              <span className="holo-title-name">{layout.name}</span>
              <span className="holo-title-meta">{dirty ? 'Unsaved changes' : savedId ? 'Saved' : 'Not saved yet'} · {layout.objects.length} object{layout.objects.length === 1 ? '' : 's'}</span>
            </button>
            <button type="button" className="jm-icon-btn" onClick={() => setSheet('layouts')} aria-label="Saved holograms">
              <FolderOpen size={20} />
            </button>
            <button type="button" className="jm-icon-btn" onClick={() => void save()} disabled={saving} aria-label="Save hologram" data-attention={dirty || undefined}>
              <Save size={20} />
            </button>
            <button type="button" className="jm-icon-btn" onClick={() => useHolo.getState().setMode('preview')} aria-label="Preview">
              <Eye size={20} />
            </button>
            <button type="button" className="jm-icon-btn" onClick={() => useHolo.getState().setMode('fullscreen')} aria-label="Fullscreen">
              <Maximize2 size={18} />
            </button>
          </header>

          {!sheet && layout.objects.length === 0 && (
            <p className="holo-empty">Empty workspace. Tap <b>+</b> to add holographic objects.</p>
          )}
          {!sheet && (
            <p className="holo-help" aria-hidden="true">
              {selected ? `Drag to move · ${snap ? 'snapping to grid' : 'free move'}` : 'Tap an object to select · drag empty space to orbit · pinch to zoom'}
            </p>
          )}

          <nav className="holo-toolbar" aria-label="Hologram tools">
            <button type="button" className="holo-tool holo-tool-add" onClick={() => setSheet(sheet === 'add' ? null : 'add')} aria-label="Add object" aria-expanded={sheet === 'add'}>
              <Plus size={24} />
            </button>
            <button type="button" className="holo-tool holo-tool-ask" onClick={() => setSheet(sheet === 'ask' ? null : 'ask')} aria-label="Ask HELL to build" aria-expanded={sheet === 'ask'}>
              <Wand2 size={20} />
            </button>
            <button type="button" className="holo-tool" onClick={() => useHolo.getState().undo()} disabled={!canUndo} aria-label="Undo">
              <Undo2 size={20} />
            </button>
            <button type="button" className="holo-tool" onClick={() => useHolo.getState().redo()} disabled={!canRedo} aria-label="Redo">
              <Redo2 size={20} />
            </button>
            {!selected && (
              <button type="button" className="holo-tool" onClick={() => useHolo.getState().setSnap(!snap)} aria-pressed={snap} aria-label="Snap to grid">
                <Magnet size={20} />
              </button>
            )}
            {selected ? (
              <>
                <button type="button" className="holo-tool" onClick={() => setSheet('align')} aria-label="Align">
                  <AlignCenter size={20} />
                </button>
                <button type="button" className="holo-tool" onClick={() => run(() => useHolo.getState().apply({ op: 'duplicate', id: selected.id }))} aria-label="Duplicate">
                  <Copy size={20} />
                </button>
                <button type="button" className="holo-tool" onClick={() => run(() => useHolo.getState().apply({ op: 'remove', id: selected.id }))} aria-label="Delete" style={{ color: 'var(--jm-danger)' }}>
                  <Trash2 size={20} />
                </button>
                <button type="button" className="holo-tool" onClick={() => setSheet(sheet === 'edit' ? null : 'edit')} aria-label="Edit selected object" aria-expanded={sheet === 'edit'}>
                  <Pencil size={20} />
                </button>
              </>
            ) : (
              <button type="button" className="holo-tool" onClick={() => setSheet('scene')} aria-label="Scene settings">
                <Sun size={20} />
              </button>
            )}
          </nav>

          {sheet === 'add' && <AddSheet onClose={() => setSheet(null)} />}
          {sheet === 'edit' && selected && <Inspector obj={selected} onClose={() => setSheet(null)} />}
          {sheet === 'align' && selected && <AlignSheet id={selected.id} onClose={() => setSheet(null)} />}
          {sheet === 'scene' && <SceneSheet onClose={() => setSheet(null)} />}
          {sheet === 'layouts' && <LayoutsSheet onClose={() => setSheet(null)} />}
          {sheet === 'rename' && <RenameSheet onClose={() => setSheet(null)} />}
          {sheet === 'ask' && (
            <CommandSheet
              initial={pendingCommand}
              onClose={() => {
                setPendingCommand(undefined);
                setSheet(null);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
