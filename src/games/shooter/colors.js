// Existing ink IDs stay fixed so cached geometry and effects keep their colours.
export const INK = {
  BLUE: 0,
  RED: 1,
  BLACK: 2,
  ORANGE: 3,
  GREEN: 4,
  PINK: 5,
  PURPLE: 6,
  TEAL: 7,
  BROWN: 8,
  CYAN: 9,
  GOLD: 10,
};
export const INK_PALETTE = [
  { name: '宝蓝', rgb: [0.1, 0.19, 0.76] },
  { name: '朱红', rgb: [0.86, 0.12, 0.2] },
  { name: '石墨', rgb: [0.18, 0.2, 0.26] },
  { name: '橙色', rgb: [0.92, 0.55, 0.08] },
  { name: '翠绿', rgb: [0.12, 0.6, 0.3] },
  { name: '玫粉', rgb: [0.9, 0.4, 0.66] },
  { name: '紫罗兰', rgb: [0.5, 0.19, 0.72] },
  { name: '深青', rgb: [0.04, 0.43, 0.43] },
  { name: '栗棕', rgb: [0.48, 0.27, 0.14] },
  { name: '天蓝', rgb: [0.05, 0.56, 0.8] },
  { name: '赭金', rgb: [0.61, 0.52, 0.06] },
];
export const CHARACTER_INKS = [
  INK.BLUE,
  INK.RED,
  INK.GREEN,
  INK.ORANGE,
  INK.PURPLE,
  INK.TEAL,
  INK.PINK,
  INK.BROWN,
  INK.CYAN,
  INK.GOLD,
];
export const validCharacterInk = (ink) => CHARACTER_INKS.includes(ink);
export function allocateInk(players) {
  const used = new Set([...players].map((p) => p.ink));
  return CHARACTER_INKS.find((ink) => !used.has(ink)) ?? INK.BLUE;
}
export function enemyInk(id) {
  const text = String(id),
    match = text.match(/^(.*:)(\d+)$/);
  let hash = 2166136261;
  for (const c of match ? match[1] : text) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
  const index = match ? hash + Number(match[2]) : typeof id === 'number' ? id : hash;
  return CHARACTER_INKS[index % CHARACTER_INKS.length];
}
export const inkName = (ink) => INK_PALETTE[ink ?? INK.BLUE]?.name ?? '宝蓝';
export const inkCSS = (ink) =>
  `rgb(${(INK_PALETTE[ink ?? INK.BLUE] ?? INK_PALETTE[0]).rgb.map((v) => Math.round(v * 255)).join(',')})`;
