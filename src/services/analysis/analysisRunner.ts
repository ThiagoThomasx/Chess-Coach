import type { Color, Exercise, Game, GameAnalysis, Settings } from '../../types/domain';
import { getGame, setUserColor } from '../../db/gamesRepo';
import { analyzeGame, fenKey, replyLinesOf, type EngineLike } from './gameAnalyzer';
import { dbEvalCache, getAnalysis, listAnalyses, replaceGameSkillEvents, saveAnalysis } from '../../db/analysisRepo';
import { getDb } from '../../db/database';
import { addExercise, listExercises } from '../../db/trainingRepo';
import { buildExercise, selectExercisePositions, withSolutionTree } from '../exercises/generate';
import { eventsFromGame } from '../adaptation/skills';

export { replyLinesOf };

export type RunListener = (a: GameAnalysis) => void;

/** What a completed analysis produced for training (null when nothing was derived, e.g. paused). */
export interface Derivation {
  /** False when the game has no user color: no exercises or evidence can be attributed. */
  hasUserColor: boolean;
  exercisesAdded: number;
}

export interface AnalysisOutcome {
  analysis: GameAnalysis;
  derivation: Derivation | null;
}

interface Run {
  signal: { aborted: boolean };
  promise: Promise<AnalysisOutcome>;
}

const runs = new Map<string, Run>();
const listeners = new Map<string, Set<RunListener>>();

export function subscribe(gameId: string, fn: RunListener): () => void {
  const set = listeners.get(gameId) ?? new Set();
  set.add(fn);
  listeners.set(gameId, set);
  return () => set.delete(fn);
}

function emit(a: GameAnalysis): void {
  listeners.get(a.gameId)?.forEach((l) => l(a));
}

export function isRunning(gameId: string): boolean {
  return runs.has(gameId);
}

/**
 * Starts (or resumes) a game analysis. Progress is persisted after every
 * position so a closed tab can resume later. On completion, skill evidence
 * and exercises are derived from the results.
 */
export function startAnalysis(game: Game, settings: Settings, engine: EngineLike, depth: number = settings.analysisDepth): Promise<AnalysisOutcome> {
  const existing = runs.get(game.id);
  if (existing) return existing.promise;
  const signal = { aborted: false };
  const promise = (async () => {
    const previous = await getAnalysis(game.id);
    const result = await analyzeGame(
      game,
      { depth, multiPv: settings.multiPv },
      {
        engine,
        cache: dbEvalCache,
        thresholds: settings.thresholds,
        signal,
        onProgress: async (a) => {
          await saveAnalysis(a);
          emit(a);
        },
      },
      previous,
    );
    // A complete analysis is saved already marked for derivation, so a tab closed before it finishes is reconciled.
    await saveAnalysis(result.status === 'complete' ? { ...result, derivation: 'pending' } : result);
    // Derives with the stored color: it may have been set (or the game deleted) while the analysis ran.
    const derivation = result.status === 'complete' ? await deriveCurrent(game.id, result, settings, engine) : null;
    emit(result);
    return { analysis: result, derivation };
  })().finally(() => runs.delete(game.id));
  runs.set(game.id, { signal, promise });
  return promise;
}

export function stopAnalysis(gameId: string, engine?: { stop(): void }): void {
  const run = runs.get(gameId);
  if (!run) return;
  run.signal.aborted = true;
  engine?.stop();
}

/** Search settings for building exercise solution trees (capped so generation stays fast). */
export function treeOptions(settings: Settings) {
  return { depth: Math.min(settings.analysisDepth, 16), multiPv: Math.max(settings.multiPv, 3), tolerance: settings.exerciseTolerance };
}

/** Adds the solution tree; on engine failure the exercise is kept as a single-move exercise. */
export async function completeExercise(ex: Exercise, settings: Settings, engine?: EngineLike): Promise<Exercise> {
  if (!engine) return ex;
  try {
    return await withSolutionTree(ex, engine, treeOptions(settings));
  } catch {
    return ex;
  }
}

/**
 * Generates skill evidence and exercises from a completed analysis (idempotent).
 * Without a user color the game's evidence is removed: its moves cannot be
 * attributed to the player. Exercises already created are never deleted.
 */
export async function deriveFromAnalysis(game: Game, a: GameAnalysis, settings: Settings, engine?: EngineLike): Promise<Derivation> {
  const replies = replyLinesOf(a);
  if (!game.userColor) {
    await replaceGameSkillEvents(game.id, []);
    return { hasUserColor: false, exercisesAdded: 0 };
  }
  await replaceGameSkillEvents(game.id, eventsFromGame(game.id, a.reviews, replies, game.userColor, a.updatedAt));
  // Only other games' exercises exclude a position: the picks of this game stay the same on every
  // derivation, so a repeated or resumed one completes the set instead of choosing new positions.
  const all = await listExercises();
  const otherGames = new Set(all.filter((e) => e.gameId !== game.id).map((e) => e.fen));
  const own = new Set(all.filter((e) => e.gameId === game.id).map((e) => fenKey(e.fen)));
  const picks = selectExercisePositions(game, a.reviews, a.positions, { max: settings.maxExercisesPerGame, thresholds: settings.thresholds, existingFens: otherGames });
  let added = 0;
  for (const r of picks) {
    const before = a.positions[r.ply - 1];
    if (!before || own.has(fenKey(r.fenBefore))) continue;
    const ex = buildExercise({ game, review: r, before, replyLine: replies[r.ply] ?? [], tolerance: settings.exerciseTolerance });
    if (!ex) continue;
    const complete = await completeExercise(ex, settings, engine);
    // Building the tree takes time: stop if the color changed (or the game was deleted) meanwhile.
    if ((await getGame(game.id))?.userColor !== game.userColor) break;
    if ((await addExercise(complete)).added) added++;
  }
  return { hasUserColor: true, exercisesAdded: added };
}

