/*
 * Unit tests for applyScriptVariables in resources/naviam.autoscript.deploy.js, which creates the
 * script variables a scriptConfig declares (GitHub issue #36).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { loadScriptFunctions } = require('../harness');

function ScriptError(reason, message) {
    this.reason = reason;
    this.message = message;
}

const { applyScriptVariables } = loadScriptFunctions('resources/naviam.autoscript.deploy.js', ['applyScriptVariables', 'setValueIfAvailable'], {
    ScriptError,
    MboConstants: { READONLY: 7, NOACCESSCHECK: 2 }
});

function apply(autoScriptVars, warnings = []) {
    const added = [];
    const set = {
        add() {
            const values = {};
            added.push(values);
            return {
                setValue: (attribute, value) => {
                    values[attribute] = value;
                },
                getMboValue: () => ({ isFlagSet: () => false })
            };
        }
    };

    applyScriptVariables(set, { autoscript: 'EXAMPLE_SCRIPT', autoScriptVars }, warnings);
    return added;
}

describe('applyScriptVariables', () => {
    it('creates a variable named with varName', () => {
        const added = apply([{ varName: 'cvWorkOrder', varBindingValue: 'WONUM', varType: 'INOUT', varBindingType: 'ATTRIBUTE', noValidation: true }]);

        assert.deepStrictEqual(added, [{ VARNAME: 'cvWorkOrder', VARBINDINGTYPE: 'ATTRIBUTE', VARTYPE: 'INOUT', NOVALIDATION: true, VARBINDINGVALUE: 'WONUM' }]);
    });

    it('creates a variable without a binding type or variable type as a literal input', () => {
        const added = apply([{ varName: 'examplevar', description: 'An example variable' }]);

        assert.deepStrictEqual(added, [{ VARNAME: 'examplevar', DESCRIPTION: 'An example variable', VARBINDINGTYPE: 'LITERAL', VARTYPE: 'IN' }]);
    });

    it('accepts the deprecated varname, returning a warning to the client', () => {
        const warnings = [];

        const added = apply([{ varname: 'examplevar' }], warnings);

        assert.strictEqual(added[0].VARNAME, 'examplevar');
        assert.deepStrictEqual(warnings, ['The script variable examplevar uses the deprecated property "varname", rename it to "varName".']);
    });

    it('prefers varName over varname, warning about the ignored varname', () => {
        const warnings = [];

        const added = apply([{ varName: 'a', varname: 'b' }], warnings);

        assert.strictEqual(added[0].VARNAME, 'a');
        assert.strictEqual(warnings.length, 1);
    });

    it('returns no warnings for a variable named with varName', () => {
        const warnings = [];

        apply([{ varName: 'a' }], warnings);

        assert.deepStrictEqual(warnings, []);
    });

    it('rejects a variable without a name', () => {
        assert.throws(() => apply([{ description: 'x' }]), { reason: 'missing_attribute' });
    });
});
