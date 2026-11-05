/*
 * Unit tests for planPresentationLabels, the MAXLABELS changes that make the stored rows match the
 * labels Maximo's PresentationParser reads from a presentation.
 *
 *   npm run package:library && npm run test:unit
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';

import { loadScriptFunctions } from '../harness.js';

const { planPresentationLabels } = loadScriptFunctions('resources/naviam.autoscript.library.js', ['planPresentationLabels', 'presentationLabelKey'], {});

function label(id, property, value) {
    return { id: id, property: property, value: value };
}

describe('planPresentationLabels', () => {
    it('inserts every label when nothing is stored', () => {
        const desired = [label('s1', 'label', 'One'), label('t1', 'label', 'Text')];
        assert.deepStrictEqual(planPresentationLabels([], desired), { inserts: desired, updates: [], deletes: [] });
    });

    it('does nothing when the rows already match', () => {
        const rows = [label('s1', 'label', 'One'), label('s1', 'description', 'D')];
        assert.deepStrictEqual(planPresentationLabels(rows, rows.slice().reverse()), { inserts: [], updates: [], deletes: [] });
    });

    it('updates a changed value, deletes a dropped label and inserts a new one', () => {
        const rows = [label('s1', 'label', 'One'), label('t1', 'label', 'Text'), label('s2', 'label', 'Two')];
        const desired = [label('s1', 'label', 'First'), label('s2', 'label', 'Two'), label('t2', 'label', 'Other')];
        assert.deepStrictEqual(planPresentationLabels(rows, desired), {
            inserts: [label('t2', 'label', 'Other')],
            updates: [{ index: 0, value: 'First' }],
            deletes: [1]
        });
    });

    it('keys rows by id and property', () => {
        const rows = [label('s1', 'label', 'One')];
        assert.deepStrictEqual(planPresentationLabels(rows, [label('s1', 'description', 'One')]), {
            inserts: [label('s1', 'description', 'One')],
            updates: [],
            deletes: [0]
        });
    });

    it('deletes a second row for the same id and property', () => {
        const rows = [label('s1', 'label', 'Old'), label('s1', 'label', 'One')];
        assert.deepStrictEqual(planPresentationLabels(rows, [label('s1', 'label', 'One')]), {
            inserts: [],
            updates: [{ index: 0, value: 'One' }],
            deletes: [1]
        });
    });

    it('deletes every row when the presentation has no labels', () => {
        const rows = [label('s1', 'label', 'One'), label('t1', 'label', 'Text')];
        assert.deepStrictEqual(planPresentationLabels(rows, []), { inserts: [], updates: [], deletes: [0, 1] });
    });
});
