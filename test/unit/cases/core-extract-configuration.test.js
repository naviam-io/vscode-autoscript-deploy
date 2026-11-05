/*
 * Unit tests for merging extracted JSON configuration into a configuration file.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CONFIGURATION_TYPES, mergeConfiguration } from '../../../src/core/extract/extract-configuration.js';

const type = (group) => CONFIGURATION_TYPES.find((candidate) => candidate.group === group);

describe('mergeConfiguration', () => {
    it('writes a new document when the file is blank', () => {
        assert.deepStrictEqual(JSON.parse(mergeConfiguration('  ', type('properties'), [{ propName: 'a' }])), { properties: [{ propName: 'a' }] });
    });

    it('replaces matching entries, keeps the rest, and sorts', () => {
        const existing = JSON.stringify({ properties: [{ propName: 'b', v: 1 }, { propName: 'a', v: 1 }] });
        const merged = JSON.parse(mergeConfiguration(existing, type('properties'), [{ propName: 'a', v: 2 }]));
        assert.deepStrictEqual(merged.properties, [{ propName: 'a', v: 2 }, { propName: 'b', v: 1 }]);
    });

    it('refuses a manifest, which the command copies to the clipboard instead', () => {
        assert.strictEqual(mergeConfiguration(JSON.stringify({ manifest: [] }), type('properties'), []), null);
    });

    it('refuses text that is not JSON', () => {
        assert.strictEqual(mergeConfiguration('{ nope', type('properties'), []), null);
    });
});
