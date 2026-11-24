// Which brain fights for which boss.
import { varekBrain } from './ai_varek.js';
import { greyjawBrain } from './ai_greyjaw.js';
import { motherBrain } from './ai_mother.js';
import { lakeBrain } from './ai_lake.js';
import { wardenBrain } from './ai_warden.js';

export const BRAINS = {
  varek: varekBrain,
  greyjaw: greyjawBrain,
  mother_of_slimes: motherBrain,
  lakes_hum: lakeBrain,
  bone_warden: wardenBrain,
};
