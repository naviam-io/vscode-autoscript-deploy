/*
 * Unit tests for the acorn extraction harness.
 *
 *   npm run test:unit
 *
 * The Nashorn library is shipped as a webpack bundle, so its functions are declared inside module
 * closures rather than at the top level. The harness has to reach them, otherwise none of the
 * library's logic can be unit tested.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');

const { extractFunctionSources, loadScriptFunctions } = require('../harness');

describe('extractFunctionSources', () => {
    it('finds a function declared inside a nested closure', () => {
        const source = 'var modules = { 1: function () { function nestedHelper(a) { return a + 1; } } };';

        const [extracted] = extractFunctionSources(source, ['nestedHelper']);

        assert.match(extracted, /function nestedHelper/);
    });

    it('still finds a function declared at the top level', () => {
        const source = 'function topLevelHelper(a) { return a * 2; }';

        const [extracted] = extractFunctionSources(source, ['topLevelHelper']);

        assert.match(extracted, /function topLevelHelper/);
    });

    it('throws when one name has two different bodies', () => {
        const source = 'function duplicated() { return 1; } var m = function () { function duplicated() { return 2; } };';

        assert.throws(() => extractFunctionSources(source, ['duplicated']), /declared more than once/);
    });

    it('throws when the name is absent', () => {
        assert.throws(() => extractFunctionSources('var a = 1;', ['missing']), /was not found/);
    });

    it('loads a real function out of the built Nashorn library', () => {
        const { valueOrDefault } = loadScriptFunctions('resources/naviam.autoscript.library.js', ['valueOrDefault'], {});

        assert.strictEqual(valueOrDefault(undefined, 'fallback'), 'fallback');
        assert.strictEqual(valueOrDefault('supplied', 'fallback'), 'supplied');
    });
});
