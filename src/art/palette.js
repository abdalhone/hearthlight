// The game's master palette. Every sprite draws from these ramps so the art reads
// as one world. Ramps run dark -> light. Agents may add ramps here (append only).

export const OUTLINE = '#1a1423'; // near-black with a plum bias, for sprite outlines
export const SHADOW = 'rgba(16, 10, 28, 0.35)'; // ground shadows

export const RAMPS = {
  grass: ['#1f3d2b', '#2c5a34', '#3e7a3c', '#5c9b46', '#86bc5a', '#b4d878'],
  leaf: ['#173326', '#22492f', '#2f6338', '#4a8240', '#6fa34c', '#9cc463'],
  pine: ['#142a26', '#1c3b33', '#27503f', '#386a4b', '#4f8658'],
  dirt: ['#3b2a24', '#5a3d2e', '#7a553a', '#9a7049', '#b98d5e', '#d6ad7c'],
  sand: ['#8a6f4a', '#b0915e', '#cdb077', '#e3cc96', '#f2e3b9'],
  stone: ['#262433', '#3a3849', '#545266', '#727085', '#9593a6', '#bdbccb'],
  cobble: ['#2e2b38', '#45414f', '#5f5a69', '#7d7787', '#a09aa8'],
  water: ['#14233f', '#1d3a63', '#25558a', '#2f74ad', '#4b9ac9', '#8ccbe6'],
  wood: ['#2a1a16', '#4a2c20', '#6b412a', '#8c5a35', '#ad7a48', '#cf9f66'],
  plank: ['#3d2619', '#5c3a24', '#7d5233', '#9c6b43', '#bd8a5a'],
  roofRed: ['#3b1720', '#5e2229', '#88312f', '#ad4838', '#cf6a48'],
  roofBlue: ['#1a2238', '#26345a', '#33497a', '#456198', '#5e7fb6'],
  roofMoss: ['#1f2a1f', '#2f3e28', '#445533', '#5c6f40', '#7a8b52'],
  wallPlaster: ['#6e5a55', '#9a8378', '#c2ab98', '#dfcbb4', '#f1e4cf'],
  ember: ['#4a1a12', '#86301b', '#c4501f', '#ee7f2d', '#ffb047', '#ffe08a'],
  arcane: ['#1c1547', '#33267a', '#4f3db3', '#7a64e0', '#a995ff', '#ddd2ff'],
  heal: ['#123d32', '#1d6b4f', '#2fa070', '#58cf8f', '#9ff0b8'],
  blood: ['#3a0d16', '#6b1424', '#9e2133', '#cc3a45'],
  gold: ['#4d3412', '#7d5a1c', '#b58726', '#e4b83d', '#ffe27a'],
  iron: ['#2b2e37', '#474b57', '#6b707e', '#9aa0ad', '#cfd4dc'],
  bone: ['#5b5246', '#8a7f6c', '#b8ad95', '#ded5bd', '#f6f0de'],
  slime: ['#18402a', '#24683a', '#37944b', '#5bc163', '#9ce68a'],
  fur: ['#2a2420', '#463b33', '#665648', '#8a7562', '#ad9780'],
  night: ['#0b0a1a', '#141332', '#1e1f4a', '#2c3065'],
};

export const SKIN = [
  ['#5a3326', '#7b4733', '#9c6144'], // deep
  ['#7d4a32', '#a0663f', '#c28456'], // brown
  ['#a8704c', '#c98f66', '#e2ad84'], // tan
  ['#c48d6c', '#e0aa88', '#f4c9a8'], // light
  ['#d3a189', '#ecc0a5', '#fbdcc6'], // fair
];

export const HAIR = {
  black: ['#14101a', '#2a2130', '#3e3445'],
  brown: ['#2e1c14', '#4e2f1f', '#704530'],
  auburn: ['#4a1a12', '#7a2c1c', '#a8452a'],
  blonde: ['#7a5a2a', '#b48c42', '#e0c070'],
  silver: ['#5e5f72', '#9a9cb0', '#d6d8e6'],
  midnight: ['#141630', '#232a58', '#3a4a8a'], // Lyra: deep blue-black
  ginger: ['#6b2a12', '#a5481e', '#d8743a'],
  white: ['#8e8a95', '#c9c6cf', '#f2f0f5'],
};

export const CLOTH = {
  red: ['#4a1520', '#7a2232', '#ab3a45'],
  blue: ['#1a2547', '#2a3d70', '#41609e'],
  green: ['#1c3524', '#2c5236', '#43744a'],
  brown: ['#33211a', '#553728', '#7a523a'],
  purple: ['#2c1a40', '#47296a', '#6a4196'],
  teal: ['#12343a', '#1e5459', '#2f7a7c'],
  gray: ['#2b2b35', '#474756', '#6a6a7c'],
  cream: ['#7a6a58', '#b5a184', '#e2d2b0'],
  black: ['#141219', '#24212c', '#38343f'],
  gold: ['#4d3412', '#8a6420', '#c79a35'],
  white: ['#8f8c99', '#c8c5d0', '#f0eef5'],
  rose: ['#4a1a2e', '#7a2c4a', '#b04a6e'],
};

// UI colors used by in-canvas text (bubbles, names). The DOM UI has its own CSS tokens.
export const UI = {
  text: '#f4ead7',
  textDim: '#b9ad99',
  ember: '#ffb047',
  arcane: '#a995ff',
  heal: '#58cf8f',
  danger: '#ff6b5e',
  bubbleBg: 'rgba(24, 20, 40, 0.88)',
  bubbleEdge: '#f4ead7',
  thoughtBg: 'rgba(50, 44, 84, 0.82)',
};
