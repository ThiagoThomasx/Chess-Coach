import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowUpRight } from 'lucide-react';
import { getDb } from '../../db/database';
import { CLASS_LABEL } from '../../services/analysis/classify';
import { exerciseOrigin, gameRef, type OriginMover } from '../../services/exercises/origin';
import type { Exercise, MoveReview } from '../../types/domain';

const PLAYED_BY: Record<OriginMover, string> = {
  you: 'você jogou',
  opponent: 'seu adversário jogou',
  unknown: 'foi jogado',
};

/** Loading sentinel: the game query answers the game or `null` (not found); the review query a review or `undefined`. */
const LOADING = 'loading' as const;

/**
 * The stored review of one move, read once when the origin is shown. Not a
 * live query: the analysis record carries every position, and a running
 * analysis saves progress every 2 s (PA-1), which would re-read it each time.
 */
function useMoveReview(gameId: string | undefined, ply: number | undefined): MoveReview | undefined | typeof LOADING {
  const [review, setReview] = useState<MoveReview | undefined | typeof LOADING>(LOADING);
  useEffect(() => {
    if (!gameId || !ply) return;
    let alive = true;
    getDb()
      .analyses.get(gameId)
      .then((a) => alive && setReview(a?.reviews.find((r) => r.ply === ply)))
      .catch((e: unknown) => {
        // Without the analysis the origin still names the game and the move; only the classification is left out.
        console.error('ChessQuest: falha ao ler a análise da partida de origem', e);
        if (alive) setReview(undefined);
      });
    return () => {
      alive = false;
    };
  }, [gameId, ply]);
  return review;
}

/**
 * Where a game-derived exercise came from (Sprint 4.6, B2): the game, the move
 * played there and what its stored analysis said, with a link back to that
 * move. Rendered by the solver only once the attempt is solved or revealed.
 * Nothing for exercises without a game.
 */
export function ExerciseOrigin({ ex }: { ex: Exercise }) {
  const ref = gameRef(ex);
  const game = useLiveQuery(async () => (ref ? ((await getDb().games.get(ref.gameId)) ?? null) : null), [ref?.gameId], LOADING);
  const review = useMoveReview(ref?.gameId, ref?.ply);
  // Rendered once both answers are in, so the summary does not grow after it appears.
  if (!ref || game === LOADING || review === LOADING) return null;
  const origin = exerciseOrigin(ex, game ?? undefined, review);

  return (
    <section className="panel fade-in origin-panel" aria-labelledby="origin-title" data-testid="exercise-origin">
      <h2 id="origin-title">De onde veio este exercício</h2>
      {origin ? (
        <div className="stack" style={{ gap: '0.45rem', marginTop: '0.55rem' }}>
          <p className="small">
            Este exercício surgiu de uma posição da partida <strong>{origin.gameTitle}</strong>
            {origin.date ? ` (${origin.date})` : ''}.
          </p>
          <p className="small" data-testid="origin-summary">
            Na partida, {PLAYED_BY[origin.mover]} <span className="mono">{origin.playedLabel}</span>
            {origin.classification ? ` — classificado como ${CLASS_LABEL[origin.classification].toLowerCase()}` : ''}
            {origin.winLoss !== undefined && origin.winLoss > 0 ? `, com perda de ${origin.winLoss.toFixed(1)} p.p. de expectativa de vitória` : ''}.
            {origin.bestSan ? (
              <>
                {' '}
                O melhor lance era <span className="mono">{origin.bestSan}</span>.
              </>
            ) : null}
          </p>
          <Link to={origin.href} className="small touch-link origin-link" data-testid="origin-link" aria-label={`Revisar o lance na partida: ${origin.playedLabel}, ${origin.gameTitle}`}>
            Revisar o lance na partida <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <p className="small muted" style={{ marginTop: '0.55rem' }} data-testid="origin-missing">
          {game ? 'A posição deste exercício não corresponde mais ao lance registrado na partida; o link de volta não está disponível.' : 'A partida de origem não está mais disponível.'}
        </p>
      )}
    </section>
  );
}
