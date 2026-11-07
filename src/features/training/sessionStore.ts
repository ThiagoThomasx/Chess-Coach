import { parsePlan, type SessionPlan } from '../../services/training/session';

/** Device-local storage of the guided session plan; results themselves live in IndexedDB. */
const KEY = 'chessquest.session.v1';

export function loadPlan(): SessionPlan | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parsePlan(JSON.parse(raw)) : null;
  } catch {
    // Blocked or corrupted storage: behave as if there were no session.
    return null;
  }
}

/** Returns false when the plan could not be stored (the session still works until the page is closed). */
export function savePlan(plan: SessionPlan): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(plan));
    return true;
  } catch {
    return false;
  }
}

export function clearPlan(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored or storage blocked: nothing to clear.
  }
}
