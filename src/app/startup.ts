import { recoverInterruptedAnalyses, redateGameEvidence } from '../db/analysisRepo';
import { loadSettings } from '../db/settings';
import { reconcileDerivations } from '../services/analysis/analysisRunner';
import { removeOrphanExerciseEvidence } from '../db/trainingRepo';
import { getEngine } from '../services/engine/engineService';

/** One independent start-up task. */
export interface StartupStep {
  name: string;
  run: () => Promise<unknown>;
}

/**
 * The tasks run when the app opens, in this order: pause analyses no tab runs any more (one that
 * another tab runs is left alone, Sprint 4.8, T-1), date game evidence by the game (evidence before
 * Sprint 4.4 used the analysis time), remove evidence of exercises that no longer exist (Sprint
 * 4.5, D-5) and finish exercise/evidence derivations a closed tab left pending (the engine starts
 * only if needed).
 */
export function appStartupSteps(): StartupStep[] {
  return [
    { name: 'retomar análises', run: () => recoverInterruptedAnalyses() },
    { name: 'datar evidências', run: redateGameEvidence },
    { name: 'limpar evidências órfãs', run: removeOrphanExerciseEvidence },
    { name: 'concluir derivações', run: async () => reconcileDerivations(await loadSettings(), getEngine) },
  ];
}

/**
 * Runs the steps one after the other. Each is independent: one that fails is logged and does not
 * keep the next ones from running (audit FA-5). Resolves to the names of the steps that failed.
 */
export async function runStartupSteps(steps: readonly StartupStep[], onError: (name: string, e: unknown) => void = logStartupError): Promise<string[]> {
  const failed: string[] = [];
  for (const step of steps) {
    try {
      await step.run();
    } catch (e) {
      failed.push(step.name);
      onError(step.name, e);
    }
  }
  return failed;
}

function logStartupError(name: string, e: unknown): void {
  console.error(`ChessQuest: falha na etapa de abertura "${name}"`, e);
}
