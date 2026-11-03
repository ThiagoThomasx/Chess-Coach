// Core domain types for ChessQuest. All evaluations stored here are
// normalized to WHITE's point of view unless a field says otherwise.

export type Color = 'w' | 'b';

/** Engine score. `cp` and `mate` are mutually exclusive. */
export type Score =
  | { kind: 'cp'; value: number }
  | { kind: 'mate'; value: number }; // value > 0: White mates in N; < 0: Black mates in N; 0 = side to move is mated

export interface EngineLine {
  multipv: number;
  /** Score normalized to White's perspective. */
  score: Score;
  /** Principal variation in UCI notation (e2e4, e7e8q). */
  pv: string[];
  depth: number;
}

export interface PositionAnalysis {
  fen: string;
  depth: number;
  multiPv: number;
  lines: EngineLine[];
  /** True when the search reached the requested limit; false if stopped early. */
  complete: boolean;
  timeMs: number;
  /** Move reported by `bestmove` (UCI). */
  bestMove?: string;
  /** Set for terminal positions evaluated without the engine. */
  terminal?: 'checkmate' | 'stalemate' | 'draw';
}

export interface GameHeaders {
  white: string;
  black: string;
  result: string;
  date?: string;
  event?: string;
  site?: string;
  timeControl?: string;
  whiteElo?: number;
  blackElo?: number;
  eco?: string;
  opening?: string;
}

export interface Game {
  id: string;
  /** Hash of normalized headers + moves, used to detect duplicates. */
  hash: string;
  headers: GameHeaders;
  /** Raw tag pairs as found in the PGN, preserved verbatim. */
  rawHeaders: Record<string, string>;
  /** Starting FEN (standard start position unless a SetUp/FEN tag exists). */
  startFen: string;
  moves: string[]; // SAN
  pgn: string;
  userColor?: Color;
  importId: string;
  importedAt: number;
  warnings: string[];
}

export interface ImportRecord {
  id: string;
  fileName: string;
  importedAt: number;
  totalFound: number;
  imported: number;
  duplicates: number;
  failures: { index: number; reason: string; snippet: string }[];
}

export type MoveClass = 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder' | 'inconclusive' | 'book';

export type MoveFlag =
  | 'mate_found'
  | 'mate_missed'
  | 'allowed_mate'
  | 'lost_winning_position'
  | 'lost_advantage'
  | 'lost_equality'
  | 'entered_inferior'
  | 'material_loss'
  | 'missed_tactic'
  | 'defense_needed'
  | 'opening_error'
  | 'only_move';

export interface MoveReview {
  ply: number; // 1-based ply index of the move in the game
  san: string;
  uci: string;
  color: Color;
  fenBefore: string;
  fenAfter: string;
  /** White-POV evaluations. */
  evalBefore: Score;
  evalAfter: Score;
  bestMoveUci?: string;
  bestMoveSan?: string;
  bestLine: string[]; // UCI
  /** Win expectancy (0–100) for the mover, before and after. */
  winBefore: number;
  winAfter: number;
  winLoss: number;
  /** Centipawn loss for the mover, only when both scores are cp. */
  cpLoss?: number;
  classification: MoveClass;
  flags: MoveFlag[];
  depth: number;
  reason?: string; // why inconclusive, if applicable
}

export type AnalysisStatus = 'pending' | 'running' | 'paused' | 'complete' | 'error';

export interface AnalysisSettings {
  depth: number;
  multiPv: number;
}

export interface GameAnalysis {
  gameId: string;
  status: AnalysisStatus;
  settings: AnalysisSettings;
  /** Index i = position after i plies (0 = start). */
  positions: (PositionAnalysis | null)[];
  reviews: MoveReview[];
  error?: string;
  startedAt: number;
  updatedAt: number;
}

export interface Bookmark {
  id: string;
  gameId: string;
  ply: number;
  fen: string;
  note: string;
  createdAt: number;
  reviewedAt?: number;
}

export type Skill =
  | 'tactics'
  | 'calculation'
  | 'threats'
  | 'defense'
  | 'strategy'
  | 'openings'
  | 'endgames'
  | 'patterns';

export type Theme =
  | 'hanging_piece'
  | 'ignored_threat'
  | 'removed_defender'
  | 'missed_capture'
  | 'fork'
  | 'missed_check'
  | 'mate_threat'
  | 'missed_mate'
  | 'allowed_mate'
  | 'defense'
  | 'positional'
  | 'opening'
  | 'endgame'
  | 'pin'
  | 'discovered_attack'
  | 'overloaded'
  | 'deflection'
  | 'losing_capture'
  | 'combination'
  | 'conversion';

export interface SrsState {
  box: number;
  dueAt: number;
  lastReviewedAt?: number;
}

export interface AcceptableMove {
  uci: string;
  san: string;
  score: Score; // White POV
}

