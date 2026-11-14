/**
 * Enforces ghost-voice.md on any generated narration:
 * - at most 2 sentences and 280 characters
 * - it may not name a service, or use a number, that is not in the facts it was given
 *   (it may hint, but it must never invent a signal)
 * Anything that breaks a rule falls back to the hand-written line.
 */

export const SERVICE_NAMES = ['storefront', 'cart', 'payments', 'worker', 'postgres', 'queue', 'toxiproxy', 'redis', 'database'];
export const MAX_SENTENCES = 2;
export const MAX_CHARS = 280;

export function splitSentences(text: string): string[] {
  return (
    text
      .replace(/\s+/g, ' ')
      .trim()
      .match(/[^.!?]+(?:[.!?]+|$)/g)
      ?.map((s) => s.trim())
      .filter((s) => /[A-Za-z0-9]/.test(s)) ?? []
  );
}

const numbersIn = (text: string) => new Set(text.match(/\d+(?:\.\d+)?/g) ?? []);
const servicesIn = (text: string) => {
  const lower = text.toLowerCase();
  return new Set(SERVICE_NAMES.filter((s) => new RegExp(`\\b${s}\\b`).test(lower)));
};

export type GuardResult = { ok: true; text: string } | { ok: false; reason: string };

export function checkNarration(candidate: string, facts: string): GuardResult {
  const sentences = splitSentences(candidate);
  if (sentences.length === 0) return { ok: false, reason: 'empty' };
  if (sentences.length > MAX_SENTENCES) return { ok: false, reason: `${sentences.length} sentences` };
  const text = sentences.join(' ');
  if (text.length > MAX_CHARS) return { ok: false, reason: 'too long' };

  const allowedNumbers = numbersIn(facts);
  for (const n of numbersIn(text)) if (!allowedNumbers.has(n)) return { ok: false, reason: `invented number ${n}` };
  const allowedServices = servicesIn(facts);
  for (const s of servicesIn(text)) if (!allowedServices.has(s)) return { ok: false, reason: `invented service ${s}` };
  return { ok: true, text };
}

/** Returns the candidate when it passes every rule, otherwise the fallback line. */
export function guardNarration(candidate: string | undefined, fallback: string, facts: string): string {
  if (candidate === undefined) return fallback;
  const r = checkNarration(candidate, `${fallback}\n${facts}`);
  return r.ok ? r.text : fallback;
}
