import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  OctahedronGeometry,
  Shape,
  ShapeGeometry,
  TorusGeometry,
  Vector2,
  WireframeGeometry,
  type Points as ThreePoints,
  type ShaderMaterial as ThreeShaderMaterial,
} from 'three';
import { useMobile } from '../MobileShell';
import { useCamera } from '../vision/camera';
import { getMemoryStats } from '../../lib/api';
import { fetchWeather, useWeatherPrefs, type Weather } from '../../lib/weather-api';
import type { HoloObject, HoloType, PanelShape } from './holo-types';
import { createPanelCanvas, drawPanelBase, drawTitle, FONT, rgba, wrapText, type PanelCanvas } from './panel-texture';

/** Approximate footprint (world units at scale 1): selection brackets and hit areas. */
export const FOOTPRINT: Record<HoloType, [number, number]> = {
  screen: [1.6, 0.9],
  panel: [1.3, 0.9],
  camera: [1.4, 0.9],
  weather: [1.1, 0.6],
  clock: [1.1, 0.55],
  graph: [1.4, 0.8],
  diagnostics: [1.2, 0.8],
  text: [1.4, 0.7],
  widget: [0.9, 0.55],
  sphere: [1.2, 1.2],
  orb: [1.7, 1.7],
  map: [1.8, 1.2],
  waveform: [1.6, 0.6],
  rotating: [1.2, 1.2],
  memory: [1.3, 1.3],
};

/** Live frame rate, measured once per scene and read by diagnostics panels. */
export const fpsMeter = { fps: 0 };

// ---------------------------------------------------------------------------
// Panel geometry
// ---------------------------------------------------------------------------

function panelShape(shape: PanelShape, w: number, h: number): Shape {
  const s = new Shape();
  const x0 = -w / 2;
  const y0 = -h / 2;
  if (shape === 'rect') {
    s.moveTo(x0, y0);
    s.lineTo(x0 + w, y0);
    s.lineTo(x0 + w, y0 + h);
    s.lineTo(x0, y0 + h);
  } else if (shape === 'round') {
    const r = Math.min(w, h) * 0.14;
    s.moveTo(x0 + r, y0);
    s.lineTo(x0 + w - r, y0);
    s.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
    s.lineTo(x0 + w, y0 + h - r);
    s.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
    s.lineTo(x0 + r, y0 + h);
    s.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
    s.lineTo(x0, y0 + r);
    s.quadraticCurveTo(x0, y0, x0 + r, y0);
  } else {
    const c = Math.min(w, h) * 0.16;
    s.moveTo(x0 + c, y0 + h);
    s.lineTo(x0 + w, y0 + h);
    s.lineTo(x0 + w, y0 + c);
    s.lineTo(x0 + w - c, y0);
    s.lineTo(x0, y0);
    s.lineTo(x0, y0 + h - c);
  }
  s.closePath();
  return s;
}

/** ShapeGeometry with UVs remapped to 0..1 across the panel, so the texture fills it. */
function panelGeometry(shape: PanelShape, w: number, h: number): BufferGeometry {
  const g = new ShapeGeometry(panelShape(shape, w, h), 8);
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) + w / 2) / w;
    uv[i * 2 + 1] = (pos.getY(i) + h / 2) / h;
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  return g;
}

function outlineGeometry(shape: PanelShape, w: number, h: number): BufferGeometry {
  const pts = panelShape(shape, w, h).getPoints(8).map((p: Vector2) => [p.x, p.y, 0.002]);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pts.flat()), 3));
  return g;
}

type Draw = (p: PanelCanvas, t: number, obj: HoloObject) => void;

