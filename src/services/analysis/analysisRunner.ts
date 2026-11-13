import type { Color, Exercise, Game, GameAnalysis, Settings } from '../../types/domain';
import { getGame, setUserColor } from '../../db/gamesRepo';
import { analyzeGame, fenKey, replyLinesOf, type EngineLike } from './gameAnalyzer';
import { dbEvalCache, getAnalysis, listCompleteAnalyses, replaceGameSkillEvents, saveAnalysisIfGameExists } from '../../db/analysisRepo';
import { progressSaver } from './progressSaver';
import { getDb } from '../../db/database';
import { addExercise, listExercises } from '../../db/trainingRepo';
import { acceptsPlayedMove, buildExercise, selectExercisePositions, withSolutionTree } from '../exercises/generate';
import { eventsFromGame } from '../adaptation/skills';
import { gameEvidenceTime } from '../games/gameDate';

export { replyLinesOf };

export type RunListener = (a: GameAnalysis) => void;

/** What a completed analysis produced for training (null when nothing was derived, e.g. paused). */
export interface Derivation {
  /** False when the game has no user color: no exercises or evidence can be attributed. */
  hasUserColor: boolean;
  exercisesAdded: number;
  /** Never-attempted exercises of the old side removed by a side switch (only set when > 0). */
  exercisesRemoved?: number;
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
 * Starts (or resumes) a game analysis. Listeners are notified after every
 * position; progress is persisted at most every PROGRESS_SAVE_INTERVAL_MS
 * (a closed tab resumes from the stored positions and the eval cache), and
 * the final state (complete, paused or error) is always saved when the run
 * ends (Sprint 4.6, PA-1). On completion, skill evidence and exercises are
 * derived from the results.
 */
export function startAnalysis(game: Game, settings: Settings, engine: EngineLike, depth: number = settings.analysisDepth): Promise<AnalysisOutcome> {
  const existing = runs.get(game.id);
  if (existing) return existing.promise;
  const signal = { aborted: false };
  // A game deleted mid-run (from the games list) stops the run at its next save and gets no analysis back (audit AC-1).
  let gameGone = false;
  const saveProgress = progressSaver(async (a) => {
    if (!(await saveAnalysisIfGameExists(a))) gameGone = true;
  });
  let lastProgress: GameAnalysis | undefined;
  const promise = (async () => {
    let result: GameAnalysis;
    try {
      const previous = await getAnalysis(game.id);
      result = await analyzeGame(
        game,
        { depth, multiPv: settings.multiPv },
        {
          engine,
          cache: dbEvalCache,
          thresholds: settings.thresholds,
          signal,
          // Awaited by analyzeGame before the next position: saves never overlap or outlive the run.
          onProgress: async (a) => {
            lastProgress = a;
            await saveProgress(a);
            if (gameGone) signal.aborted = true;
            emit(a);
          },
        },
        previous,
      );
      // A complete analysis is saved already marked for derivation, so a tab closed before it finishes is reconciled.
      await saveAnalysisIfGameExists(result.status === 'complete' ? { ...result, derivation: 'pending' } : result);
    } catch (e) {
      // A storage failure (quota, I/O) must not leave the run "running" on screen or on disk (audit AC-3).
      await endWithError(lastProgress, e);
      throw e;
    }
    // Derives with the stored color: it may have been set (or the game deleted) while the analysis ran.
    const derivation = result.status === 'complete' ? await deriveCurrent(game.id, result, settings, engine) : null;
    emit(result);
    return { analysis: result, derivation };
  })().finally(() => runs.delete(game.id));
  runs.set(game.id, { signal, promise });
  return promise;
}

/** Stores and announces a failed run as an error (best effort: the storage may be what failed). */
async function endWithError(last: GameAnalysis | undefined, e: unknown): Promise<void> {
  if (!last) return;
  const failed: GameAnalysis = { ...last, status: 'error', error: `Falha ao gravar a análise: ${e instanceof Error ? e.message : String(e)}`, updatedAt: Date.now() };
  try {
    await saveAnalysisIfGameExists(failed);
  } catch (saveError) {
    // The stored record stays 'running'; recoverInterruptedAnalyses turns it into 'paused' on the next start.
    console.error('ChessQuest: não foi possível gravar o erro da análise', saveError);
  }
  emit(failed);
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
  // Dated when the game was played (not analysed): decay, trend and "needs review" follow the board.
  await replaceGameSkillEvents(game.id, eventsFromGame(game.id, a.reviews, replies, game.userColor, gameEvidenceTime(game, a.updatedAt)));
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
    // A deeper search (the tree) accepts the move played: it was not an error (Sprint 4.4, O1; audit A5-1).
    if (acceptsPlayedMove(complete, r.uci, before.depth)) continue;
    // The color is checked again in the write's own transaction: a switch cannot land in between (Sprint 4.5, C1).
    const saved = await addExercise(complete, { gameId: game.id, color: game.userColor });
    if (saved.colorChanged) break;
    if (saved.added) added++;
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

interface SavedColor {
  /** The complete analysis, now marked pending; null when there is none (nothing to derive). */
  analysis: GameAnalysis | null;
  /** Never-attempted exercises of the side the player no longer is, removed by a side switch. */
  removed: number;
}

/**
 * Saves the color and, for a complete analysis, marks its derivation pending,
 * in one transaction. Switching sides (white ↔ black) on a complete analysis
 * also removes this game's exercises of the old side that were never
 * attempted (user decision D3, Sprint 4.4), manual ones included: attempted
 * ones are kept with their history. False when the game does not exist.
 */
async function saveColorMarkingPending(gameId: string, color: Color | undefined): Promise<SavedColor | false> {
  const db = getDb();
  return db.transaction('rw', [db.games, db.analyses, db.exercises, db.attempts], async () => {
    const previous = (await db.games.get(gameId))?.userColor;
    if (!(await setUserColor(gameId, color))) return false;
    const analysis = await db.analyses.get(gameId);
    // Nothing to derive (analysis running or missing): nothing is removed either, so the
    // toast never hides a removal (review M2); the old side's exercises stay as before 4.4.
    if (analysis?.status !== 'complete') return { analysis: null, removed: 0 };
    const removed = previous && color && previous !== color ? await removeUnattemptedExercises(gameId, previous) : 0;
    const pending: GameAnalysis = { ...analysis, derivation: 'pending' };
    await db.analyses.put(pending);
    return { analysis: pending, removed };
  });
}

/** Deletes the game's exercises for `side` that have no attempt (so no evidence either). Runs inside the caller's transaction. */
async function removeUnattemptedExercises(gameId: string, side: Color): Promise<number> {
  const db = getDb();
  const candidates = await db.exercises.where('gameId').equals(gameId).filter((e) => e.sideToMove === side).toArray();
  const unattempted: string[] = [];
  for (const ex of candidates) if ((await db.attempts.where('exerciseId').equals(ex.id).count()) === 0) unattempted.push(ex.id);
  await db.exercises.bulkDelete(unattempted);
  return unattempted.length;
}

/**
 * Finishes derivations a closed tab left pending (color saved, exercises or
 * evidence not yet rebuilt). Analyses from before Sprint 4.3 (no mark) and
 * finished ones are left alone, so training data cleared on purpose is not
 * regenerated. Returns how many games were reconciled.
 */
export async function reconcileDerivations(settings: Settings, engine?: () => EngineLike | undefined): Promise<number> {
  const isPending = (a: GameAnalysis | undefined): a is GameAnalysis => a?.status === 'complete' && a.derivation === 'pending' && !isRunning(a.gameId);
  const pending = (await listCompleteAnalyses()).filter(isPending);
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
  const saved = await saveColorMarkingPending(gameId, color);
  if (!saved || !saved.analysis) return null;
  const derivation = await deriveCurrent(gameId, saved.analysis, settings, engine?.());
  return derivation && saved.removed ? { ...derivation, exercisesRemoved: saved.removed } : derivation;
}

/** User-facing summary of what an analysis or a color change generated. */
export function derivationMessage(d: Derivation | null, prefix = 'Análise concluída.'): string {
  if (!d) return prefix;
  if (!d.hasUserColor) return `${prefix} Defina sua cor na lista de partidas para gerar exercícios e atualizar seu perfil.`;
  const removed = d.exercisesRemoved ? ` ${d.exercisesRemoved} exercício(s) nunca tentado(s) do outro lado foram removidos.` : '';
  if (d.exercisesAdded === 0) return `${prefix} Perfil atualizado; nenhum exercício novo.${removed}`;
  return `${prefix} Perfil atualizado e ${d.exercisesAdded} exercício(s) novo(s).${removed}`;
}

/**
 * Toast after a color change that threw. The color may already be saved (the
 * derivation runs after it and stays pending, retried on the next start):
 * then the message must not say the color was not saved.
 */
export function colorChangeFailureMessage(saved: boolean, color: Color | undefined): string {
  if (!saved) return 'Não foi possível salvar a cor. Tente de novo.';
  return color
    ? 'Cor salva. Os exercícios não puderam ser gerados agora; o app tentará de novo na próxima abertura.'
    : 'Cor removida. O perfil não pôde ser atualizado agora; o app tentará de novo na próxima abertura.';
}
