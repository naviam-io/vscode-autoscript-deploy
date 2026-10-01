/*
 * Unit tests for the extract script's detail dispatch.
 *
 *   npm run test:unit
 *
 * Capture during a retaining deployment calls getObjectDetail rather than reimplementing the payload
 * shape, so which getter each object type reaches is a contract, not an implementation detail. The
 * getters themselves talk to Maximo and are covered by the integration tests; these tests only pin
 * the routing, using a stub per getter.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');

const { loadScriptFunctions } = require('../harness');

const GETTERS = ['getMessage', 'getAction', 'getProperty', 'getDomain', 'getCronTask', 'getEscalation', 'getLogger', 'getIntObject', 'getQuery'];

function load() {
    const calls = [];
    const stubs = {};

    GETTERS.forEach((name) => {
        stubs[name] = (id) => {
            calls.push([name, id]);
            return { calledBy: name, id: id };
        };
    });

    const { getObjectDetail } = loadScriptFunctions('resources/naviam.autoscript.objects.js', ['getObjectDetail'], stubs);

    return { getObjectDetail, calls };
}

describe('getObjectDetail', () => {
    it('routes every supported object type to its own getter', () => {
        const expected = {
            messages: 'getMessage',
            actions: 'getAction',
            properties: 'getProperty',
            domains: 'getDomain',
            crontasks: 'getCronTask',
            escalations: 'getEscalation',
            loggers: 'getLogger',
            integrationobjects: 'getIntObject',
            queries: 'getQuery'
        };

        Object.keys(expected).forEach((objectType) => {
            const { getObjectDetail } = load();

            assert.strictEqual(getObjectDetail(objectType, '42').calledBy, expected[objectType], objectType + ' reached the wrong getter');
        });
    });

    it('passes the id through untouched', () => {
        const { getObjectDetail, calls } = load();

        getObjectDetail('crontasks', '12345');

        assert.deepStrictEqual(calls, [['getCronTask', '12345']]);
    });

    it('returns undefined for an unknown object type without calling any getter', () => {
        const { getObjectDetail, calls } = load();

        assert.strictEqual(getObjectDetail('widgets', '1'), undefined);
        assert.deepStrictEqual(calls, []);
    });
});
