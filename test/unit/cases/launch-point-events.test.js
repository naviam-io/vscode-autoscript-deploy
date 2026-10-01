/*
 * Unit tests for the launch point event mapping in resources/naviam.autoscript.deploy.js.
 *
 * A launch point declares which Maximo event it fires on with a set of boolean flags, exactly one
 * of which is expected to be set. Maximo stores the choice as a numeric code, so deploying a launch
 * point means turning the flags into that code. The mapping is first match wins and the order is
 * part of the contract: an attribute launch point that sets both initializeAccessRestriction and
 * initializeValue is an access restriction, not an initialisation.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { loadScriptFunctions } = require('../harness');

const DEPLOY_SCRIPT = 'resources/naviam.autoscript.deploy.js';

function ScriptError(reason, message) {
    this.reason = reason;
    this.message = message;
}

const { objectLaunchPointEventType, objectSaveActions, objectSaveEventContext, attributeLaunchPointEvent, shouldDeleteDeployScript } = loadScriptFunctions(
    DEPLOY_SCRIPT,
    ['objectLaunchPointEventType', 'objectSaveActions', 'objectSaveEventContext', 'attributeLaunchPointEvent', 'shouldDeleteDeployScript', 'firstFlagSet'],
    { ScriptError }
);

describe('objectLaunchPointEventType', () => {
    it('maps each event flag to the code Maximo stores', () => {
        assert.strictEqual(objectLaunchPointEventType({ initializeValue: true }), '0');
        assert.strictEqual(objectLaunchPointEventType({ validateApplication: true }), '1');
        assert.strictEqual(objectLaunchPointEventType({ allowObjectCreation: true }), '2');
        assert.strictEqual(objectLaunchPointEventType({ allowObjectDeletion: true }), '3');
        assert.strictEqual(objectLaunchPointEventType({ save: true }), '4');
    });

    it('takes the first flag that is set when several are', () => {
        assert.strictEqual(objectLaunchPointEventType({ allowObjectDeletion: true, validateApplication: true }), '1');
    });

    it('ignores a flag that is present but false', () => {
        assert.strictEqual(objectLaunchPointEventType({ initializeValue: false, save: true }), '4');
    });

    it('rejects a launch point that sets no event flag', () => {
        assert.throws(
            () => objectLaunchPointEventType({ initializeValue: false }),
            (error) => error.reason === 'missing_attribute' && /initializeValue/.test(error.message)
        );
    });
});

describe('objectSaveActions', () => {
    it('returns the attribute of every save action that is set', () => {
        assert.deepStrictEqual(objectSaveActions({ add: true, update: true, delete: true }), ['ADD', 'UPDATE', 'DELETE']);
    });

    it('returns only the actions that are set', () => {
        assert.deepStrictEqual(objectSaveActions({ update: true }), ['UPDATE']);
    });

    it('rejects a save launch point with no action', () => {
        assert.throws(
            () => objectSaveActions({ add: false }),
            (error) => error.reason === 'missing_save_action'
        );
    });
});

describe('objectSaveEventContext', () => {
    it('maps each save timing to the code Maximo stores', () => {
        assert.strictEqual(objectSaveEventContext({ beforeSave: true }), '0');
        assert.strictEqual(objectSaveEventContext({ afterSave: true }), '1');
        assert.strictEqual(objectSaveEventContext({ afterCommit: true }), '2');
    });

    it('takes the first timing that is set when several are', () => {
        assert.strictEqual(objectSaveEventContext({ afterCommit: true, beforeSave: true }), '0');
    });

    it('rejects a save launch point with no timing', () => {
        assert.throws(
            () => objectSaveEventContext({ beforeSave: false }),
            (error) => error.reason === 'missing_action_type'
        );
    });
});

describe('attributeLaunchPointEvent', () => {
    it('maps each event flag to the code Maximo stores', () => {
        assert.strictEqual(attributeLaunchPointEvent({ initializeAccessRestriction: true }), '1');
        assert.strictEqual(attributeLaunchPointEvent({ initializeValue: true }), '0');
        assert.strictEqual(attributeLaunchPointEvent({ validate: true }), '2');
        assert.strictEqual(attributeLaunchPointEvent({ retrieveList: true }), '3');
        assert.strictEqual(attributeLaunchPointEvent({ runAction: true }), '4');
    });

    it('treats an access restriction that also initialises a value as an access restriction', () => {
        assert.strictEqual(attributeLaunchPointEvent({ initializeAccessRestriction: true, initializeValue: true }), '1');
    });

    it('rejects a launch point that sets no event flag', () => {
        assert.throws(
            () => attributeLaunchPointEvent({}),
            (error) => error.reason === 'missing_attribute' && /initializeAccessRestriction/.test(error.message)
        );
    });
});

describe('shouldDeleteDeployScript', () => {
    it('removes the companion deploy script unless asked not to', () => {
        assert.strictEqual(shouldDeleteDeployScript({}), true);
        assert.strictEqual(shouldDeleteDeployScript({ deleteDeployScript: null }), true);
        assert.strictEqual(shouldDeleteDeployScript({ deleteDeployScript: true }), true);
    });

    it('keeps the companion deploy script when asked to', () => {
        assert.strictEqual(shouldDeleteDeployScript({ deleteDeployScript: false }), false);
    });
});
