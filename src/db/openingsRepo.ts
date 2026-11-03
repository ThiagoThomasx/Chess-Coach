import type { Color, Opening, OpeningAttempt, RepertoireEntry } from '../types/domain';
import { nextSrs } from '../services/scheduling/srs';
import { validateLine } from '../services/openings/practice';
import { WEIGHTS } from '../services/adaptation/skills';
import { newId } from '../utils/hash';
import { getDb } from './database';

export async function listCustomOpenings(): Promise<Opening[]> {
  return getDb().customOpenings.toArray();
}

export async function addCustomOpening(name: string, side: Color, moves: string[], goals: string[]): Promise<Opening> {
  const v = validateLine(moves);
  if (!v.ok) throw new Error(v.error);
  if (moves.length < 2) throw new Error('Informe pelo menos dois lances');
  const o: Opening = {
    id: `custom-${newId()}`,
    name: name.trim() || 'Linha personalizada',
    eco: '—',
    side,
    mainLine: { id: 'main', name: 'Linha personalizada', moves },
    variations: [],
    goals,
    tacticalIdeas: [],
    commonMistakes: [],
    custom: true,
  };
  await getDb().customOpenings.add(o);
  return o;
}

export async function deleteCustomOpening(id: string): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.customOpenings, db.repertoire, async () => {
    await db.repertoire.where('openingId').equals(id).delete();
    await db.customOpenings.delete(id);
  });
}

export async function listRepertoire(): Promise<RepertoireEntry[]> {
  return getDb().repertoire.toArray();
}

export async function toggleRepertoire(openingId: string, lineId: string, side: Color): Promise<boolean> {
  const db = getDb();
  const id = `${openingId}:${lineId}`;
  if (await db.repertoire.get(id)) {
    await db.repertoire.delete(id);
    return false;
  }
  const now = Date.now();
  await db.repertoire.add({ id, openingId, lineId, side, addedAt: now, srs: { box: 0, dueAt: now } });
  return true;
}

/** Records a continuation drill; errors reschedule the line for an early review. */
export async function recordOpeningAttempt(a: Omit<OpeningAttempt, 'id'>, intervals: readonly number[]): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.openingAttempts, db.repertoire, db.skillEvents, async () => {
    await db.openingAttempts.add(a);
    const entry = await db.repertoire.get(`${a.openingId}:${a.lineId}`);
    if (entry) await db.repertoire.put({ ...entry, srs: nextSrs(entry.srs, a.correct ? 'independent' : 'fail', a.at, intervals) });
    await db.skillEvents.add({ skill: 'openings', at: a.at, outcome: a.correct ? 1 : 0, weight: WEIGHTS.opening, independent: true, source: 'opening', ref: { lineId: `${a.openingId}:${a.lineId}` } });
  });
}

export async function listOpeningAttempts(): Promise<OpeningAttempt[]> {
  return getDb().openingAttempts.orderBy('at').toArray();
}
