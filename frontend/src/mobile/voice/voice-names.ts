/** Kokoro ids like "bm_george" → "George (British, male)". */
export function prettyServerVoice(id: string): string {
  const m = /^([abjz])([fm])_(\w+)$/.exec(id);
  if (!m) return id;
  const accent = { a: 'American', b: 'British', j: 'Japanese', z: 'Mandarin' }[m[1] as 'a' | 'b' | 'j' | 'z'];
  const name = m[3].charAt(0).toUpperCase() + m[3].slice(1);
  return `${name} (${accent}, ${m[2] === 'f' ? 'female' : 'male'})`;
}
