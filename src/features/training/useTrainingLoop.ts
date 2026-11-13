import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../../db/database';
import { listCompleteAnalyses } from '../../db/analysisRepo';
import { useMinute } from '../../hooks/useMinute';
import { estimateProfile } from '../../services/adaptation/skills';
import { nextTraining, type Recommendation } from '../../services/recommendations/recommend';
import { toAnalyzedInputs } from '../../services/stats/stats';
import { isDueReview } from '../../services/scheduling/srs';
import type { Attempt, Exercise, Skill, SkillEstimate } from '../../types/domain';

export interface TrainingLoop {
  exercises: Exercise[];
  attempts: Attempt[];
  profile: SkillEstimate[];
  targets: Map<Skill, number>;
  recommendation: Recommendation;
  dueReviews: number;
}

/**
 * Live snapshot of everything the recommendation depends on. Being a live
 * query, a recorded attempt updates the recommendation without a reload.
 */
export function useTrainingLoop(): TrainingLoop | undefined {
  // Re-read every minute too: a review that falls due while the session screen is open counts (audit AC-4, as FA-4).
  const minute = useMinute();
  return useLiveQuery(async () => {
    const db = getDb();
    const [games, analyses, exercises, attempts, events] = await Promise.all([db.games.toArray(), listCompleteAnalyses(), db.exercises.toArray(), db.attempts.orderBy('at').toArray(), db.skillEvents.toArray()]);
    const now = Date.now();
    const profile = estimateProfile(events, now);
    const dueReviews = exercises.filter((e) => isDueReview(e.srs, now)).length;
    const recommendation = nextTraining({ games: toAnalyzedInputs(games, analyses), dueReviews, totalGames: games.length, profile, exercises, attempts });
    return { exercises, attempts, profile, targets: new Map(profile.map((s) => [s.skill, s.targetDifficulty])), recommendation, dueReviews };
  }, [minute]);
}