/** A glowing panel whose face is drawn by `draw`, refreshed `fps` times a second (0 = only on change). */
function Panel({ obj, w, h, light, draw, fps, always }: { obj: HoloObject; w: number; h: number; light: number; draw: Draw; fps: number; always?: boolean }) {
  const pc = useMemo(() => createPanelCanvas(w / h), [w, h]);
  const geo = useMemo(() => panelGeometry(obj.shape, w, h), [obj.shape, w, h]);
  const outline = useMemo(() => outlineGeometry(obj.shape, w, h), [obj.shape, w, h]);
  const glowGeo = useMemo(() => panelGeometry(obj.shape, w * 1.08, h * 1.12), [obj.shape, w, h]);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const last = useRef(-1);

  useEffect(() => () => {
    pc.texture.dispose();
  }, [pc]);
  useEffect(() => () => geo.dispose(), [geo]);
  useEffect(() => () => outline.dispose(), [outline]);
  useEffect(() => () => glowGeo.dispose(), [glowGeo]);

  // Redraw immediately whenever the object's look changes.
  useEffect(() => {
    drawRef.current(pc, performance.now() / 1000, obj);
    pc.texture.needsUpdate = true;
  }, [pc, obj]);

  useFrame(({ clock }) => {
    if (fps <= 0 || (obj.animSpeed === 0 && !always)) return;
    const now = clock.elapsedTime;
    if (now - last.current < 1 / fps) return;
    last.current = now;
    drawRef.current(pc, now * obj.animSpeed, obj);
    pc.texture.needsUpdate = true;
  });

  const tint = useMemo(() => new Color(1, 1, 1).multiplyScalar(light), [light]);
  return (
    <group>
      {obj.glow > 0 && (
        <mesh geometry={glowGeo} position={[0, 0, -0.01]}>
          <meshBasicMaterial color={obj.color} transparent opacity={0.08 * obj.glow * obj.opacity} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
      )}
      <mesh geometry={geo}>
        <meshBasicMaterial map={pc.texture} color={tint} transparent opacity={obj.opacity} depthWrite={false} side={DoubleSide} toneMapped={false} />
      </mesh>
      {obj.border && (
        <lineLoop geometry={outline}>
          <lineBasicMaterial color={obj.color} transparent opacity={Math.min(1, 0.55 + 0.3 * obj.glow) * obj.opacity} toneMapped={false} />
        </lineLoop>
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Panel faces
// ---------------------------------------------------------------------------

const drawScreen: Draw = (p, t, o) => {
  const { ctx, W, H } = p;
  drawPanelBase(p, o.color, t);
  drawTitle(p, o.text || 'Holo screen', o.color);
  ctx.font = `500 ${Math.round(H * 0.1)}px ${FONT}`;
  ctx.fillStyle = 'rgba(220,240,255,0.85)';
  wrapText(ctx, o.value, W * 0.86, 3).forEach((l, i) => ctx.fillText(l, W * 0.06, H * (0.4 + i * 0.14)));
  for (let i = 0; i < 18; i++) {
    const v = 0.3 + 0.7 * Math.abs(Math.sin(t * 1.3 + i * 0.7));
    ctx.fillStyle = rgba(o.color, 0.25 + 0.5 * v);
    ctx.fillRect(W * 0.06 + i * W * 0.048, H * 0.9 - H * 0.12 * v, W * 0.03, H * 0.12 * v);
  }
};

const drawControl: Draw = (p, t, o) => {
  const { ctx, W, H } = p;
  drawPanelBase(p, o.color, t);
  drawTitle(p, o.text || 'Control', o.color);
  for (let i = 0; i < 3; i++) {
    const cx = W * (0.2 + i * 0.3);
    const cy = H * 0.62;
    const r = Math.min(W, H) * 0.14;
    ctx.strokeStyle = rgba(o.color, 0.35);
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = rgba(o.color, 0.95);
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (0.35 + 0.3 * Math.sin(t * 0.8 + i * 2)));
    ctx.stroke();
  }
};

const drawCamera: Draw = (p, t, o) => {
  const { ctx, W, H } = p;
  drawPanelBase(p, o.color, t);
  const m = Math.min(W, H) * 0.1;
  ctx.strokeStyle = rgba(o.color, 0.9);
  ctx.lineWidth = 4;
  for (const [x, y, dx, dy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
    ctx.beginPath();
    ctx.moveTo(x, y + dy * m);
    ctx.lineTo(x, y);
    ctx.lineTo(x + dx * m, y);
    ctx.stroke();
  }
  ctx.fillStyle = '#e6f6ff';
  ctx.textAlign = 'center';
  ctx.font = `700 ${Math.round(H * 0.12)}px ${FONT}`;
  ctx.fillText((o.text || 'Camera').toUpperCase() + ' · OFF', W / 2, H * 0.42);
  ctx.font = `500 ${Math.round(H * 0.075)}px ${FONT}`;
  ctx.fillStyle = 'rgba(200,225,250,0.75)';
  ctx.fillText('Turn the camera on in Edit', W / 2, H * 0.6);
  ctx.textAlign = 'left';
};

/** Live feed: the video frame drawn into the panel (cover-fit), plus the corner marks. */
function makeDrawCameraLive(get: () => { video: HTMLVideoElement | null; mirror: boolean }): Draw {
  return (p, t, o) => {
    const { video, mirror } = get();
    if (!video || !video.videoWidth) return drawCamera(p, t, o);
    const { ctx, W, H } = p;
    ctx.clearRect(0, 0, W, H);
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const k = Math.max(W / vw, H / vh);
    const dw = vw * k;
    const dh = vh * k;
    ctx.save();
    if (mirror) {
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
    }
    ctx.globalAlpha = 0.92;
    ctx.drawImage(video, (W - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.restore();
    // Holographic tint + scanlines so it still reads as part of the scene.
    ctx.fillStyle = rgba(o.color, 0.12);
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
    ctx.fillStyle = '#ff4d6a';
    ctx.beginPath();
    ctx.arc(W * 0.06, H * 0.1, H * 0.03, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `700 ${Math.round(H * 0.07)}px ${FONT}`;
    ctx.fillStyle = '#e6f6ff';
    ctx.fillText('LIVE', W * 0.1, H * 0.125);
  };
}

function CameraPanel({ obj, light, w, h }: { obj: HoloObject; light: number; w: number; h: number }) {
  const stream = useCamera((s) => s.stream);
  const facing = useCamera((s) => s.facing);
  const live = useRef<{ video: HTMLVideoElement | null; mirror: boolean }>({ video: null, mirror: false });
  live.current.mirror = facing === 'user';
  useEffect(() => {
    if (!stream) {
      live.current.video = null;
      return;
    }
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.srcObject = stream;
    void v.play().catch(() => undefined);
    live.current.video = v;
    return () => {
      v.pause();
      v.srcObject = null;
      if (live.current.video === v) live.current.video = null;
    };
  }, [stream]);
  const draw = useMemo(() => makeDrawCameraLive(() => live.current), []);
  return <Panel obj={obj} w={w} h={h} light={light} draw={draw} fps={stream ? 15 : 2} always={!!stream} />;
}

function makeDrawWeather(get: () => { w: Weather | null; status: string }): Draw {
  return (p, t, o) => {
    const { ctx, W, H } = p;
    drawPanelBase(p, o.color, t);
    const { w, status } = get();
    ctx.fillStyle = '#e6f6ff';
    if (w) {
      ctx.font = `700 ${Math.round(H * 0.38)}px ${FONT}`;
      ctx.fillText(`${w.temperature}°${w.units.toUpperCase()}`, W * 0.07, H * 0.2);
      ctx.font = `500 ${Math.round(H * 0.13)}px ${FONT}`;
      ctx.fillStyle = 'rgba(210,235,255,0.85)';
      ctx.fillText(`${w.label}${w.place ? ` · ${w.place}` : ''}`.slice(0, 40), W * 0.07, H * 0.68, W * 0.86);
    } else {
      ctx.font = `600 ${Math.round(H * 0.15)}px ${FONT}`;
      ctx.fillText('WEATHER', W * 0.07, H * 0.25);
      ctx.font = `500 ${Math.round(H * 0.11)}px ${FONT}`;
      ctx.fillStyle = 'rgba(210,235,255,0.8)';
      ctx.fillText(status, W * 0.07, H * 0.55, W * 0.86);
    }
  };
}

const drawClock: Draw = (p, t, o) => {
  const { ctx, W, H } = p;
  drawPanelBase(p, o.color, t);
  const now = new Date();
  ctx.fillStyle = '#e6f6ff';
  ctx.shadowColor = o.color;
  ctx.shadowBlur = 16;
  ctx.font = `700 ${Math.round(H * 0.42)}px ${FONT}`;
  ctx.fillText(now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }), W * 0.07, H * 0.17, W * 0.86);
  ctx.shadowBlur = 0;
  ctx.font = `500 ${Math.round(H * 0.13)}px ${FONT}`;
  ctx.fillStyle = 'rgba(210,235,255,0.85)';
  ctx.fillText(now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }), W * 0.07, H * 0.7, W * 0.86);
};

const drawGraph: Draw = (p, t, o) => {
  const { ctx, W, H } = p;
  drawPanelBase(p, o.color, t);
  drawTitle(p, o.text || 'Graph', o.color, 0.09);
  const x0 = W * 0.06;
  const x1 = W * 0.94;
  const y0 = H * 0.9;
  const hh = H * 0.55;
  ctx.strokeStyle = rgba(o.color, 0.25);
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath();
    ctx.moveTo(x0, y0 - (hh * i) / 4);
    ctx.lineTo(x1, y0 - (hh * i) / 4);
    ctx.stroke();
  }
  const n = 24;
  const val = (i: number) => 0.5 + 0.28 * Math.sin(i * 0.55 + t * 1.2) + 0.15 * Math.sin(i * 1.7 - t * 0.7);
  if (o.variant === 'bars') {
    for (let i = 0; i < n; i++) {
      const v = val(i);
      ctx.fillStyle = rgba(o.color, 0.35 + 0.55 * v);
      ctx.fillRect(x0 + ((x1 - x0) * i) / n, y0 - hh * v, ((x1 - x0) / n) * 0.65, hh * v);
    }
  } else {
    ctx.strokeStyle = rgba(o.color, 0.95);
    ctx.lineWidth = 4;
    ctx.shadowColor = o.color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const y = y0 - hh * val(i);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
};

function makeDrawDiagnostics(get: () => { online: boolean | null; latency: number | null; objects: number }): Draw {
  return (p, t, o) => {
    const { ctx, W, H } = p;
    drawPanelBase(p, o.color, t);
    drawTitle(p, 'Diagnostics', o.color, 0.09);
    const d = get();
    const rows: [string, string, boolean][] = [
      ['Frame rate', `${Math.round(fpsMeter.fps)} fps`, fpsMeter.fps >= 40],
      ['Server', d.online === null ? 'checking' : d.online ? (d.latency != null ? `${d.latency} ms` : 'online') : 'offline', d.online === true],
      ['Internet', navigator.onLine ? 'online' : 'offline', navigator.onLine],
      ['Objects', String(d.objects), true],
    ];
    ctx.font = `500 ${Math.round(H * 0.095)}px ${FONT}`;
    rows.forEach(([k, v, ok], i) => {
      const y = H * (0.36 + i * 0.15);
      ctx.fillStyle = ok ? '#3ddc97' : '#ff6b81';
      ctx.beginPath();
      ctx.arc(W * 0.08, y + H * 0.04, H * 0.025, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(210,235,255,0.8)';
      ctx.fillText(k, W * 0.13, y);
      ctx.fillStyle = '#e6f6ff';
      ctx.textAlign = 'right';
      ctx.fillText(v, W * 0.94, y);
      ctx.textAlign = 'left';
    });
  };
}

const drawText: Draw = (p, t, o) => {
  const { ctx, W, H } = p;
  drawPanelBase(p, o.color, t);
  ctx.fillStyle = '#e6f6ff';
  const size = Math.round(H * 0.14);
  ctx.font = `600 ${size}px ${FONT}`;
  ctx.textBaseline = 'top';
  const lines = wrapText(ctx, o.text || ' ', W * 0.86, Math.max(1, Math.floor((H * 0.78) / (size * 1.25))));
  const top = (H - lines.length * size * 1.25) / 2;
  lines.forEach((l, i) => ctx.fillText(l, W * 0.07, top + i * size * 1.25));
};

const drawWidget: Draw = (p, t, o) => {
  const { ctx, W, H } = p;
  drawPanelBase(p, o.color, t);
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(210,235,255,0.85)';
  ctx.font = `600 ${Math.round(H * 0.14)}px ${FONT}`;
  ctx.fillText((o.text || 'Label').toUpperCase(), W * 0.08, H * 0.16, W * 0.84);
  ctx.fillStyle = '#e6f6ff';
  ctx.shadowColor = o.color;
  ctx.shadowBlur = 14;
  ctx.font = `700 ${Math.round(H * 0.36)}px ${FONT}`;
  ctx.fillText(o.value || '—', W * 0.08, H * 0.42, W * 0.84);
  ctx.shadowBlur = 0;
};

// ---------------------------------------------------------------------------
// Particle sphere and the HELL orb
// ---------------------------------------------------------------------------

const POINT_VERT = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uExpand;
  uniform float uSpiral;
  varying float vSeed;
  varying float vDepth;
  void main() {
    vec3 p = position;
    float r = 1.0 + 0.05 * sin(uTime * 1.6 + aSeed * 30.0) + 0.2 * uExpand;
    r *= 1.0 - 0.3 * uSpiral * (0.5 + 0.5 * sin(uTime * 2.5 + aSeed * 9.0));
    p *= r;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vSeed = aSeed;
    vDepth = clamp((p.z + 1.0) * 0.5, 0.0, 1.0);
    // ~uSize CSS px at the default viewing distance (6 units), growing as
    // the camera zooms in. (An earlier 300/z factor drew ~100 px points:
    // massive overdraw that stalled the GPU.)
    gl_PointSize = uSize * uPixelRatio * (0.6 + 0.9 * aSeed) * (0.6 + 0.7 * vDepth) * (6.0 / -mv.z);
  }
`;

const POINT_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uGlow;
  varying float vSeed;
  varying float vDepth;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d2 = dot(c, c);
    if (d2 > 0.25) discard;
    float a = exp(-d2 * 14.0) * mix(0.25, 1.0, vDepth) * uOpacity;
    vec3 col = mix(uColor, vec3(1.0), smoothstep(0.85, 1.0, vSeed) * 0.7) * uGlow;
    gl_FragColor = vec4(col, a);
  }
`;

function fibonacciSphere(count: number): { pos: Float32Array; seed: Float32Array } {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - ((i + 0.5) / count) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = golden * i;
    const s = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const j = 0.9 + 0.1 * Math.abs(s);
    pos.set([Math.cos(th) * r * j, y * j, Math.sin(th) * r * j], i * 3);
    seed[i] = Math.abs(s);
  }
  return { pos, seed };
}

function ParticleSphere({ obj, light, radius, state }: { obj: HoloObject; light: number; radius: number; state?: { expand: number; spiral: number; speed: number } }) {
  const count = Math.round(1800 * obj.density);
  const geo = useMemo(() => {
    const { pos, seed } = fibonacciSphere(count);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new BufferAttribute(seed, 1));
    return g;
  }, [count]);
  useEffect(() => () => geo.dispose(), [geo]);
  const mat = useRef<ThreeShaderMaterial>(null);
  const pts = useRef<ThreePoints>(null);
  const dpr = useThree((st) => st.viewport.dpr);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uSize: { value: 2.6 },
      uPixelRatio: { value: 1 },
      uExpand: { value: 0 },
      uSpiral: { value: 0 },
      uColor: { value: new Color(obj.color) },
      uOpacity: { value: obj.opacity },
      uGlow: { value: obj.glow * light },
    }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    uniforms.uColor.value.set(obj.color);
    uniforms.uOpacity.value = obj.opacity;
    uniforms.uGlow.value = Math.max(0.2, obj.glow) * light;
    uniforms.uPixelRatio.value = dpr;
  }, [obj.color, obj.opacity, obj.glow, light, uniforms, dpr]);

  useFrame((_, dt) => {
    const k = 1 - Math.exp(-dt * 4);
    const speed = state?.speed ?? 1;
    uniforms.uTime.value += dt * obj.animSpeed * speed;
    uniforms.uExpand.value += ((state?.expand ?? 0) - uniforms.uExpand.value) * k;
    uniforms.uSpiral.value += ((state?.spiral ?? 0) - uniforms.uSpiral.value) * k;
    if (pts.current) pts.current.rotation.y += dt * 0.25 * obj.animSpeed * speed;
  });

  return (
    <points ref={pts} geometry={geo} scale={radius}>
      <shaderMaterial ref={mat} uniforms={uniforms} vertexShader={POINT_VERT} fragmentShader={POINT_FRAG} transparent depthWrite={false} blending={AdditiveBlending} />
    </points>
  );
}

