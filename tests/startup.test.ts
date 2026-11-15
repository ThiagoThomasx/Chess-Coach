import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ChessQuestDB, setDb } from '../src/db/database';
import { getGame, importPgn } from '../src/db/gamesRepo';
import { getAnalysis, saveAnalysis } from '../src/db/analysisRepo';
import { emptyAnalysis } from '../src/services/analysis/gameAnalyzer';
import { analysisLockName, setAnalysisLockManager } from '../src/services/analysis/analysisLock';
import { appStartupSteps, runStartupSteps, type StartupStep } from '../src/app/startup';
import { OPERA_GAME, SHORT_BLUNDER_GAME } from './fixtures';

// Audit FA-5 (Sprint 4.8): the start-up steps are independent; one that fails does not stop the others.

let n = 0;
beforeEach(() => {
  setDb(new ChessQuestDB(`startup-${++n}`));
  setAnalysisLockManager(undefined);
});

describe('runStartupSteps (audit FA-5)', () => {
  it('runs every step in order even when some fail, and reports the failures', async () => {
    const ran: string[] = [];
    const errors: string[] = [];
    const step = (name: string, fail = false): StartupStep => ({
      name,
      run: async () => {
        ran.push(name);
        if (fail) throw new Error(`${name} falhou`);
      },
    });
    const failed = await runStartupSteps([step('a', true), step('b'), step('c', true), step('d')], (name, e) => errors.push(`${name}: ${(e as Error).message}`));
    expect(ran).toEqual(['a', 'b', 'c', 'd']);
    expect(failed).toEqual(['a', 'c']);
    expect(errors).toEqual(['a: a falhou', 'c: c falhou']);
  });

  it('a step that throws synchronously does not stop the others either', async () => {
    const ran: string[] = [];
    const failed = await runStartupSteps(
      [
        {
          name: 'sync',
          run: () => {
            throw new Error('sync');
          },
        },
        { name: 'next', run: async () => void ran.push('next') },
      ],
      () => undefined,
    );
    expect(failed).toEqual(['sync']);
    expect(ran).toEqual(['next']);
  });

  it('the app opens with recovery first, then dating, cleaning and derivations', () => {
    expect(appStartupSteps().map((s) => s.name)).toEqual(['retomar análises', 'datar evidências', 'limpar evidências órfãs', 'concluir derivações']);
  });

  it('the real steps pause an orphan analysis and leave the one another tab runs (Sprint 4.8, T-1)', async () => {
    const live = (await getGame((await importPgn(OPERA_GAME, 'a.pgn', [])).imported[0]!.id))!;
    const orphan = (await getGame((await importPgn(SHORT_BLUNDER_GAME, 'b.pgn', [])).imported[0]!.id))!;
    await saveAnalysis({ ...emptyAnalysis(live, { depth: 10, multiPv: 1 }), status: 'running' });
    await saveAnalysis({ ...emptyAnalysis(orphan, { depth: 10, multiPv: 1 }), status: 'running' });
    let release: () => void = () => undefined;
    let held: Promise<unknown> = Promise.resolve();
    await new Promise<void>((granted) => {
      held = navigator.locks.request(analysisLockName(live.id), () => {
        granted();
        return new Promise<void>((r) => (release = r));
      });
    });
    const failed = await runStartupSteps(appStartupSteps());
    release();
    await held;
    expect(failed).toEqual([]);
    expect((await getAnalysis(live.id))?.status).toBe('running');
    expect((await getAnalysis(orphan.id))?.status).toBe('paused');
  });
});
