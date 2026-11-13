// fast-check generators for valid hauntings that target the fake sandbox topology.
// Pools are small on purpose, so generated hauntings often touch the same resources
// and overlapping faults get tested.

import fc from 'fast-check';
import type {
  ConfigFault,
  DebugEndpointFault,
  DockerFault,
  EscalationStep,
  FaultSpec,
  Haunting,
  ToxiproxyFault,
} from '../../src/haunting/types.js';
import { APP_SERVICES, SERVICES } from '../../src/haunting/types.js';
import { DEFAULT_TOPOLOGY } from './fake-sandbox.js';

const topo = DEFAULT_TOPOLOGY;

const scalarArb = fc.oneof(fc.integer({ min: -1000, max: 100000 }), fc.boolean(), fc.string({ maxLength: 12 }));

export const toxiproxyFaultArb: fc.Arbitrary<ToxiproxyFault> = fc.oneof(
  fc
    .record(
      {
        proxy: fc.constantFrom(...topo.proxies),
        toxic: fc.constant('latency' as const),
        latency: fc.integer({ min: 1, max: 30000 }),
        jitter: fc.integer({ min: 0, max: 10000 }),
        stream: fc.constantFrom('upstream' as const, 'downstream' as const),
        toxicity: fc.double({ min: 0, max: 1, noNaN: true }),
      },
      { requiredKeys: ['proxy', 'toxic', 'latency'] },
    )
    .map((params) => ({ type: 'toxiproxy' as const, params })),
  fc
    .record(
      {
        proxy: fc.constantFrom(...topo.proxies),
        toxic: fc.constant('timeout' as const),
        timeout: fc.integer({ min: 0, max: 60000 }),
        stream: fc.constantFrom('upstream' as const, 'downstream' as const),
        toxicity: fc.double({ min: 0, max: 1, noNaN: true }),
      },
      { requiredKeys: ['proxy', 'toxic', 'timeout'] },
    )
    .map((params) => ({ type: 'toxiproxy' as const, params })),
);

export const dockerFaultArb: fc.Arbitrary<DockerFault> = fc
  .record({ service: fc.constantFrom(...SERVICES), action: fc.constantFrom('stop' as const, 'pause' as const) })
  .map((params) => ({ type: 'docker' as const, params }));

export const configFaultArb: fc.Arbitrary<ConfigFault> = fc
  .constantFrom(...APP_SERVICES)
  .chain((service) =>
    fc.record({
      service: fc.constant(service),
      key: fc.constantFrom(...Object.keys(topo.config[service]!)),
      value: scalarArb,
    }),
  )
  .map((params) => ({ type: 'config' as const, params }));

export const debugFaultArb: fc.Arbitrary<DebugEndpointFault> = fc
  .record(
    {
      service: fc.constantFrom(...APP_SERVICES),
      toggle: fc.constantFrom(...topo.toggles),
      settings: fc.dictionary(fc.constantFrom('rate', 'size_mb', 'mode'), scalarArb, { maxKeys: 3 }),
    },
    { requiredKeys: ['service', 'toggle'] },
  )
  .map((params) => ({ type: 'debug-endpoint' as const, params }));

export const faultArb: fc.Arbitrary<FaultSpec> = fc.oneof(toxiproxyFaultArb, dockerFaultArb, configFaultArb, debugFaultArb);

const escalationArb: fc.Arbitrary<EscalationStep[]> = fc
  .array(fc.tuple(fc.integer({ min: 1, max: 300 }), fc.array(faultArb, { maxLength: 2 })), { maxLength: 3 })
  .map((steps) => {
    let t = 0;
    return steps.map(([gap, faults], i) => {
      t += gap;
      return { step: i + 1, afterSeconds: t, narration: `Step ${i + 1} deepens the haunting.`, faults };
    });
  });

const harmfulPool = [
  'haunt restart storefront',
  'haunt restart postgres',
  'haunt restart payments',
  'haunt purge-queue orders',
  'haunt restart queue',
];

export function hauntingArb(id: string): fc.Arbitrary<Haunting> {
  return fc
    .record({
      fault: faultArb,
      escalation: escalationArb,
      difficulty: fc.constantFrom('easy' as const, 'medium' as const, 'hard' as const),
      harmful: fc.subarray(harmfulPool),
      penalties: fc.array(fc.integer({ min: 1, max: 100 }), { minLength: harmfulPool.length, maxLength: harmfulPool.length }),
      par: fc.integer({ min: 30, max: 3600 }),
    })
    .map(({ fault, escalation, difficulty, harmful, penalties, par }) => {
      const target = 'service' in fault.params ? fault.params.service : 'storefront';
      return {
        id,
        name: `Generated ${id}`,
        difficulty,
        target,
        page: { alert: `Alert for ${id}`, narration: 'Something stirs in the sandbox.' },
        fault,
        escalation,
        signals: [
          {
            id: 'sig',
            kind: 'symptom' as const,
            description: 'generated signal',
            source: 'prometheus' as const,
            query: `sig_${id.replace(/-/g, '_')}`,
            expect: { op: '>' as const, value: 0 },
          },
        ],
        verify: [
          {
            id: 'chk',
            description: 'generated check',
            source: 'prometheus' as const,
            query: `chk_${id.replace(/-/g, '_')}`,
            expect: { op: '>=' as const, value: 1 },
          },
        ],
        rootCause: {
          component: target,
          summary: 'generated root cause',
          keywords: [['ghost'], ['fault', 'broken']],
          minKeywordMatches: 1,
        },
        fix: { summary: 'generated fix', actions: [`haunt scale ${target} 2`] },
        harmfulActions: harmful.map((action, i) => ({ action, penalty: penalties[i]!, reason: 'generated' })),
        scoring: { detectParSeconds: par },
      } satisfies Haunting;
    });
}

/** Two hauntings with different ids. */
export const hauntingPairArb = fc.tuple(hauntingArb('h-alpha'), hauntingArb('h-beta'));
