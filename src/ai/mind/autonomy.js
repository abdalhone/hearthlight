// STUB (owned by the autonomy agent). Lyra's own will — DESIGN.md §16.
// The Mind creates one: `mind.autonomy = new Autonomy(mind, game)` and exposes the
// delegates listed in DESIGN.md §16 (mind.agenda, mind.ledger, mind.companionship,
// mind.promises, mind.evaluateRequest, mind.setCompanionship, mind.reconsider, mind.recordDeed).
//
// Interface (keep every member):
//   companionship                 'together' | 'wary' | 'apart' | 'left' | 'gone'
//   agenda                        { goals: [{id, text, weight}], today: [{from, to, activity, at, why}], purse }
//   ledger                        [{ t, day, deed, severity, text, victimId }]
//   promises                      [{ id, text, by: 'player'|'lyra', state: 'open'|'kept'|'broken', due }]
//   update(dt)                    plans, promise deadlines, periodic reconsider()
//   evaluateRequest(req)          req = { action, args, source } -> verdict (DESIGN §16.4)
//   recordDeed(deed, opts)        opts = { severity, text, victim }; adjusts the relationship, remembers, reconsiders
//   reconsider(reason)            re-evaluate the companionship state
//   setCompanionship(state, why)  sets the state, emits companionship_changed, tells behavior what to do
//   planDay()                     rebuild agenda.today
//   serialize() / deserialize(d)
export class Autonomy {
  constructor(mind, game) {
    this.mind = mind;
    this.game = game;
    this.companionship = 'together';
    this.agenda = { goals: [], today: [], purse: 0 };
    this.ledger = [];
    this.promises = [];
  }

  update(dt) {}

  evaluateRequest(req) {
    return { decision: 'accept', reasons: [], message: '', score: 1 };
  }

  recordDeed(deed, opts = {}) {}

  reconsider(reason) {}

  setCompanionship(state, why = '') {
    const previous = this.companionship;
    if (previous === state) return;
    this.companionship = state;
    this.game?.bus?.emit('companionship_changed', { state, previous, reason: why });
  }

  planDay() {}

  serialize() {
    return { companionship: this.companionship, agenda: this.agenda, ledger: this.ledger, promises: this.promises };
  }

  deserialize(d) {
    if (!d) return;
    Object.assign(this, {
      companionship: d.companionship ?? this.companionship,
      agenda: d.agenda ?? this.agenda,
      ledger: d.ledger ?? this.ledger,
      promises: d.promises ?? this.promises,
    });
  }
}
