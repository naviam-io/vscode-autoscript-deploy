/*
 * Unit tests for the presentations model, the shape validation each entry passes before anything
 * in the payload is applied.
 *
 *   npm run package:library && npm run test:unit
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';

import { loadScriptFunctions } from '../harness.js';

export const MODEL_FUNCTIONS = [
    'MaximoPresentation',
    'requireKeys',
    'validatePresentationChanges',
    'validatePresentationChange',
    'validatePresentationControl',
    'validatePresentationElement',
    'validatePresentationModification',
    'isPresentationName',
    'presentationKeysOf',
    'presentationOperationOf',
    'presentationPlacementOf',
    'presentationChangeError',
    'presentationOperations',
    'presentationPlacements',
    'presentationReservedKeys'
];

const { MaximoPresentation } = loadScriptFunctions('resources/naviam.autoscript.library.js', MODEL_FUNCTIONS, {});

export const VALID_CHANGES = [
    { add: { name: 'tab', id: 't', label: 'T', children: [{ name: 'section', id: 's' }] }, after: { name: 'tab', id: 'a' } },
    { add: { name: 'dialog', id: 'd' } },
    { modify: { name: 'tab', id: 't' }, set: { label: 'U' }, unset: ['sigoption'] },
    { modify: { name: 'tab', id: 't' }, unset: ['sigoption'] },
    { move: { name: 'section', id: 's' }, into: { name: 'tab', id: 'a' } },
    { remove: { name: 'tab', id: 'old' } }
];

export const REJECTED = [
    ['a missing app', { changes: [{ remove: { name: 'tab', id: 'x' } }] }, 'The presentation is missing key "app".'],
    ['a missing changes array', { app: 'X' }, 'The presentation X must declare a non-empty "changes" array.'],
    ['an empty changes array', { app: 'X', changes: [] }, 'The presentation X must declare a non-empty "changes" array.'],
    ['a change that is not an object', { app: 'X', changes: ['add'] }, 'X changes[0]: a change must declare exactly one of add, modify, move or remove.'],
    ['no operation', { app: 'X', changes: [{ before: { name: 'tab', id: 'a' } }] }, 'X changes[0]: a change must declare exactly one of add, modify, move or remove.'],
    ['two operations', { app: 'X', changes: [{ remove: { name: 'tab', id: 'a' }, move: { name: 'tab', id: 'a' } }] }, 'X changes[0]: a change must declare exactly one of add, modify, move or remove.'],
    ['an unknown property', { app: 'X', changes: [{ remove: { name: 'tab', id: 'a' }, into: { name: 'tab', id: 'b' } }] }, 'X changes[0] remove: unknown property "into".'],
    ['two placements', { app: 'X', changes: [{ add: { name: 'tab', id: 'a' }, before: { name: 'tab', id: 'b' }, after: { name: 'tab', id: 'c' } }] }, 'X changes[0] add: declare at most one of before, after or into.'],
    ['a move without placement', { app: 'X', changes: [{ move: { name: 'tab', id: 'a' } }] }, 'X changes[0] move: a move must declare one of before, after or into.'],
    ['a reference without id', { app: 'X', changes: [{ remove: { name: 'tab' } }] }, 'X changes[0] remove: remove must have a name and an id.'],
    ['an element without id', { app: 'X', changes: [{ add: { name: 'tab', children: [] } }] }, 'X changes[0] add: add must have a name and an id.'],
    ['a nested element without name', { app: 'X', changes: [{ add: { name: 'tab', id: 't', children: [{ id: 's' }] } }] }, 'X changes[0] add: add.children[0] must have a name and an id.'],
    ['a modify of the id', { app: 'X', changes: [{ modify: { name: 'tab', id: 't' }, set: { id: 'u' } }] }, 'X changes[0] modify: "id" cannot be set or unset.'],
    ['an unset of children', { app: 'X', changes: [{ modify: { name: 'tab', id: 't' }, unset: ['children'] }] }, 'X changes[0] modify: "children" cannot be set or unset.'],
    ['an attribute both set and unset', { app: 'X', changes: [{ modify: { name: 'tab', id: 't' }, set: { label: 'L' }, unset: ['label'] }] }, 'X changes[0] modify: attribute "label" is both set and unset.']
];

/** Checked by the deploy schema only. */
export const SCHEMA_ONLY = [
    ['a reference with extra keys', { app: 'X', changes: [{ add: { name: 'tab', id: 'a' }, after: { name: 'tab', id: 'b', label: 'L' } }] }],
    ['a non-string attribute', { app: 'X', changes: [{ add: { name: 'tab', id: 't', default: true } }] }],
    ['children that are not an array', { app: 'X', changes: [{ add: { name: 'tab', id: 't', children: {} } }] }],
    ['a modify without set or unset', { app: 'X', changes: [{ modify: { name: 'tab', id: 't' } }] }],
    ['a non-string set value', { app: 'X', changes: [{ modify: { name: 'tab', id: 't' }, set: { label: 1 } }] }]
];

describe('MaximoPresentation', () => {
    it('upper-cases the app and keeps the changes', () => {
        const changes = [{ remove: { name: 'tab', id: 'x' } }];
        const presentation = new MaximoPresentation({ app: 'masterpm', changes: changes });
        assert.strictEqual(presentation.app, 'MASTERPM');
        assert.deepStrictEqual(presentation.changes, changes);
        assert.strictEqual(presentation._prepared, null);
        assert.strictEqual(presentation._reloadCaches, false);
    });

    it('accepts every operation', () => {
        assert.doesNotThrow(() => new MaximoPresentation({ app: 'X', changes: VALID_CHANGES }));
    });

    REJECTED.forEach(([description, input, message]) => {
        it('rejects ' + description, () => {
            assert.throws(() => new MaximoPresentation(input), { message: message });
        });
    });
});
