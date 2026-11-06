import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Group, Plane, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useHolo } from './holo-store';
import { useGestures } from '../gestures/gesture-settings';
import { snapValue } from './holo-ops';
import type { HoloObject, HoloScene as SceneSettings, Vec3 } from './holo-types';
import { FOOTPRINT, HoloVisual, fpsMeter } from './HoloObjects';

const DEG = Math.PI / 180;

/** Shared with items so a drag can switch camera orbiting off. */
const controlsRef: { current: OrbitControls | null } = { current: null };

function Controls() {
  const { camera, gl, size } = useThree();
  // Portrait phones see far less width; pull the camera back so the stage
  // (±1.2 wide, ±2.4 tall) fits. Set once so user zoom isn't overridden.
  const framed = useRef(false);
  useEffect(() => {
    if (framed.current || !size.width) return;
    framed.current = true;
    const aspect = size.width / size.height;
    camera.position.set(0, 0.4, aspect < 1 ? Math.min(11, 6.2 / Math.pow(aspect, 0.55)) : 6.2);
  }, [camera, size]);
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    c.minDistance = 2.5;
    c.maxDistance = 14;
    c.rotateSpeed = 0.7;
    c.target.set(0, 0, 0);
    controlsRef.current = c;
    return () => {
      c.dispose();
      controlsRef.current = null;
    };
  }, [camera, gl]);
  // In full-screen presentation a pinch in closes it (touch gestures), so
  // it must not also zoom the camera.
  const mode = useHolo((s) => s.mode);
  const gestures = useGestures((s) => s.enabled);
  useEffect(() => {
    if (controlsRef.current) controlsRef.current.enableZoom = !(mode === 'fullscreen' && gestures);
  }, [mode, gestures, camera, gl]);
  useFrame(() => controlsRef.current?.update());
  return null;
}

function FpsMeter() {
  const frames = useRef(0);
  const since = useRef(performance.now());
  useFrame(() => {
    frames.current++;
    const now = performance.now();
    if (now - since.current >= 1000) {
      fpsMeter.fps = (frames.current * 1000) / (now - since.current);
      frames.current = 0;
      since.current = now;
    }
  });
  return null;
}

function Background({ scene }: { scene: SceneSettings }) {
  const grid = useMemo(() => {
    const segs: number[] = [];
    const size = 12;
    const step = 0.5;
    for (let v = -size; v <= size + 1e-6; v += step) {
      segs.push(-size, 0, v, size, 0, v, v, 0, -size, v, 0, size);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(segs), 3));
    return g;
  }, []);
  const stars = useMemo(() => {
    const n = 900;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const r = 18 + Math.random() * 8;
      const s = Math.sqrt(1 - u * u);
      a.set([Math.cos(t) * s * r, u * r, Math.sin(t) * s * r], i * 3);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(a, 3));
    return g;
  }, []);
  useEffect(() => () => {
    grid.dispose();
    stars.dispose();
  }, [grid, stars]);
  if (scene.background === 'void') return null;
  if (scene.background === 'stars') {
    return (
      <points geometry={stars}>
        <pointsMaterial size={0.06} color="#9fdcff" transparent opacity={0.8 * scene.lighting} depthWrite={false} sizeAttenuation />
      </points>
    );
  }
  return (
    <lineSegments geometry={grid} position={[0, -1.9, 0]}>
      <lineBasicMaterial color="#0a6fd0" transparent opacity={0.22 * scene.lighting} blending={AdditiveBlending} depthWrite={false} />
    </lineSegments>
  );
}

/** Corner brackets around the selected object. */
function SelectionBracket({ w, h }: { w: number; h: number }) {
  const geo = useMemo(() => {
    const x = w / 2 + 0.06;
    const y = h / 2 + 0.06;
    const c = Math.min(w, h) * 0.18;
    const s = [
      -x, y - c, 0, -x, y, 0, -x, y, 0, -x + c, y, 0,
      x - c, y, 0, x, y, 0, x, y, 0, x, y - c, 0,
      x, -y + c, 0, x, -y, 0, x, -y, 0, x - c, -y, 0,
      -x + c, -y, 0, -x, -y, 0, -x, -y, 0, -x, -y + c, 0,
    ];
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(s), 3));
    return g;
  }, [w, h]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <lineSegments geometry={geo} renderOrder={10}>
      <lineBasicMaterial color="#ffffff" transparent opacity={0.95} depthTest={false} />
    </lineSegments>
  );
}

