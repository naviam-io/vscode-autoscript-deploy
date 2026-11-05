/*
 * Unit tests for processPayload: every entry is built, then every type is prepared, before any entry is
 * applied, so a failure in either step leaves Maximo unchanged.
 *
 *   npm run package:library && npm run test:unit
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';

import { loadScriptFunctions } from '../harness.js';

const { processPayload } = loadScriptFunctions('resources/naviam.autoscript.library.js', ['processPayload'], {});

function registry(calls, failPrepare) {
    function model(type) {
        return function (input) {
            calls.push('build ' + type + ' ' + input.id);
            this.id = input.id;
        };
    }
    return {
        first: {
            model: model('first'),
            process: (record) => calls.push('process first ' + record.id)
        },
        second: {
            model: model('second'),
            prepare: (records) => {
                calls.push('prepare second ' + records.map((record) => record.id).join(','));
                if (failPrepare) {
                    throw new Error('prepare failed');
                }
            },
            process: (record) => calls.push('process second ' + record.id)
        }
    };
}

describe('processPayload', () => {
    it('builds everything, then prepares, then processes, in payload order', () => {
        const calls = [];
        processPayload({ second: [{ id: 'a' }, { id: 'b' }], unknown: 'ignored', first: [{ id: 'c' }] }, registry(calls, false));
        assert.deepStrictEqual(calls, ['build second a', 'build second b', 'build first c', 'prepare second a,b', 'process second a', 'process second b', 'process first c']);
    });

    it('processes nothing when a prepare fails', () => {
        const calls = [];
        assert.throws(() => processPayload({ first: [{ id: 'c' }], second: [{ id: 'a' }] }, registry(calls, true)), { message: 'prepare failed' });
        assert.deepStrictEqual(calls, ['build first c', 'build second a', 'prepare second a']);
    });

    it('rejects a known type that is not an array', () => {
        assert.throws(() => processPayload({ first: {} }, registry([], false)), { message: 'The request body type "first" must be an array.' });
    });
});
