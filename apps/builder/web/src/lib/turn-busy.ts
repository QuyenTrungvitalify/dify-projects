// turn-busy.ts — recognizing the server's "a turn is already running" 409 on the client.
//
// The server sends ONE wording-stable English string for a turn collision (routes/tasks.ts
// `turnBusyError`, whose comment names that stability as a contract, precisely so the UI can frame it).
// Every OTHER 409 the API returns carries its own specific message ("task is done, not
// awaiting_confirm", "'x' is not a current confirm action", "not a promote task", …) and must keep
// flowing through to the banner verbatim — so the match is deliberately narrow: this prefix only.
//
// Not keyed on the 409's `holder` field, which is how the SERVER's own route tests tell a lock
// collision from a validation reject (docs/state/build-lifecycle.md): the client only keeps `holder`
// when the body carries it as a string, so a collision reported without a holder id would fall through
// and land back in raw English. The sentence is the signal the client actually always receives.
//
// Prefix, not equality: the server's string ends in advice ("— try again in a moment") that the UI no
// longer repeats, and a future edit to that tail must not silently turn the banner back into English.
export const TURN_BUSY_PREFIX = 'a turn is already running';

/** True only for the turn-collision 409 — never for the other 409s, which say their own thing. */
export function isTurnBusy(status: number, message: string): boolean {
  return status === 409 && message.startsWith(TURN_BUSY_PREFIX);
}