function HoloItem({ obj, light, selected, editing, objectCount }: { obj: HoloObject; light: number; selected: boolean; editing: boolean; objectCount: number }) {
  const spin = useRef<Group>(null);
  const camera = useThree((s) => s.camera);
  const drag = useRef<{ plane: Plane; offset: Vector3; moved: boolean; pointerId: number; startX: number; startY: number } | null>(null);

  useFrame((_, dt) => {
    if (spin.current && obj.rotSpeed) spin.current.rotation.y += obj.rotSpeed * DEG * dt;
  });

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (!editing) return;
    e.stopPropagation();
    useHolo.getState().select(obj.id);
    const normal = new Vector3();
    camera.getWorldDirection(normal);
    const origin = new Vector3(...obj.position);
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal, origin);
    const hit = new Vector3();
    if (!e.ray.intersectPlane(plane, hit)) return;
    drag.current = { plane, offset: hit.sub(origin), moved: false, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY };
    if (controlsRef.current) controlsRef.current.enabled = false;
    // R3F pointer capture: keep receiving moves after the finger leaves the object.
    (e.target as unknown as Element).setPointerCapture?.(e.pointerId);
  };

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    e.stopPropagation();
    // A few pixels of jitter is still a tap, not a move.
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 6) return;
    d.moved = true;
    const hit = new Vector3();
    if (!e.ray.intersectPlane(d.plane, hit)) return;
    hit.sub(d.offset);
    const { snap } = useHolo.getState();
    const p: Vec3 = snap ? [snapValue(hit.x), snapValue(hit.y), snapValue(hit.z)] : [hit.x, hit.y, hit.z];
    useHolo.getState().applyTransient({ op: 'update', id: obj.id, props: { position: p } });
  };

  const end = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    drag.current = null;
    if (controlsRef.current) controlsRef.current.enabled = true;
    (e.target as unknown as Element).releasePointerCapture?.(e.pointerId);
    if (d.moved) useHolo.getState().commitGesture();
  };

  const [w, h] = FOOTPRINT[obj.type];
  const round = obj.type === 'sphere' || obj.type === 'orb' || obj.type === 'rotating' || obj.type === 'memory';
  return (
    <group position={obj.position} rotation={[obj.rotation[0] * DEG, obj.rotation[1] * DEG, obj.rotation[2] * DEG]} scale={obj.scale}>
      <group ref={spin}>
        <HoloVisual obj={obj} light={light} objectCount={objectCount} />
      </group>
      {/* Invisible hit area: points and lines are hard to tap precisely. */}
      <mesh onPointerDown={onDown} onPointerMove={onMove} onPointerUp={end} onPointerCancel={end} visible={editing}>
        {round ? <sphereGeometry args={[Math.max(w, h) * 0.45, 16, 12]} /> : <planeGeometry args={[w, h]} />}
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {selected && editing && <SelectionBracket w={w} h={h} />}
    </group>
  );
}

function Items() {
  const layout = useHolo((s) => s.layout);
  const selectedId = useHolo((s) => s.selectedId);
  const mode = useHolo((s) => s.mode);
  return (
    <>
      <Background scene={layout.scene} />
      {layout.objects.map((o) => (
        <HoloItem key={o.id} obj={o} light={layout.scene.lighting} selected={o.id === selectedId} editing={mode === 'edit'} objectCount={layout.objects.length} />
      ))}
    </>
  );
}

/** Pause rendering while the page is hidden (battery). */
function VisibilityPause() {
  const setFrameloop = useThree((s) => s.setFrameloop);
  useEffect(() => {
    const on = () => setFrameloop(document.hidden ? 'never' : 'always');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [setFrameloop]);
  return null;
}

export function HoloScene({ onReady }: { onReady?: () => void }) {
  return (
    <Canvas
      className="holo-canvas"
      // Capped at 2x: on a 3x iPhone that is ~1.6 megapixels, sharp enough for
      // glowing lines and far cheaper to fill. MSAA is skipped at high DPR,
      // where it is barely visible but costs GPU time every frame.
      dpr={[1, 2]}
      camera={{ position: [0, 0.4, 6.2], fov: 45, near: 0.1, far: 80 }}
      gl={{ antialias: window.devicePixelRatio < 2, alpha: true, powerPreference: 'default' }}
      onCreated={() => onReady?.()}
      onPointerMissed={(e) => {
        // Tap on empty space deselects (ignore the end of a camera drag).
        if (e.type === 'click') useHolo.getState().select(null);
      }}
    >
      <Controls />
      <FpsMeter />
      <VisibilityPause />
      <Items />
    </Canvas>
  );
}
