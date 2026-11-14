import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import { guardNarration } from './guard.js';

export type NarrationKind = 'page' | 'escalation' | 'hint' | 'postmortem';

export interface NarrationRequest {
  kind: NarrationKind;
  /** The hand-written line. Used as-is when generation fails or breaks a rule. */
  fallback: string;
  /** True statements the narration may draw on. Nothing else may be claimed. */
  facts: string[];
}

export interface Narrator {
  narrate(req: NarrationRequest): Promise<string>;
}

/** Uses the haunting's hand-written lines. The default, and what tests use. */
export class StaticNarrator implements Narrator {
  async narrate(req: NarrationRequest): Promise<string> {
    return req.fallback;
  }
}

const SYSTEM = `You are the narrator of Witching Hour, an on-call training game where ghosts haunt a small online shop.
Rewrite the line you are given in the narrator's voice.

Rules:
- Spooky in tone, but technically precise. Use the real names of services, metrics and errors.
- At most 2 sentences.
- Use only the facts you are given. Never mention a service, metric, number, log line or symptom that is not in them.
- You may hint at where to look. Never tell the player to ignore real evidence, and never state the root cause unless the facts say it is time to reveal it.
- Reply with the narration only: no quotes, no preamble.`;

export interface BedrockNarratorOptions {
  /** Bedrock model id. Defaults to Claude Opus 5.5 on Bedrock. */
  model?: string;
  awsRegion?: string;
  client?: Pick<AnthropicBedrockMantle, 'messages'>;
  onError?: (err: unknown) => void;
}

export const DEFAULT_BEDROCK_MODEL = 'anthropic.claude-opus-5-5';

/**
 * Generates narration with Claude on Amazon Bedrock. Credentials come from the
 * standard AWS chain (an IAM role in deployment); no keys are read from code or config.
 * Every reply goes through the ghost-voice guard, and any failure, refusal or rule
 * break falls back to the hand-written line, so narration can never invent a signal.
 */
export class BedrockNarrator implements Narrator {
  private readonly client: Pick<AnthropicBedrockMantle, 'messages'>;
  private readonly model: string;

  constructor(private readonly opts: BedrockNarratorOptions = {}) {
    this.client = opts.client ?? new AnthropicBedrockMantle({ awsRegion: opts.awsRegion });
    this.model = opts.model ?? DEFAULT_BEDROCK_MODEL;
  }

  async narrate(req: NarrationRequest): Promise<string> {
    const facts = req.facts.join('\n');
    try {
      const response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: 2000,
          // Short creative rewrites need little reasoning.
          output_config: { effort: 'low' },
          system: SYSTEM,
          messages: [
            {
              role: 'user',
              content: `Kind of line: ${req.kind}\n\nLine to rewrite:\n${req.fallback}\n\nFacts you may use:\n${facts || '(none beyond the line itself)'}`,
            },
          ],
        },
        { timeout: 15_000 },
      );
      if (response.stop_reason !== 'end_turn') return req.fallback;
      const text = response.content
        .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join(' ')
        .trim();
      return guardNarration(text, req.fallback, facts);
    } catch (err) {
      this.opts.onError?.(err);
      return req.fallback;
    }
  }
}
