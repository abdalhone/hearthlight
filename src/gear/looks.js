import { ensureCharacter } from '../art/characters_art.js';
import { PLAYER_APPEARANCE } from '../art/characters_appearance.js';
import { gearDef } from './gear_data.js';

// What the stranger wears shows on their sprite (DESIGN §26: "weapon, cloak color, armor
// tint"): a cloak in the cloak's dye, a tunic in the armor's tint (plate and mail read
// as armor), and the held blade's look. Each combination is painted once, the first time
// it is worn, into its own atlas key; the player's spriteKey points at it.

const ARMOR_OUTFIT = { iron_mail: 'armor', lakeglass_mail: 'armor', ironhand_plate: 'armor' };

export function gearLookKey(gear) {
  const e = gear?.equipped || {};
  if (!e.cloak && !e.armor && !e.weapon) return 'player';
  return `player~${e.cloak || '-'}~${e.armor || '-'}~${e.weapon || '-'}`;
}

export function gearAppearance(gear) {
  const e = gear?.equipped || {};
  const a = { ...PLAYER_APPEARANCE };
  const cloak = e.cloak ? gearDef(e.cloak) : null;
  const armor = e.armor ? gearDef(e.armor) : null;
  if (cloak?.tint) a.cloak = cloak.tint;
  if (armor?.tint) {
    a.top = armor.tint;
    if (ARMOR_OUTFIT[e.armor]) a.outfit = ARMOR_OUTFIT[e.armor];
  }
  const weapon = e.weapon ? gearDef(e.weapon) : null;
  a.held = weapon && /fang/.test(e.weapon) ? 'dagger' : 'sword';
  return a;
}

// Point the player's sprite at what they wear (painting it if it is new).
export function applyGearLook(game) {
  const P = game?.player;
  const atlas = game?.atlas;
  if (!P || !atlas || typeof document === 'undefined') return false;
  const key = gearLookKey(game.gear);
  if (key === 'player') {
    P.spriteKey = 'player';
    return true;
  }
  if (!ensureCharacter(atlas, key, gearAppearance(game.gear))) return false;
  P.spriteKey = key;
  return true;
}
