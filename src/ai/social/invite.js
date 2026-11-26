// Asking someone to walk with you (round 14b, DESIGN §33.3; the author: "I want to be able to
// take anyone as my companion"). Pure: what the player's words ask, decided by the game
// (party.weighJoin) before any mind words the answer.
//
//   detectInvite(text)  -> { kind: 'invite', text } | null   "come with me", "join me", …
//   detectDismiss(text) -> { kind: 'dismiss', text } | null  "go home", "you can leave", …

const INVITE = [
  /\b(?:come|walk|travel|journey|go|ride|adventure)\s+(?:along\s+)?with\s+me\b/,
  /\b(?:join|accompany)\s+me\b/,
  /\bcome\s+along\b/,
  /\b(?:be|become)\s+my\s+(?:companion|partner|travel(?:l)?ing\s+companion|sword|shield)\b/,
  /\bwill\s+you\s+(?:come|travel|walk)\b/,
  /\b(?:want|like)\s+to\s+(?:come|travel|walk)\s+with\s+me\b/,
  /\bfollow\s+me\b/,
];
const NOT = /\b(?:don'?t|do not|never|won'?t|stop)\s+(?:come|walk|travel|join|follow)\b/;

const DISMISS = [/\b(?:go|head)\s+home\b/, /\byou\s+(?:can|may)\s+(?:go|leave)\b/, /\b(?:leave|stop following)\s+me\b/, /\bi\s+(?:don'?t|do not)\s+need\s+you\b/, /\bpart\s+ways\b/];

function norm(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectInvite(text) {
  const t = norm(text);
  if (!t || NOT.test(t)) return null;
  return INVITE.some((re) => re.test(t)) ? { kind: 'invite', text: t.slice(0, 120) } : null;
}

export function detectDismiss(text) {
  const t = norm(text);
  if (!t) return null;
  return DISMISS.some((re) => re.test(t)) ? { kind: 'dismiss', text: t.slice(0, 120) } : null;
}
