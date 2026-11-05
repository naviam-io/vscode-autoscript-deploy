/*
 * Unit tests for the create-only handling of the Maximo side deploy scripts, run through the
 * function extraction harness.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { loadScriptFunctions } from '../harness.js';

const SCRIPTS = [
    'resources/naviam.autoscript.deploy.js',
    'resources/naviam.autoscript.form.js',
    'resources/naviam.autoscript.screens.js',
    'resources/naviam.autoscript.report.js'
];

function requestWith(value) {
    return { getQueryParam: (name) => (name === 'createOnly' ? value : null) };
}

describe('isCreateOnlyRequest', () => {
    for (const script of SCRIPTS) {
        it(`${script} reads the createOnly query parameter`, () => {
            const ask = (request) => loadScriptFunctions(script, ['isCreateOnlyRequest'], { request }).isCreateOnlyRequest();

            assert.deepStrictEqual([ask(requestWith('true')), ask(requestWith(null)), ask(requestWith('false')), ask(undefined)], [true, false, false, false]);
        });
    }
});

describe('deployParsedScript createOnly', () => {
    it('leaves an existing script untouched and reports the skip', () => {
        let closed = false;
        const existing = { isEmpty: () => false, getMbo: () => assert.fail('the existing script must not be read or changed') };
        const { deployParsedScript } = loadScriptFunctions('resources/naviam.autoscript.deploy.js', ['deployParsedScript'], {
            userInfo: {},
            autoScriptSetFor: () => existing,
            _close: () => {
                closed = true;
            }
        });

        const result = deployParsedScript({ autoscript: 'NVTEST.CREATEONLY' }, 'main();', 'javascript', true);

        assert.deepStrictEqual(result, { scriptName: 'NVTEST.CREATEONLY', deploying: false, outcome: 'skipped', status: 'success' });
        assert.strictEqual(closed, true);
    });

    it('still deletes a script that asks to be deleted', () => {
        let deleted = false;
        const existing = {
            isEmpty: () => false,
            getMbo: () => ({
                delete: () => {
                    deleted = true;
                }
            }),
            save: () => {}
        };
        const { deployParsedScript } = loadScriptFunctions('resources/naviam.autoscript.deploy.js', ['deployParsedScript'], {
            userInfo: {},
            autoScriptSetFor: () => existing,
            _close: () => {}
        });

        const result = deployParsedScript({ autoscript: 'NVTEST.CREATEONLY', _delete: true }, 'x', 'javascript', true);

        assert.strictEqual(deleted, true);
        assert.strictEqual(result.deleted, true);
        assert.strictEqual(result.outcome, 'deleted');
    });
});

/*
 * A stand-in for MXServer that records the where clause and answers whether the set is empty.
 */
function mxServer(empty, seen) {
    const set = { setWhere: (where) => seen.push(where), isEmpty: () => empty, cleanup: () => {}, close: () => {} };
    return {
        getMXServer: () => ({
            getMboSet: (name) => {
                seen.push(name);
                return set;
            }
        })
    };
}

function SqlFormat(where) {
    this.where = where;
    this.values = [];
    this.setObject = (index, object, attribute, value) => this.values.push(value);
    this.format = () => this.where + ' ' + JSON.stringify(this.values);
}

for (const [script, name, args, object] of [
    ['resources/naviam.autoscript.form.js', 'formExists', ['NVTEST'], 'INSPECTIONFORM'],
    ['resources/naviam.autoscript.screens.js', 'presentationExists', ['NVTEST'], 'MAXPRESENTATION'],
    ['resources/naviam.autoscript.report.js', 'reportExists', ['nvtest.rptdesign', 'WOTRACK'], 'REPORT']
]) {
    describe(name, () => {
        it(`looks in ${object} and reports whether a record was found`, () => {
            for (const empty of [true, false]) {
                const seen = [];
                const fn = loadScriptFunctions(script, [name, '_close'], { MXServer: mxServer(empty, seen), SqlFormat, userInfo: {} })[name];

                assert.strictEqual(fn(...args), !empty);
                assert.strictEqual(seen[0], object);
                for (const arg of args) {
                    assert.ok(seen[1].includes(arg), seen[1]);
                }
            }
        });
    });
}
