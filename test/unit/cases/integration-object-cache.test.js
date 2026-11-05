import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadScriptFunctions } from '../harness.js';

function deletion({ existingContext = true, previous = null, saveError } = {}) {
    const events = [];
    const properties = new Map(previous === null ? [] : [['WSIOTXN', previous]]);
    properties.set('unrelated', 'preserved');
    const context = {
        getProperty: (key) => properties.get(key) ?? null,
        setProperty: (key, value) => properties.set(key, value),
        removeProperty: (key) => properties.delete(key)
    };
    let current = existingContext ? context : null;
    const original = current;
    const IntegrationContext = {
        getCurrentContext: () => current,
        createCurrentContext: () => { events.push('create context'); return (current = context); },
        destroyCurrentContext: () => { events.push('destroy context'); current = null; }
    };
    const children = { deleteAll: () => events.push('delete children') };
    const mbo = {
        delete: () => events.push('delete'),
        getMboSet: () => children
    };
    const set = {
        moveFirst: () => mbo,
        save: () => {
            events.push('save');
            assert.equal(current?.getProperty('WSIOTXN'), '1', 'Named cache refresh must be suppressed while saving the deletion');
            if (saveError) throw saveError;
        }
    };
    const server = {
        reloadMaximoCache: (...args) => {
            events.push('reload');
            assert.equal(current, original, 'Restore the request context before refreshing caches');
            if (existingContext) assert.equal(context.getProperty('WSIOTXN'), previous, 'Restore the previous transaction flag');
            assert.deepEqual(args, ['MAXINTOBJECT', true], 'Refresh the whole object-structure cache, not a deleted name');
        }
    };
    const { deleteIntegrationObject } = loadScriptFunctions(
        'resources/naviam.autoscript.library.js',
        ['deleteIntegrationObject', 'saveDeletedIntegrationObject', 'deleteNonCascadingChildren'],
        {
            findIntegrationObject: (mboSet) => mboSet.moveFirst(),
            Java: {
                type: (name) => {
                    if (name === 'psdi.server.MXServer') return { getMXServer: () => server };
                    if (name === 'psdi.iface.mic.IntegrationContext') return IntegrationContext;
                    if (name === 'psdi.iface.mos.ObjectStructureCache') {
                        return { getInstance: () => ({ getName: () => 'MAXINTOBJECT' }) };
                    }
                    throw new Error('Unexpected Java class ' + name);
                }
            }
        }
    );
    return {
        run: () => deleteIntegrationObject(set, { intObjectName: 'TEST_CACHE' }),
        events,
        assertRestored: () => {
            assert.equal(current, original);
            if (existingContext) assert.equal(context.getProperty('WSIOTXN'), previous);
            assert.equal(context.getProperty('unrelated'), 'preserved');
        }
    };
}

describe('object-structure deletion cache refresh', () => {
    it('suppresses the named refresh while saving, restores the flag, then reloads the whole cache', () => {
        const test = deletion({ previous: 'original' });
        test.run();
        assert.deepEqual(test.events, ['delete children', 'delete children', 'delete', 'save', 'reload']);
        test.assertRestored();
    });

    it('destroys a context it created before reloading', () => {
        const test = deletion({ existingContext: false });
        test.run();
        assert.deepEqual(test.events, ['delete children', 'delete children', 'delete', 'create context', 'save', 'destroy context', 'reload']);
        test.assertRestored();
    });

    it('restores the flag and propagates a failed save without reloading', () => {
        const failure = new Error('Save failed');
        const test = deletion({ saveError: failure });
        assert.throws(test.run, (error) => error === failure);
        assert.equal(test.events.includes('reload'), false);
        test.assertRestored();
    });
});
