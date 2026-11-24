import { coreCommandsPlugin } from './core_commands.js';
import { worldPlugin } from './world_plugin.js';
import { jobsPlugin } from './jobs_plugin.js';
import { relationshipsPlugin } from './relationships_plugin.js';
import { memoryPlugin } from './memory_plugin.js';
import { feelingsPlugin } from './feelings_plugin.js';
import { socialPlugin } from './social_plugin.js';
import { questPlugin } from './quest_plugin.js';
import { autonomyPlugin } from './autonomy_plugin.js';
import { villagePlugin } from './village_plugin.js';

// Built-in plugins, in registration order. Earlier plugins' intents match first.
// autonomy comes first: her own will (consent, leaving, rejoining) outranks everything else.
export const BUILTIN_PLUGINS = [
  autonomyPlugin,
  coreCommandsPlugin,
  worldPlugin,
  jobsPlugin,
  relationshipsPlugin,
  memoryPlugin,
  feelingsPlugin,
  socialPlugin,
  questPlugin,
  villagePlugin,
];
