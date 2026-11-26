// Society's side of the soul contract (DESIGN §36.1, §37.5), as society's reputation.js reads
// a death record: an Unkindling is a killing only once it is KNOWN as one (seen, linked by
// soul, or proven), and a person knows the deed when they saw it, were told (murder.knowsKiller),
// or soul lists them in rec.knownBy. Mirrored here so soul's tests hold soul to it before the
// branches merge; the merged tree's reputation.js is the one that runs.

export function knownAsKilling(m, rec) {
  if (!rec || rec.natural) return false;
  const proven = m?.cases?.[rec.id]?.verdict === 'guilty';
  if (rec.cause === 'unkindled') return rec.known === 'witnessed' || !!rec.linked || !!rec.knownKilling || proven;
  return rec.known === 'witnessed' || rec.foundAt != null || proven;
}

export function knowsDeed(m, rec, id) {
  if (!rec || rec.natural || rec.by !== 'player' || !id) return false;
  if (rec.cause === 'unkindled' && !knownAsKilling(m, rec)) return false;
  try {
    if (m.knowsKiller?.(rec, id)) return true;
  } catch {
    /* as unknown */
  }
  return Array.isArray(rec.knownBy) && rec.knownBy.includes(id);
}
