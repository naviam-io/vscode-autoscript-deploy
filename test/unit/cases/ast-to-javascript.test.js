/*
 * Unit tests for astToJavaScript in resources/naviam.autoscript.deploy.js, which converts the
 * scriptConfig AST node of a JavaScript automation script into a plain object.
 *
 * Inside Maximo the AST comes from Nashorn's load('nashorn:parser.js'). Nashorn is not available on
 * modern JDKs, so acorn is used here instead: both emit the same ESTree shapes for ES5 sources, in
 * particular an Identifier key (carrying "name") for an unquoted property key and a Literal key
 * (carrying "value") for a quoted one. That distinction is the subject of bug #150202.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const acorn = require('acorn');
const { loadScriptFunctions } = require('../harness');

const { astToJavaScript } = loadScriptFunctions('resources/naviam.autoscript.deploy.js', ['astToJavaScript', 'astPropertyKeyName'], {});

function parseScriptConfig(source) {
    return acorn.parse(source, { ecmaVersion: 5 }).body[0].declarations[0].init;
}

function convert(source) {
    return astToJavaScript(parseScriptConfig(source));
}

function stripPropertyTypes(node) {
    if (!node || typeof node !== 'object') {
        return;
    }

    if (node.type === 'Property') {
        delete node.type;
    }

    Object.values(node).forEach(stripPropertyTypes);
}

describe('astToJavaScript', () => {
    it('keeps the name of an unquoted key with an array value (#150202)', () => {
        const config = convert(
            'var scriptConfig = {' +
                '    autoscript: "DATABEAN.RECEIPTS.AUTOMATCH.TAB",' +
                '    allowInvokingScriptFunctions: true,' +
                '    autoScriptVars: [' +
                '        { varname: "beanapp", varType: "IN", varBindingValue: "RECEIPTS" },' +
                '        { varname: "beanid", varType: "IN", varBindingValue: "automatch_transactions_table" }' +
                '    ]' +
                '};'
        );

        assert.deepStrictEqual(config, {
            autoscript: 'DATABEAN.RECEIPTS.AUTOMATCH.TAB',
            allowInvokingScriptFunctions: true,
            autoScriptVars: [
                { varname: 'beanapp', varType: 'IN', varBindingValue: 'RECEIPTS' },
                { varname: 'beanid', varType: 'IN', varBindingValue: 'automatch_transactions_table' },
            ],
        });
    });

    it('keeps the name of a quoted key with an array value', () => {
        const config = convert('var scriptConfig = { "autoscript": "T", "autoScriptVars": [ { "varname": "beanapp", "varType": "IN" } ] };');

        assert.deepStrictEqual(config, { autoscript: 'T', autoScriptVars: [{ varname: 'beanapp', varType: 'IN' }] });
    });

    it('allows quoted and unquoted keys to be mixed', () => {
        const config = convert('var scriptConfig = { autoscript: "T", "scriptLaunchPoints": [ { launchPointName: "LP1", active: true } ], autoScriptVars: [ { varname: "v" } ] };');

        assert.deepStrictEqual(config, {
            autoscript: 'T',
            scriptLaunchPoints: [{ launchPointName: 'LP1', active: true }],
            autoScriptVars: [{ varname: 'v' }],
        });
    });

    it('converts an array nested inside an array element', () => {
        const config = convert('var scriptConfig = { autoscript: "T", scriptLaunchPoints: [ { launchPointName: "LP1", launchPointVars: [ { varname: "v", varBindingValue: "x" } ] } ] };');

        assert.deepStrictEqual(config, {
            autoscript: 'T',
            scriptLaunchPoints: [{ launchPointName: 'LP1', launchPointVars: [{ varname: 'v', varBindingValue: 'x' }] }],
        });
    });

    it('converts a nested object value', () => {
        const config = convert('var scriptConfig = { autoscript: "T", nested: { a: 1, "b": null } };');

        assert.deepStrictEqual(config, { autoscript: 'T', nested: { a: 1, b: null } });
    });

    it('converts an array of scalars', () => {
        const config = convert('var scriptConfig = { autoscript: "T", tags: [ "a", "b" ] };');

        assert.deepStrictEqual(config, { autoscript: 'T', tags: ['a', 'b'] });
    });

    it('converts property nodes that carry no type (nashorn:parser.js)', () => {
        // Unlike acorn, Nashorn's parser does not set "type" on a property node. Stripping it here
        // keeps the acorn based tests honest about the shape the server actually sees.
        const node = parseScriptConfig('var scriptConfig = { autoscript: "T", autoScriptVars: [ { varname: "v" } ] };');

        stripPropertyTypes(node);

        assert.deepStrictEqual(astToJavaScript(node), { autoscript: 'T', autoScriptVars: [{ varname: 'v' }] });
    });
});
