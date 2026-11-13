import { normalizeCommand, type Haunting, type ServiceName } from '../haunting/types.js';

/**
 * Deterministic scoring rubric. No LLM is involved: the same run always gets the
 * same score.
 *
 *   Detection   30  full points within detectParSeconds, falling linearly to 0 at 4x par
 *   Root cause  30  10 for the right component, 20 for matching enough keyword groups
 *                   (keyword points need the right component)
 *   Fix         40  only when verify() passed
 *   Penalties       each harmful action subtracts its penalty, every time it is run
 *
 * The total is clamped to 0-100.
 */
export const RUBRIC_VERSION = 1;

export const MAX_POINTS = { detection: 30, rootCauseComponent: 10, rootCauseKeywords: 20, fix: 40 } as const;
export const MAX_SCORE = 100;

export interface PlayerAction {
  /** Milliseconds since epoch. */
  at: number;
  command: string;
}

export interface RunRecord {
  hauntingId: string;
  /** When the haunting was applied (ms since epoch). */
  startedAt: number;
  /** When the player first identified the failing component, if they did. */
  detectedAt?: number;
  diagnosis?: { component: ServiceName | string; summary: string };
  fixVerified: boolean;
  actions: PlayerAction[];
}

export interface ScoreBreakdown {
  rubricVersion: number;
  total: number;
  max: number;
  detection: { points: number; max: number; seconds: number | null; parSeconds: number };
  rootCause: {
    points: number;
    max: number;
    componentCorrect: boolean;
    keywordGroupsMatched: number;
    keywordGroupsRequired: number;
  };
  fix: { points: number; max: number; verified: boolean };
  penalties: { points: number; items: { command: string; at: number; penalty: number; reason: string }[] };
}

export function scoreRun(haunting: Haunting, run: RunRecord): ScoreBreakdown {
  if (run.hauntingId !== haunting.id) {
    throw new Error(`Run is for "${run.hauntingId}" but was scored against "${haunting.id}"`);
  }

  const detection = scoreDetection(haunting.scoring.detectParSeconds, run);
  const rootCause = scoreRootCause(haunting, run);
  const fix = { points: run.fixVerified ? MAX_POINTS.fix : 0, max: MAX_POINTS.fix, verified: run.fixVerified };

  const harmful = new Map(haunting.harmfulActions.map((a) => [normalizeCommand(a.action), a]));
  const items: ScoreBreakdown['penalties']['items'] = [];
  for (const action of run.actions) {
    const match = harmful.get(normalizeCommand(action.command));
    if (match !== undefined) {
      items.push({ command: action.command, at: action.at, penalty: match.penalty, reason: match.reason });
    }
  }
  const penaltyPoints = items.reduce((sum, i) => sum + i.penalty, 0);

  const raw = detection.points + rootCause.points + fix.points - penaltyPoints;
  return {
    rubricVersion: RUBRIC_VERSION,
    total: Math.min(MAX_SCORE, Math.max(0, raw)),
    max: MAX_SCORE,
    detection,
    rootCause,
    fix,
    penalties: { points: penaltyPoints, items },
  };
}

function scoreDetection(parSeconds: number, run: RunRecord): ScoreBreakdown['detection'] {
  const max = MAX_POINTS.detection;
  if (run.detectedAt === undefined || run.detectedAt < run.startedAt) {
    return { points: 0, max, seconds: null, parSeconds };
  }
  const seconds = (run.detectedAt - run.startedAt) / 1000;
  let points: number;
  if (seconds <= parSeconds) points = max;
  else if (seconds >= 4 * parSeconds) points = 0;
  else points = Math.floor((max * (4 * parSeconds - seconds)) / (3 * parSeconds));
  return { points, max, seconds, parSeconds };
}

function scoreRootCause(h: Haunting, run: RunRecord): ScoreBreakdown['rootCause'] {
  const max = MAX_POINTS.rootCauseComponent + MAX_POINTS.rootCauseKeywords;
  const required = h.rootCause.minKeywordMatches;
  const d = run.diagnosis;
  const componentCorrect = d !== undefined && d.component.trim().toLowerCase() === h.rootCause.component;
  if (!componentCorrect) {
    return { points: 0, max, componentCorrect, keywordGroupsMatched: 0, keywordGroupsRequired: required };
  }
  const text = d.summary.toLowerCase();
  const matched = h.rootCause.keywords.filter((group) => group.some((k) => text.includes(k.toLowerCase()))).length;
  const keywordPoints = Math.floor((MAX_POINTS.rootCauseKeywords * Math.min(matched, required)) / required);
  return {
    points: MAX_POINTS.rootCauseComponent + keywordPoints,
    max,
    componentCorrect,
    keywordGroupsMatched: matched,
    keywordGroupsRequired: required,
  };
}