/**
 * single: one move; sequence: a forcing line of several moves; mate: forced mate;
 * conversion: keep a winning advantage over several moves; defense: hold the position.
 */
export type ExerciseKind = 'single' | 'sequence' | 'mate' | 'conversion' | 'defense';

export interface ExerciseGoal {
  kind: ExerciseKind;
  /** Hard cap on user moves before the exercise ends (termination rule). */
  maxUserMoves: number;
  /** Win% (solver's POV) of the reference line; every user move must stay within `tolerance` of the node's best. */
  targetWin: number;
  mateIn?: number;
}

/** One opponent reply (engine-equivalent defenses can branch). `next` null = line ends here. */
export interface ReplyBranch {
  uci: string;
  san: string;
  score: Score; // White POV, after the reply
  next: SolutionNode | null;
}

/** A position where the solver is to move. */
export interface SolutionNode {
  fen: string;
  /** Moves within tolerance of the best, from a MultiPV search of this node. */
  accepted: AcceptableMove[];
  /** Opponent replies computed after each expanded user move (keyed by user UCI). Empty array = terminal. */
  replies: Record<string, ReplyBranch[]>;
  depth: number;
}

export interface Exercise {
  id: string;
  fen: string;
  source: 'game' | 'opening';
  gameId?: string;
  ply?: number;
  sideToMove: Color;
  objective: string;
  theme: Theme;
  skill: Skill;
  bestMove: AcceptableMove;
  acceptableMoves: AcceptableMove[];
  /** Forced solution line (UCI) starting with a user move; validated move-by-move. */
  solutionLine: string[];
  referenceLines: EngineLine[];
  difficulty: number; // 1..5
  ambiguous: boolean;
  /** Win% tolerance for accepting alternatives. */
  tolerance: number;
  createdAt: number;
  srs: SrsState;
  analysisDepth: number;
  /** Added in schema v2; legacy exercises are normalized on read. */
  kind?: ExerciseKind;
  goal?: ExerciseGoal;
  tree?: SolutionNode;
}

export interface Attempt {
  id?: number;
  exerciseId: string;
  at: number;
  correct: boolean;
  hintsUsed: number;
  revealed: boolean;
  timeMs: number;
  moves: string[];
}

export type EvidenceSource = 'exercise' | 'game' | 'opening';

export interface SkillEvent {
  id?: number;
  skill: Skill;
  at: number;
  /** 1 success, 0 failure; fractional for partial credit. */
  outcome: number;
  weight: number;
  independent: boolean;
  difficulty?: number;
  source: EvidenceSource;
  ref: { gameId?: string; ply?: number; exerciseId?: string; lineId?: string };
}

export type ConfidenceLevel = 'insufficient' | 'initial' | 'consistent' | 'provisional_mastery' | 'needs_review';

export interface SkillEstimate {
  skill: Skill;
  /** Posterior mean success rate 0..1, or null without evidence. */
  level: number | null;
  /** 90% credible interval of the success rate. */
  interval: [number, number] | null;
  evidence: number; // effective weighted count
  events: number;
  recentRate: number | null;
  independentRate: number | null;
  assistedRate: number | null;
  trend: 'up' | 'down' | 'stable' | 'unknown';
  confidence: ConfidenceLevel;
  targetDifficulty: number;
  lastAt?: number;
}

export interface OpeningLine {
  id: string;
  name: string;
  moves: string[]; // SAN
  comment?: string;
}

export interface Opening {
  id: string;
  name: string;
  eco: string;
  side: Color;
  mainLine: OpeningLine;
  variations: OpeningLine[];
  goals: string[];
  tacticalIdeas: string[];
  commonMistakes: string[];
  custom?: boolean;
}

export interface RepertoireEntry {
  id: string; // `${openingId}:${lineId}`
  openingId: string;
  lineId: string;
  side: Color;
  addedAt: number;
  srs: SrsState;
}

export interface OpeningAttempt {
  id?: number;
  openingId: string;
  lineId: string;
  at: number;
  correct: boolean;
  errorPly?: number;
}

export interface Settings {
  id: 'app';
  analysisDepth: number;
  quickDepth: number;
  multiPv: number;
  playerNames: string[];
  boardOrientation: 'auto' | 'white' | 'black';
  appTheme: 'dark' | 'light';
  boardTheme: 'slate' | 'walnut' | 'olive';
  showCoordinates: boolean;
  animationMs: number;
  thresholds: ClassificationThresholds;
  exerciseTolerance: number;
  maxExercisesPerGame: number;
  srsIntervalsDays: number[];
  dailyGoal: number;
}

export interface ClassificationThresholds {
  /** Win% loss upper bounds for each class (exclusive). */
  excellent: number;
  good: number;
  inaccuracy: number;
  mistake: number;
  /** Minimum depth for a non-inconclusive verdict. */
  minDepth: number;
}
