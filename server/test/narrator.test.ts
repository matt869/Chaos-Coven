import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BedrockNarrator, DEFAULT_BEDROCK_MODEL, StaticNarrator } from '../src/narrator/bedrock.js';
import { checkNarration, guardNarration, MAX_SENTENCES, SERVICE_NAMES, splitSentences } from '../src/narrator/guard.js';

const FALLBACK = 'The orders queue keeps getting deeper. Nothing is taking from it.';

describe('guard', () => {
  it('accepts a faithful two-sentence rewrite', () => {
    expect(checkNarration('The orders queue swells in the dark. No hand reaches in to take from it.', FALLBACK).ok).toBe(true);
  });

  it.each([
    ['three sentences', 'One. Two. Three.'],
    ['an invented service', 'The payments service is bleeding. Look there.'],
    ['an invented number', 'The queue holds 9000 orders now.'],
  ])('rejects %s', (_why, text) => {
    expect(checkNarration(text, FALLBACK).ok).toBe(false);
    expect(guardNarration(text, FALLBACK, '')).toBe(FALLBACK);
  });

  it('allows services and numbers that are in the facts', () => {
    expect(guardNarration('The worker has gone quiet for 300 seconds.', FALLBACK, 'worker stopped; escalation at 300 seconds')).toBe(
      'The worker has gone quiet for 300 seconds.',
    );
  });

  it('never lets through more than 2 sentences, or a service or number not in the facts', () => {
    const word = fc.constantFrom('the', 'ghost', 'queue', 'grows', 'dark', ...SERVICE_NAMES, '42', '7', '3.5');
    const sentence = fc.array(word, { minLength: 1, maxLength: 8 }).map((w) => `${w.join(' ')}${'.'}`);
    fc.assert(
      fc.property(fc.array(sentence, { minLength: 0, maxLength: 5 }), fc.array(word, { maxLength: 6 }), (sentences, factWords) => {
        const facts = factWords.join(' ');
        const out = guardNarration(sentences.join(' '), FALLBACK, facts);
        if (out === FALLBACK) return;
        expect(splitSentences(out).length).toBeLessThanOrEqual(MAX_SENTENCES);
        const allowed = `${FALLBACK} ${facts}`.toLowerCase();
        for (const n of out.match(/\d+(?:\.\d+)?/g) ?? []) expect(allowed).toContain(n);
        for (const s of SERVICE_NAMES) if (new RegExp(`\\b${s}\\b`).test(out.toLowerCase())) expect(allowed).toMatch(new RegExp(`\\b${s}\\b`));
      }),
      { numRuns: 1000 },
    );
  });
});

function fakeClient(reply: { stop_reason: string; text?: string } | Error) {
  const calls: unknown[] = [];
  return {
    calls,
    client: {
      messages: {
        create: async (params: unknown) => {
          calls.push(params);
          if (reply instanceof Error) throw reply;
          return { stop_reason: reply.stop_reason, content: reply.text === undefined ? [] : [{ type: 'text', text: reply.text }] };
        },
      },
    },
  };
}

describe('BedrockNarrator', () => {
  const req = { kind: 'escalation' as const, fallback: FALLBACK, facts: ['orders queue'] };

  it('calls Claude Opus 5.5 on Bedrock with low effort and returns a guarded line', async () => {
    const { client, calls } = fakeClient({ stop_reason: 'end_turn', text: 'The orders queue swells. Nothing drains it.' });
    const n = new BedrockNarrator({ client: client as never });
    expect(await n.narrate(req)).toBe('The orders queue swells. Nothing drains it.');
    expect(calls[0]).toMatchObject({ model: DEFAULT_BEDROCK_MODEL, output_config: { effort: 'low' } });
    expect(DEFAULT_BEDROCK_MODEL).toBe('anthropic.claude-opus-5-5');
  });

  it.each([
    ['an error', new Error('throttled')],
    ['a refusal', { stop_reason: 'refusal' }],
    ['a truncated reply', { stop_reason: 'max_tokens', text: 'The orders' }],
    ['a reply that breaks the rules', { stop_reason: 'end_turn', text: 'Payments is down. Cart too. Postgres also.' }],
  ])('falls back to the hand-written line on %s', async (_why, reply) => {
    const errors: unknown[] = [];
    const n = new BedrockNarrator({ client: fakeClient(reply as never).client as never, onError: (e) => errors.push(e) });
    expect(await n.narrate(req)).toBe(FALLBACK);
  });

  it('static narrator returns the hand-written line', async () => {
    expect(await new StaticNarrator().narrate(req)).toBe(FALLBACK);
  });
});
