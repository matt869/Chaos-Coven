// TypeScript view of hauntings/schema.json. Keep the two in sync: the schema is
// the source of truth at load time, these types are the source of truth in code.

export const SERVICES = ['storefront', 'cart', 'payments', 'worker', 'postgres', 'queue'] as const;
export type ServiceName = (typeof SERVICES)[number];

/** Services that expose /__admin/config and /__debug endpoints. */
export const APP_SERVICES = ['storefront', 'cart', 'payments', 'worker'] as const;
export type AppServiceName = (typeof APP_SERVICES)[number];

export type Difficulty = 'easy' | 'medium' | 'hard';
export type QuerySource = 'prometheus' | 'loki';
export type ComparisonOp = '>' | '>=' | '<' | '<=' | '==' | '!=';

export interface Comparison {
  op: ComparisonOp;
  value: number;
}

export type Scalar = string | number | boolean;

interface ToxiproxyCommon {
  proxy: string;
  stream?: 'upstream' | 'downstream';
  toxicity?: number;
}

export type ToxiproxyParams =
  | (ToxiproxyCommon & { toxic: 'latency'; latency: number; jitter?: number })
  | (ToxiproxyCommon & { toxic: 'timeout'; timeout: number });

export interface ToxiproxyFault {
  type: 'toxiproxy';
  params: ToxiproxyParams;
}

export interface DockerFault {
  type: 'docker';
  params: { service: ServiceName; action: 'stop' | 'pause' };
}

export interface ConfigFault {
  type: 'config';
  params: { service: AppServiceName; key: string; value: Scalar };
}

export interface DebugEndpointFault {
  type: 'debug-endpoint';
  params: { service: AppServiceName; toggle: string; settings?: Record<string, Scalar> };
}

export type FaultSpec = ToxiproxyFault | DockerFault | ConfigFault | DebugEndpointFault;
export type FaultType = FaultSpec['type'];

export interface EscalationStep {
  step: number;
  afterSeconds: number;
  narration: string;
  faults: FaultSpec[];
}

export interface QueryDefinition {
  id: string;
  description: string;
  source: QuerySource;
  query: string;
  expect: Comparison;
  /** Used when the query returns no series. */
  emptyValue?: number;
}

export interface SignalDefinition extends QueryDefinition {
  kind: 'symptom' | 'cause' | 'red-herring';
}

export type VerifyCheck = QueryDefinition;

export interface HarmfulAction {
  action: string;
  penalty: number;
  reason: string;
}

export interface Haunting {
  id: string;
  name: string;
  difficulty: Difficulty;
  target: ServiceName;
  page: { alert: string; narration: string };
  fault: FaultSpec;
  escalation: EscalationStep[];
  signals: SignalDefinition[];
  verify: VerifyCheck[];
  rootCause: {
    component: ServiceName;
    summary: string;
    keywords: string[][];
    minKeywordMatches: number;
  };
  fix: { summary: string; actions: string[] };
  harmfulActions: HarmfulAction[];
  scoring: { detectParSeconds: number };
}

/** Normalizes a terminal command so `haunt  Restart   worker ` matches `haunt restart worker`. */
export function normalizeCommand(command: string): string {
  return command.trim().split(/\s+/).join(' ').toLowerCase();
}
