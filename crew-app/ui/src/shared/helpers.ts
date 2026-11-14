import type { DrillResult } from './types';

export const fmtTime = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export const fmtSeconds = (s: number | null) => (s === null ? 'not detected' : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`);

/** Splits a comma or newline separated list of names. */
export function parsePlayers(text: string): string[] {
  return [...new Set(text.split(/[,\n]/).map((p) => p.trim()).filter(Boolean))];
}

export function teamAverage(results: DrillResult[]): number | null {
  if (results.length === 0) return null;
  return Math.round(results.reduce((s, r) => s + r.score, 0) / results.length);
}

/** Where players play: the game server's player view. */
export const PLAYER_VIEW_URL = 'http://127.0.0.1:4000/';
