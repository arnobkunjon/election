/**
 * lifecycle.mjs — election status rules (Promise Format v0.1).
 *
 * Statuses move ONLY forward along: draft -> open -> locked -> governing -> closed.
 *
 *  - publish: allowed only when open.
 *  - amend:   allowed only when open.
 *  - withdraw: allowed when open, locked, or governing (never draft/closed).
 *    A withdrawal never erases anything; original versions stay visible.
 *  - creating a FINAL seal: allowed when status becomes locked.
 */

export const STATUSES = ["draft", "open", "locked", "governing", "closed"];

function rank(status) {
  const i = STATUSES.indexOf(status);
  if (i === -1) throw new TypeError(`unknown election status "${status}"`);
  return i;
}

/** Can a candidate publish a new promise while the election has this status? */
export function canPublish(status) {
  return status === "open";
}

/** Can a candidate amend (new version of) an existing promise? */
export function canAmend(status) {
  return status === "open";
}

/** Can a candidate withdraw a promise? */
export function canWithdraw(status) {
  return status === "open" || status === "locked" || status === "governing";
}

/** May a final seal be created for an election with this status? */
export function canFinalSeal(status) {
  return status === "locked";
}

/** Is moving from status `from` to status `to` legal? Only forward, no skips? */
export function canMoveTo(from, to) {
  const a = rank(from);
  const b = rank(to);
  return b === a + 1;
}