function Ring({ radius, color, opacity, tilt }: { radius: number; color: string; opacity: number; tilt: [number, number, number] }) {
  const geo = useMemo(() => {
    const n = 128;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([Math.cos((i / n) * Math.PI * 2) * radius, 0, Math.sin((i / n) * Math.PI * 2) * radius], i * 3);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(a, 3));
    return g;
  }, [radius]);
  useEffect(() => () => geo.dispose(), [geo]);
  const ref = useRef<Group>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.3;
  });
  return (
    <group rotation={tilt}>
      <group ref={ref}>
        <lineLoop geometry={geo}>
          <lineBasicMaterial color={color} transparent opacity={opacity} blending={AdditiveBlending} depthWrite={false} />
        </lineLoop>
      </group>
    </group>
  );
}

function OrbObject({ obj, light }: { obj: HoloObject; light: number }) {
  // Live link to HELL: the orb in your hologram listens, thinks and speaks too.
  const { orbState } = useMobile();
  const state = {
    expand: orbState === 'listening' ? 1 : 0,
    spiral: orbState === 'thinking' ? 1 : 0,
    speed: orbState === 'thinking' ? 2.5 : orbState === 'listening' || orbState === 'speaking' ? 1.5 : orbState === 'offline' ? 0.2 : 1,
  };
  const color = orbState === 'error' ? '#ff4d6d' : obj.color;
  return (
    <group>
      <ParticleSphere obj={{ ...obj, color }} light={light} radius={0.55} state={state} />
      <Ring radius={0.75} color={color} opacity={0.55 * obj.opacity} tilt={[0.4, 0, 0.1]} />
      <Ring radius={0.85} color={color} opacity={0.35 * obj.opacity} tilt={[-0.5, 0, -0.3]} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Other 3D objects
// ---------------------------------------------------------------------------

function MapObject({ obj, light }: { obj: HoloObject; light: number }) {
  const n = Math.round(16 + 16 * obj.density);
  const { geo, heights } = useMemo(() => {
    const w = 1.8;
    const d = 1.2;
    const segs: number[] = [];
    const h = (x: number, z: number) => 0.12 * Math.sin(x * 3.1) * Math.cos(z * 4.2) + 0.06 * Math.sin(x * 7 + z * 5);
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j < n; j++) {
        const x = -w / 2 + (w * i) / n;
        const z0 = -d / 2 + (d * j) / n;
        const z1 = -d / 2 + (d * (j + 1)) / n;
        segs.push(x, h(x, z0), z0, x, h(x, z1), z1);
        const xx0 = -w / 2 + (w * j) / n;
        const xx1 = -w / 2 + (w * (j + 1)) / n;
        const zz = -d / 2 + (d * i) / n;
        segs.push(xx0, h(xx0, zz), zz, xx1, h(xx1, zz), zz);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(segs), 3));
    return { geo: g, heights: h };
  }, [n]);
  useEffect(() => () => geo.dispose(), [geo]);
  const marker = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!marker.current) return;
    const s = 1 + 0.4 * Math.sin(clock.elapsedTime * 3 * Math.max(0.1, obj.animSpeed));
    marker.current.scale.set(s, 1, s);
  });
  return (
    <group rotation={[Math.PI / 2, 0, 0]}>
      <lineSegments geometry={geo}>
        <lineBasicMaterial color={obj.color} transparent opacity={0.55 * obj.opacity * light} blending={AdditiveBlending} depthWrite={false} />
      </lineSegments>
      <group ref={marker} position={[0.25, heights(0.25, -0.1) + 0.02, -0.1]}>
        <Ring radius={0.08} color="#ff4d6d" opacity={0.9} tilt={[0, 0, 0]} />
      </group>
    </group>
  );
}

