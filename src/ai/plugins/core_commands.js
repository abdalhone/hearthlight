// STUB (owned by the behavior agent). Real version registers the full core action set.
export const coreCommandsPlugin = {
  id: 'core_commands',
  name: 'Core commands',
  description: 'Follow, stay, move, combat modes.',
  actions: {
    follow: {
      description: 'Follow someone (default: the player).',
      params: { target: 'who to follow (default the player)' },
      run(args, ctx) {
        return ctx.behavior.setDirective({ type: 'follow', target: args.target || 'player' });
      },
    },
    stay: {
      description: 'Stay here and hold this position.',
      params: {},
      run(args, ctx) {
        return ctx.behavior.setDirective({ type: 'stay' });
      },
    },
    set_combat_mode: {
      description: 'Set the combat mode: attack, defend or passive.',
      params: { value: 'attack | defend | passive' },
      run(args, ctx) {
        return ctx.behavior.setStance(args.value || 'defend');
      },
    },
  },
};
