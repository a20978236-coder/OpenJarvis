import {
  Activity,
  Boxes,
  Brain,
  CheckSquare,
  Crosshair,
  FolderOpen,
  Hand,
  Layers,
  LayoutGrid,
  NotebookPen,
  ScanEye,
  Settings,
  type LucideIcon,
} from 'lucide-react';

/**
 * The twelve dashboard modules. `route` is where a ready module opens;
 * planned modules open an honest "coming in stage X" screen instead of a
 * fake UI. Flip `stage` to null (and set `route`) as each stage lands.
 */
export interface HellModule {
  id: string;
  label: string;
  icon: LucideIcon;
  side: 'left' | 'right';
  /** Where the module lives once built. */
  route: string;
  /** Build stage still pending, or null when the module works today. */
  stage: string | null;
  summary: string;
}

export const MODULES: HellModule[] = [
  { id: 'hologram', label: 'Hologram Builder', icon: Boxes, side: 'left', route: '/m/hologram', stage: null, summary: 'Build your own 3D holographic interfaces.' },
  { id: 'vision', label: 'Vision', icon: ScanEye, side: 'left', route: '/m/module/vision', stage: 'D', summary: 'Point the camera and ask HELL what it sees, read signs and explain controls.' },
  { id: 'gestures', label: 'Gestures', icon: Hand, side: 'left', route: '/m/module/gestures', stage: 'E', summary: 'Swipe, pinch and camera hand gestures to drive HELL without tapping.' },
  { id: 'calibration', label: 'Calibration', icon: Crosshair, side: 'left', route: '/m/module/calibration', stage: 'F', summary: 'Tune gesture sensitivity, handedness and response speed, then test live.' },
  { id: 'memory', label: 'Memory', icon: Brain, side: 'left', route: '/m/memory', stage: null, summary: 'What HELL knows about you.' },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare, side: 'left', route: '/m/tasks', stage: null, summary: 'Your tasks.' },
  { id: 'apps', label: 'Apps', icon: LayoutGrid, side: 'right', route: '/m/module/apps', stage: 'I', summary: "HELL's tools plus buttons that run your iOS Shortcuts." },
  { id: 'files', label: 'Files', icon: FolderOpen, side: 'right', route: '/m/module/files', stage: 'I', summary: 'Files on your server, and sending files from this iPhone to HELL.' },
  { id: 'notes', label: 'Notes', icon: NotebookPen, side: 'right', route: '/m/tasks?view=notes', stage: null, summary: 'Your notes.' },
  { id: 'diagnostics', label: 'Diagnostics', icon: Activity, side: 'right', route: '/m/module/diagnostics', stage: 'I', summary: 'Microphone, camera, connection, AI, voice, memory and performance checks.' },
  { id: 'settings', label: 'Settings', icon: Settings, side: 'right', route: '/m/settings', stage: null, summary: 'Orb, voice and sign-in.' },
  { id: 'ai', label: 'AI Modules', icon: Layers, side: 'right', route: '/m/ai', stage: null, summary: 'Models, agents and skills on your server.' },
];

export const STAGE_NAMES: Record<string, string> = {
  C: 'Stage C — Hologram Builder',
  D: 'Stage D — Camera Vision',
  E: 'Stage E — Touchscreen gestures',
  F: 'Stage F — Gesture calibration',
  G: 'Stage G — Camera hand tracking',
  H: 'Stage H — Voice',
  I: 'Stage I — Memory & diagnostics',
};

export function moduleById(id: string | undefined): HellModule | undefined {
  return MODULES.find((m) => m.id === id);
}
