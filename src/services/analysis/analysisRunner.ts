import type { Game, GameAnalysis, Settings } from '../../types/domain';
import { analyzeGame, replyLinesOf, type EngineLike } from './gameAnalyzer';
import { dbEvalCache, getAnalysis, replaceGameSkillEvents, saveAnalysis } from '../../db/analysisRepo';
import { addExercise, listExercises } from '../../db/trainingRepo';
import { buildExercise, selectExercisePositions } from '../exercises/generate';
import { eventsFromGame } from '../adaptation/skills';

export { replyLinesOf };

export type RunListener = (a: GameAnalysis) => void;

interface Run {
  signal: { aborted: boolean };
  promise: Promise<GameAnalysis>;
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
export function startAnalysis(game: Game, settings: Settings, engine: EngineLike, depth: number = settings.analysisDepth): Promise<GameAnalysis> {
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
    await saveAnalysis(result);
    if (result.status === 'complete') await deriveFromAnalysis(game, result, settings);
    emit(result);
    return result;
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

/** Generates exercises and skill events from a completed analysis (idempotent). */
export async function deriveFromAnalysis(game: Game, a: GameAnalysis, settings: Settings): Promise<{ exercisesAdded: number }> {
  const replies = replyLinesOf(a);
  if (game.userColor) await replaceGameSkillEvents(game.id, eventsFromGame(game.id, a.reviews, replies, game.userColor, a.updatedAt));
  if (!game.userColor) return { exercisesAdded: 0 };
  const existing = new Set((await listExercises()).map((e) => e.fen));
  const picks = selectExercisePositions(game, a.reviews, a.positions, { max: settings.maxExercisesPerGame, thresholds: settings.thresholds, existingFens: existing });
  let added = 0;
  for (const r of picks) {
    const before = a.positions[r.ply - 1];
    if (!before) continue;
    const ex = buildExercise({ game, review: r, before, replyLine: replies[r.ply] ?? [], tolerance: settings.exerciseTolerance });
    if (ex && (await addExercise(ex)).added) added++;
  }
  return { exercisesAdded: added };
}
