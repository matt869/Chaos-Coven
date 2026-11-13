// The other properties are only meaningful if the generators produce real, valid
// hauntings. This checks that every generated haunting passes the schema and the
// loader's semantic rules.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createValidator } from '../../src/haunting/loader.js';
import { hauntingArb } from '../support/arbitraries.js';
import { loadSchema } from '../support/setup.js';

describe('generated hauntings', () => {
  it('are always valid against hauntings/schema.json', () => {
    const validator = createValidator(loadSchema());
    fc.assert(
      fc.property(hauntingArb('h-gen'), (h) => {
        expect(validator.problems(structuredClone(h), 'h-gen.yaml')).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });
});