function WaveformObject({ obj, light }: { obj: HoloObject; light: number }) {
  const { orbState } = useMobile();
  const active = orbState === 'listening' || orbState === 'speaking';
  const n = Math.round(14 + 18 * obj.density);
  const refs = useRef<Array<Group | null>>([]);
  const box = useMemo(() => new BoxGeometry(1, 1, 0.02), []);
  useEffect(() => () => box.dispose(), [box]);
  const amp = useRef(0.2);
  useFrame(({ clock }, dt) => {
    amp.current += ((active ? 1 : 0.18) - amp.current) * (1 - Math.exp(-dt * 5));
    const t = clock.elapsedTime * Math.max(0.1, obj.animSpeed);
    refs.current.forEach((g, i) => {
      if (!g) return;
      const v = 0.15 + amp.current * (0.5 + 0.5 * Math.sin(t * 6 + i * 0.9) * Math.sin(t * 2.3 + i * 0.37));
      g.scale.y = Math.max(0.04, v * 0.55);
    });
  });
  const w = 1.6;
  return (
    <group>
      {Array.from({ length: n }, (_, i) => (
        <group key={i} position={[-w / 2 + (w * (i + 0.5)) / n, 0, 0]} ref={(g) => { refs.current[i] = g; }}>
          <mesh geometry={box} scale={[(w / n) * 0.55, 1, 1]}>
            <meshBasicMaterial color={obj.color} transparent opacity={0.85 * obj.opacity * light} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function RotatingObject({ obj, light }: { obj: HoloObject; light: number }) {
  const { lines, fill } = useMemo(() => {
    switch (obj.variant) {
      case 'cube': {
        const b = new BoxGeometry(0.8, 0.8, 0.8);
        return { lines: new EdgesGeometry(b), fill: b };
      }
      case 'torus': {
        const t = new TorusGeometry(0.42, 0.15, 12, 36);
        return { lines: new WireframeGeometry(t), fill: t };
      }
      case 'crystal': {
        const o = new OctahedronGeometry(0.55, 0);
        o.scale(0.75, 1.15, 0.75);
        return { lines: new EdgesGeometry(o), fill: o };
      }
      case 'city': {
        const merged: number[] = [];
        const heights = [0.5, 0.9, 0.35, 0.7, 1.1, 0.45, 0.8, 0.3, 0.6];
        heights.forEach((hgt, i) => {
          const x = ((i % 3) - 1) * 0.3;
          const z = (Math.floor(i / 3) - 1) * 0.3;
          const e = new EdgesGeometry(new BoxGeometry(0.2, hgt, 0.2).translate(x, hgt / 2 - 0.5, z));
          merged.push(...(e.attributes.position.array as Float32Array));
          e.dispose();
        });
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(new Float32Array(merged), 3));
        return { lines: g, fill: null };
      }
      case 'planet':
      default: {
        const s = new IcosahedronGeometry(0.45, 2);
        return { lines: new WireframeGeometry(s), fill: s };
      }
    }
  }, [obj.variant]);
  useEffect(() => () => {
    lines.dispose();
    fill?.dispose();
  }, [lines, fill]);
  return (
    <group>
      <lineSegments geometry={lines}>
        <lineBasicMaterial color={obj.color} transparent opacity={0.8 * obj.opacity * light} blending={AdditiveBlending} depthWrite={false} />
      </lineSegments>
      {fill && (
        <mesh geometry={fill}>
          <meshBasicMaterial color={obj.color} transparent opacity={0.08 * obj.glow * obj.opacity} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
      )}
      {obj.variant === 'planet' && <Ring radius={0.7} color={obj.color} opacity={0.6 * obj.opacity} tilt={[1.2, 0, 0.3]} />}
    </group>
  );
}

function useMemoryCount(): number | null {
  const { online } = useMobile();
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    if (!online) return;
    getMemoryStats()
      .then((s) => setN(Number.isFinite(s?.entries) ? s.entries : null))
      .catch(() => setN(null));
  }, [online]);
  return n;
}

function MemoryObject({ obj, light }: { obj: HoloObject; light: number }) {
  const count = useMemoryCount();
  const nodes = Math.max(6, Math.min(60, Math.round((count ?? 12) * obj.density)));
  const { pts, lines } = useMemo(() => {
    const { pos } = fibonacciSphere(nodes);
    const p = new BufferGeometry();
    p.setAttribute('position', new BufferAttribute(pos.map((v) => v * 0.55), 3));
    p.setAttribute('aSeed', new BufferAttribute(new Float32Array(nodes).fill(0.95), 1));
    const segs: number[] = [];
    for (let i = 0; i < nodes; i++) {
      segs.push(0, 0, 0, pos[i * 3] * 0.55, pos[i * 3 + 1] * 0.55, pos[i * 3 + 2] * 0.55);
      const j = (i + 3) % nodes;
      segs.push(pos[i * 3] * 0.55, pos[i * 3 + 1] * 0.55, pos[i * 3 + 2] * 0.55, pos[j * 3] * 0.55, pos[j * 3 + 1] * 0.55, pos[j * 3 + 2] * 0.55);
    }
    const l = new BufferGeometry();
    l.setAttribute('position', new BufferAttribute(new Float32Array(segs), 3));
    return { pts: p, lines: l };
  }, [nodes]);
  useEffect(() => () => {
    pts.dispose();
    lines.dispose();
  }, [pts, lines]);
  const dpr = useThree((st) => st.viewport.dpr);
  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uSize: { value: 7 }, uPixelRatio: { value: 1 }, uExpand: { value: 0 }, uSpiral: { value: 0 }, uColor: { value: new Color(obj.color) }, uOpacity: { value: obj.opacity }, uGlow: { value: light } }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    uniforms.uColor.value.set(obj.color);
    uniforms.uOpacity.value = obj.opacity;
    uniforms.uGlow.value = light * Math.max(0.3, obj.glow);
    uniforms.uPixelRatio.value = dpr;
  }, [obj.color, obj.opacity, obj.glow, light, uniforms, dpr]);
  useFrame((_, dt) => {
    uniforms.uTime.value += dt * obj.animSpeed;
  });
  return (
    <group>
      <lineSegments geometry={lines}>
        <lineBasicMaterial color={obj.color} transparent opacity={0.35 * obj.opacity * light} blending={AdditiveBlending} depthWrite={false} />
      </lineSegments>
      <points geometry={pts}>
        <shaderMaterial uniforms={uniforms} vertexShader={POINT_VERT} fragmentShader={POINT_FRAG} transparent depthWrite={false} blending={AdditiveBlending} />
      </points>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

function WeatherPanel({ obj, light, w, h }: { obj: HoloObject; light: number; w: number; h: number }) {
  const { source, units } = useWeatherPrefs();
  const { online } = useMobile();
  const data = useRef<{ w: Weather | null; status: string }>({ w: null, status: 'Set up weather on the dashboard' });
  const [, bump] = useState(0);
  useEffect(() => {
    if (source.kind === 'off') {
      data.current = { w: null, status: 'Set up weather on the dashboard' };
      bump((n) => n + 1);
      return;
    }
    if (online === false) return;
    let live = true;
    data.current = { w: null, status: 'Loading…' };
    fetchWeather(source, units)
      .then((w) => live && (data.current = { w, status: '' }))
      .catch(() => live && (data.current = { w: null, status: 'Weather unavailable' }))
      .finally(() => live && bump((n) => n + 1));
    return () => {
      live = false;
    };
  }, [source, units, online]);
  const draw = useMemo(() => makeDrawWeather(() => data.current), []);
  return <Panel obj={obj} w={w} h={h} light={light} draw={draw} fps={0.2} />;
}

function DiagnosticsPanel({ obj, light, w, h, objects }: { obj: HoloObject; light: number; w: number; h: number; objects: number }) {
  const { online, serverLatencyMs } = useMobile();
  const live = useRef({ online, latency: serverLatencyMs, objects });
  live.current = { online, latency: serverLatencyMs, objects };
  const draw = useMemo(() => makeDrawDiagnostics(() => live.current), []);
  return <Panel obj={obj} w={w} h={h} light={light} draw={draw} fps={2} />;
}

/** Renders one object's visual (no transform, no selection). */
export function HoloVisual({ obj, light, objectCount }: { obj: HoloObject; light: number; objectCount: number }) {
  const [w, h] = FOOTPRINT[obj.type];
  switch (obj.type) {
    case 'screen':
      return <Panel obj={obj} w={w} h={h} light={light} draw={drawScreen} fps={4} />;
    case 'panel':
      return <Panel obj={obj} w={w} h={h} light={light} draw={drawControl} fps={4} />;
    case 'camera':
      return <CameraPanel obj={obj} light={light} w={w} h={h} />;
    case 'weather':
      return <WeatherPanel obj={obj} light={light} w={w} h={h} />;
    case 'clock':
      return <Panel obj={obj} w={w} h={h} light={light} draw={drawClock} fps={1} />;
    case 'graph':
      return <Panel obj={obj} w={w} h={h} light={light} draw={drawGraph} fps={8} />;
    case 'diagnostics':
      return <DiagnosticsPanel obj={obj} light={light} w={w} h={h} objects={objectCount} />;
    case 'text':
      return <Panel obj={obj} w={w} h={h} light={light} draw={drawText} fps={0} />;
    case 'widget':
      return <Panel obj={obj} w={w} h={h} light={light} draw={drawWidget} fps={0} />;
    case 'sphere':
      return <ParticleSphere obj={obj} light={light} radius={0.55} />;
    case 'orb':
      return <OrbObject obj={obj} light={light} />;
    case 'map':
      return <MapObject obj={obj} light={light} />;
    case 'waveform':
      return <WaveformObject obj={obj} light={light} />;
    case 'rotating':
      return <RotatingObject obj={obj} light={light} />;
    case 'memory':
      return <MemoryObject obj={obj} light={light} />;
    default:
      return null;
  }
}