/** Derivations of one game run one at a time, in call order. */
const derivations = new Map<string, Promise<unknown>>();

function serialized<T>(gameId: string, fn: () => Promise<T>): Promise<T> {
  const next = (derivations.get(gameId) ?? Promise.resolve()).then(fn, fn);
  const tail = next.then(
    () => undefined,
    () => undefined,
  );
  derivations.set(gameId, tail);
  void tail.then(() => {
    if (derivations.get(gameId) === tail) derivations.delete(gameId);
  });
  return next;
}

/** A color that keeps changing during derivation is re-read at most this many times. */
const MAX_DERIVE_PASSES = 3;

/**
 * Derives with the color stored when the derivation starts, and again if it
 * changed meanwhile, so the evidence always ends up matching the saved color.
 * Null when the game no longer exists (its evidence is removed).
 */
function deriveCurrent(gameId: string, a: GameAnalysis, settings: Settings, engine?: EngineLike): Promise<Derivation | null> {
  return serialized(gameId, () => deriveNow(gameId, a, settings, engine));
}

/** Body of `deriveCurrent`; runs inside the game's queue. */
async function deriveNow(gameId: string, a: GameAnalysis, settings: Settings, engine?: EngineLike): Promise<Derivation | null> {
  let result: Derivation | null = null;
  for (let pass = 0; pass < MAX_DERIVE_PASSES; pass++) {
    const game = await getGame(gameId);
    if (!game) break;
    result = await deriveFromAnalysis(game, a, settings, engine);
    if ((await markDerived(gameId, game.userColor)) !== 'changed') break;
  }
  if (!(await getGame(gameId))) {
    await replaceGameSkillEvents(gameId, []);
    return null;
  }
  return result;
}

/**
 * Marks the derivation done when the color it used is still the saved one
 * (atomically with that check). 'changed' when the color moved meanwhile:
 * the mark stays pending. 'gone' when the game no longer exists.
 */
async function markDerived(gameId: string, color: Color | undefined): Promise<'done' | 'changed' | 'gone'> {
  const db = getDb();
  return db.transaction('rw', db.games, db.analyses, async () => {
    const now = await db.games.get(gameId);
    if (!now) return 'gone';
    if (now.userColor !== color) return 'changed';
    await db.analyses.update(gameId, { derivation: 'done' });
    return 'done';
  });
}

/** Saves the color and, for a complete analysis, marks its derivation pending in the same transaction. */
async function saveColorMarkingPending(gameId: string, color: Color | undefined): Promise<GameAnalysis | null | false> {
  const db = getDb();
  return db.transaction('rw', db.games, db.analyses, async () => {
    if (!(await setUserColor(gameId, color))) return false;
    const analysis = await db.analyses.get(gameId);
    if (analysis?.status !== 'complete') return null;
    const pending: GameAnalysis = { ...analysis, derivation: 'pending' };
    await db.analyses.put(pending);
    return pending;
  });
}

/**
 * Finishes derivations a closed tab left pending (color saved, exercises or
 * evidence not yet rebuilt). Analyses from before Sprint 4.3 (no mark) and
 * finished ones are left alone, so training data cleared on purpose is not
 * regenerated. Returns how many games were reconciled.
 */
export async function reconcileDerivations(settings: Settings, engine?: () => EngineLike | undefined): Promise<number> {
  const isPending = (a: GameAnalysis | undefined): a is GameAnalysis => a?.status === 'complete' && a.derivation === 'pending' && !isRunning(a.gameId);
  const pending = (await listAnalyses()).filter(isPending);
  let reconciled = 0;
  for (const { gameId } of pending) {
    try {
      const derived = await serialized(gameId, async () => {
        // Re-read in the game's queue: another run (a repeated effect, a color change) may have finished it.
        const a = await getAnalysis(gameId);
        return isPending(a) && (await deriveNow(gameId, a, settings, engine?.())) !== null;
      });
      if (derived) reconciled++;
    } catch (e) {
      // One broken game must not block the others; it stays pending and is retried on the next start.
      console.error('ChessQuest: falha ao gerar exercícios pendentes da partida', gameId, e);
    }
  }
  return reconciled;
}

/**
 * Saves the user's color for a game and, when its analysis is complete,
 * derives exercises and evidence right away (no re-analysis). Returns null
 * when nothing was derived: unknown game, or analysis not complete yet (a
 * running analysis derives with the stored color when it completes).
 */
export async function changeUserColor(gameId: string, color: Color | undefined, settings: Settings, engine?: () => EngineLike | undefined): Promise<Derivation | null> {
  const analysis = await saveColorMarkingPending(gameId, color);
  if (!analysis) return null;
  return deriveCurrent(gameId, analysis, settings, engine?.());
}

/** User-facing summary of what an analysis or a color change generated. */
export function derivationMessage(d: Derivation | null, prefix = 'Análise concluída.'): string {
  if (!d) return prefix;
  if (!d.hasUserColor) return `${prefix} Defina sua cor na lista de partidas para gerar exercícios e atualizar seu perfil.`;
  if (d.exercisesAdded === 0) return `${prefix} Perfil atualizado; nenhum exercício novo.`;
  return `${prefix} Perfil atualizado e ${d.exercisesAdded} exercício(s) novo(s).`;
}
