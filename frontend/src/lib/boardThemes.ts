// 棋盘主题：拟真棋盘配色方案（经典木纹 / 红木 / 墨绿绒布 / 玉石米白 / 古风深色）
export interface BoardTheme {
  id: string;
  name: string;
  desc: string;
  bg: string;        // 外框底色
  bgStroke: string;  // 外框描边
  surface: [string, string, string]; // 木面渐变（左→中→右）
  line: string;      // 网格线 / 河界 / 年轮
  noiseRgb: [number, number, number]; // 木纹噪声 RGB（0-1）
  stripeFreq: [number, number]; // 纤维条纹噪声频率（x 低频、y 高频 → 横向拉丝木纹）
  stripeAlpha: number; // 纤维条纹透明度
  grainFreq: [number, number]; // 细颗粒噪声频率（木质毛孔细节）
  grainAlpha: number; // 细颗粒透明度
  ringOpacity: number; // 年轮线透明度
}

export const BOARD_THEMES: BoardTheme[] = [
  {
    id: 'classic',
    name: '经典木纹',
    desc: '暖木色 · 天天象棋风',
    bg: '#2f2417',
    bgStroke: '#57442c',
    surface: ['#f7e3bd', '#eecf9c', '#dfb47e'],
    line: '#8b5a2b',
    noiseRgb: [0.42, 0.26, 0.11],
    stripeFreq: [0.003, 0.12],
    stripeAlpha: 0.5,
    grainFreq: [0.06, 0.06],
    grainAlpha: 0.18,
    ringOpacity: 0.1,
  },
  {
    id: 'rosewood',
    name: '红木',
    desc: '深红棕 · 红木家具质感',
    bg: '#1f1210',
    bgStroke: '#4a2a18',
    surface: ['#e8c9a0', '#d9a873', '#c68a4e'],
    line: '#6b3418',
    noiseRgb: [0.45, 0.22, 0.08],
    stripeFreq: [0.003, 0.12],
    stripeAlpha: 0.55,
    grainFreq: [0.06, 0.06],
    grainAlpha: 0.2,
    ringOpacity: 0.12,
  },
  {
    id: 'green',
    name: '墨绿绒布',
    desc: '翡翠丝绒 · 绒面织理',
    bg: '#131f17',
    bgStroke: '#33503c',
    surface: ['#8fa88c', '#68876e', '#47614e'],
    line: '#dcc893',
    noiseRgb: [0.06, 0.14, 0.07],
    stripeFreq: [0.02, 0.06],
    stripeAlpha: 0.05,
    grainFreq: [0.09, 0.09],
    grainAlpha: 0.18,
    ringOpacity: 0,
  },
  {
    id: 'jade',
    name: '玉石米白',
    desc: '米白 · 汉白玉质感',
    bg: '#2b2620',
    bgStroke: '#5a4f3a',
    surface: ['#faf5e8', '#f1ead6', '#e3d8bd'],
    line: '#8a7a58',
    noiseRgb: [0.5, 0.45, 0.32],
    stripeFreq: [0.01, 0.06],
    stripeAlpha: 0.16,
    grainFreq: [0.07, 0.07],
    grainAlpha: 0.12,
    ringOpacity: 0.05,
  },
  {
    id: 'dark',
    name: '古风深色',
    desc: '玄墨鎏金 · 砚台墨色映金',
    bg: '#0b0908',
    bgStroke: '#463722',
    surface: ['#49413b', '#352e2a', '#231f1c'],
    line: '#dcc084',
    noiseRgb: [0.4, 0.34, 0.28],
    stripeFreq: [0.004, 0.09],
    stripeAlpha: 0.1,
    grainFreq: [0.08, 0.08],
    grainAlpha: 0.09,
    ringOpacity: 0.04,
  },
];
