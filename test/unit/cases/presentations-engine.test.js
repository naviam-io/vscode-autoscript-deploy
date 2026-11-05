/*
 * Unit tests for the presentation delta engine, run over real presentations through a plain object
 * document in place of JDOM.
 *
 *   npm run package:library && npm run test:unit
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import { loadScriptFunctions } from '../harness.js';
import { MODEL_FUNCTIONS } from './presentations-model.test.js';
import { childIds, createTree, findById, loadFixture, outline } from '../support/presentation-tree.js';

const { applyPresentationChanges, indexPresentation } = loadScriptFunctions(
    'resources/naviam.autoscript.library.js',
    MODEL_FUNCTIONS.concat([
        'applyPresentationChanges',
        'visitPresentationElements',
        'visitPresentationDefinitions',
        'indexPresentation',
        'indexPresentationElements',
        'detachPresentationElement',
        'findPresentationElement',
        'resolvePresentationReference',
        'resolvePresentationAnchor',
        'placePresentationElement',
        'isPresentationDescendant',
        'buildPresentationElement',
        'addPresentationElement',
        'modifyPresentationElement',
        'movePresentationElement',
        'removePresentationElement'
    ]),
    {}
);

let root;
let tree;

function apply(changes) {
    return applyPresentationChanges(indexPresentation(tree), 'STARTCNTR', changes);
}

function rejects(changes, message) {
    assert.throws(() => apply(changes), { message: message });
}

describe('applyPresentationChanges', () => {
    beforeEach(async () => {
        root = await loadFixture('STARTCNTR');
        tree = createTree(root);
    });

    describe('add', () => {
        it('appends to the root without placement', () => {
            apply([{ add: { name: 'dialog', id: 'nv_dlg', label: 'NV' } }]);
            assert.strictEqual(childIds(root).at(-1), 'nv_dlg');
            assert.deepStrictEqual(findById(root, 'nv_dlg').attributes, { id: 'nv_dlg', label: 'NV' });
        });

        it('inserts before, after and into', () => {
            apply([
                { add: { name: 'hyperlink', id: 'nv_before' }, before: { name: 'hyperlink', id: 'mobsslink' } },
                { add: { name: 'hyperlink', id: 'nv_after' }, after: { name: 'hyperlink', id: 'stdsslink' } },
                { add: { name: 'hyperlink', id: 'nv_into' }, into: { name: 'section', id: 'switchss_section' } }
            ]);
            assert.deepStrictEqual(childIds(findById(root, 'switchss_section')), ['stdsslink', 'nv_after', 'nv_before', 'mobsslink', 'nv_into']);
        });

        it('builds nested children with their attributes in order', () => {
            apply([
                {
                    add: {
                        name: 'dialog',
                        id: 'nv_dlg',
                        children: [
                            { name: 'section', id: 'nv_s1', label: 'One', children: [{ name: 'textbox', id: 'nv_t1', dataattribute: 'description' }] },
                            { name: 'buttongroup', id: 'nv_bg', children: [{ name: 'pushbutton', id: 'nv_ok', default: 'true', mxevent: 'dialogok' }] }
                        ]
                    }
                }
            ]);
            assert.strictEqual(outline(findById(root, 'nv_dlg')), 'dialog#nv_dlg\n  section#nv_s1\n    textbox#nv_t1\n  buttongroup#nv_bg\n    pushbutton#nv_ok');
            assert.deepStrictEqual(findById(root, 'nv_ok').attributes, { id: 'nv_ok', default: 'true', mxevent: 'dialogok' });
        });

        it('lets a later change use a control an earlier one added', () => {
            apply([{ add: { name: 'dialog', id: 'nv_dlg' } }, { add: { name: 'section', id: 'nv_s' }, into: { name: 'dialog', id: 'nv_dlg' } }]);
            assert.deepStrictEqual(childIds(findById(root, 'nv_dlg')), ['nv_s']);
        });

        it('replaces an existing control in place and ignores the placement', () => {
            apply([
                {
                    add: { name: 'section', id: 'switchss_section', label: 'New', children: [{ name: 'hyperlink', id: 'nv_link' }] },
                    into: { name: 'dialog', id: 'rsdisplay' }
                }
            ]);
            const clientarea = findById(root, 'clientarea');
            assert.deepStrictEqual(childIds(clientarea), ['scportlets', 'switchss_section']);
            assert.deepStrictEqual(childIds(findById(root, 'switchss_section')), ['nv_link']);
            assert.strictEqual(findById(root, 'switchss_section').attributes.label, 'New');
            assert.strictEqual(findById(root, 'stdsslink'), null);
            assert.deepStrictEqual(childIds(findById(root, 'rsdisplay')), ['rsdisplay_section', 'rsdisplay_btn_1']);
        });

        it('keeps ids of the replaced control when the new content declares them again', () => {
            apply([{ add: { name: 'section', id: 'switchss_section', children: [{ name: 'hyperlink', id: 'mobsslink' }] } }]);
            assert.deepStrictEqual(childIds(findById(root, 'switchss_section')), ['mobsslink']);
        });

        it('applies the same fragment twice to the same result', () => {
            const fragment = [{ add: { name: 'dialog', id: 'nv_dlg', children: [{ name: 'section', id: 'nv_s' }] } }];
            apply(fragment);
            const once = outline(root);
            apply(fragment);
            assert.strictEqual(outline(root), once);
        });

        it('rejects replacing a control with another element name', () => {
            rejects([{ add: { name: 'dialog', id: 'switchss_section' } }], 'STARTCNTR changes[0] add: "switchss_section" is a section, not a dialog.');
        });

        it('rejects replacing the root', () => {
            rejects([{ add: { name: 'presentation', id: 'startcntr' } }], 'STARTCNTR changes[0] add: the root element "startcntr" cannot be replaced.');
        });

        it('rejects an id declared twice in the added content', () => {
            rejects(
                [{ add: { name: 'dialog', id: 'nv_dlg', children: [{ name: 'section', id: 'nv_s' }, { name: 'section', id: 'nv_s' }] } }],
                'STARTCNTR changes[0] add: id "nv_s" is declared more than once in the added content.'
            );
        });

        it('rejects added content that reuses an id from elsewhere in the presentation', () => {
            rejects(
                [{ add: { name: 'dialog', id: 'nv_dlg', children: [{ name: 'hyperlink', id: 'stdsslink' }] } }],
                'STARTCNTR changes[0] add: id "stdsslink" already exists in the presentation.'
            );
        });

        it('rejects an anchor that does not exist', () => {
            rejects(
                [{ add: { name: 'section', id: 'nv_s' }, after: { name: 'section', id: 'nv_missing' } }],
                'STARTCNTR changes[0] add: anchor section "nv_missing" was not found.'
            );
        });

        it('rejects an anchor with another element name', () => {
            rejects([{ add: { name: 'section', id: 'nv_s' }, into: { name: 'tab', id: 'rsdisplay' } }], 'STARTCNTR changes[0] add: "rsdisplay" is a dialog, not a tab.');
        });

        it('rejects before or after the root', () => {
            rejects(
                [{ add: { name: 'dialog', id: 'nv_dlg' }, after: { name: 'presentation', id: 'startcntr' } }],
                'STARTCNTR changes[0] add: cannot place after the root element, use into instead.'
            );
        });
    });

    describe('modify', () => {
        it('sets and unsets attributes', () => {
            apply([{ modify: { name: 'hyperlink', id: 'stdsslink' }, set: { label: 'Standard', nvnew: 'x' }, unset: ['mxevent', 'nvabsent'] }]);
            const link = findById(root, 'stdsslink');
            assert.strictEqual(link.attributes.label, 'Standard');
            assert.strictEqual(link.attributes.nvnew, 'x');
            assert.ok(!Object.prototype.hasOwnProperty.call(link.attributes, 'mxevent'));
        });

        it('rejects a missing control', () => {
            rejects([{ modify: { name: 'tab', id: 'nv_missing' }, set: { label: 'x' } }], 'STARTCNTR changes[0] modify: tab "nv_missing" was not found.');
        });
    });

    describe('move', () => {
        it('moves before, after and into, with the subtree', () => {
            apply([
                { move: { name: 'hyperlink', id: 'mobsslink' }, before: { name: 'hyperlink', id: 'stdsslink' } },
                { move: { name: 'section', id: 'switchss_section' }, into: { name: 'dialog', id: 'rsdisplay' } },
                { move: { name: 'section', id: 'rsdisplay_section' }, after: { name: 'section', id: 'switchss_section' } }
            ]);
            assert.deepStrictEqual(childIds(findById(root, 'rsdisplay')), ['rsdisplay_btn_1', 'switchss_section', 'rsdisplay_section']);
            assert.deepStrictEqual(childIds(findById(root, 'switchss_section')), ['mobsslink', 'stdsslink']);
            assert.deepStrictEqual(childIds(findById(root, 'clientarea')), ['scportlets']);
        });

        it('rejects a move relative to its own content', () => {
            rejects(
                [{ move: { name: 'section', id: 'switchss_section' }, into: { name: 'section', id: 'switchss_section' } }],
                'STARTCNTR changes[0] move: cannot move section "switchss_section" relative to itself or its own content.'
            );
            rejects(
                [{ move: { name: 'section', id: 'switchss_section' }, after: { name: 'hyperlink', id: 'stdsslink' } }],
                'STARTCNTR changes[0] move: cannot move section "switchss_section" relative to itself or its own content.'
            );
        });

        it('rejects moving the root', () => {
            rejects([{ move: { name: 'presentation', id: 'startcntr' }, into: { name: 'dialog', id: 'rsdisplay' } }], 'STARTCNTR changes[0] move: the root element cannot be moved.');
        });

        it('rejects a missing control', () => {
            rejects([{ move: { name: 'section', id: 'nv_missing' }, into: { name: 'dialog', id: 'rsdisplay' } }], 'STARTCNTR changes[0] move: section "nv_missing" was not found.');
        });
    });

    describe('remove', () => {
        it('removes a control with its subtree', () => {
            const result = apply([{ remove: { name: 'section', id: 'switchss_section' } }]);
            assert.strictEqual(findById(root, 'switchss_section'), null);
            assert.strictEqual(findById(root, 'stdsslink'), null);
            assert.deepStrictEqual(result.notes, []);
        });

        it('reports a missing control instead of failing', () => {
            const before = outline(root);
            const result = apply([{ remove: { name: 'section', id: 'nv_missing' } }]);
            assert.strictEqual(outline(root), before);
            assert.deepStrictEqual(result.notes, ['STARTCNTR changes[0] remove: section "nv_missing" was not found, nothing to remove.']);
        });

        it('rejects a control with another element name', () => {
            rejects([{ remove: { name: 'dialog', id: 'switchss_section' } }], 'STARTCNTR changes[0] remove: "switchss_section" is a section, not a dialog.');
        });

        it('rejects removing the root', () => {
            rejects([{ remove: { name: 'presentation', id: 'startcntr' } }], 'STARTCNTR changes[0] remove: the root element cannot be removed.');
        });
    });

    it('collects the signature options an add or a modify introduces', () => {
        const result = apply([
            { add: { name: 'dialog', id: 'nv_dlg', children: [{ name: 'pushbutton', id: 'nv_btn', sigoption: 'NVRUN' }] } },
            { modify: { name: 'hyperlink', id: 'stdsslink' }, set: { sigoption: 'NVOPEN' } },
            { modify: { name: 'hyperlink', id: 'mobsslink' }, set: { label: 'x' } }
        ]);
        assert.deepStrictEqual(result.sigoptions, [
            { sigoption: 'NVRUN', index: 0, operation: 'add' },
            { sigoption: 'NVOPEN', index: 1, operation: 'modify' }
        ]);
    });

    describe('the id index', () => {
        it('forgets the content of a removed control', () => {
            rejects(
                [{ remove: { name: 'section', id: 'switchss_section' } }, { modify: { name: 'hyperlink', id: 'stdsslink' }, set: { label: 'x' } }],
                'STARTCNTR changes[1] modify: hyperlink "stdsslink" was not found.'
            );
        });

        it('finds the new content of a replaced control, and not the old', () => {
            rejects(
                [
                    { add: { name: 'section', id: 'switchss_section', children: [{ name: 'hyperlink', id: 'nv_link' }] } },
                    { modify: { name: 'hyperlink', id: 'nv_link' }, set: { label: 'x' } },
                    { modify: { name: 'hyperlink', id: 'stdsslink' }, set: { label: 'x' } }
                ],
                'STARTCNTR changes[2] modify: hyperlink "stdsslink" was not found.'
            );
        });

        it('stays current across entries applied to one document', () => {
            const doc = indexPresentation(tree);
            applyPresentationChanges(doc, 'STARTCNTR', [{ remove: { name: 'hyperlink', id: 'stdsslink' } }]);
            applyPresentationChanges(doc, 'STARTCNTR', [{ add: { name: 'hyperlink', id: 'stdsslink', label: 'Back' }, into: { name: 'dialog', id: 'rsdisplay' } }]);
            assert.deepStrictEqual(childIds(findById(root, 'rsdisplay')), ['rsdisplay_section', 'rsdisplay_btn_1', 'stdsslink']);
        });
    });

    it('works on a system presentation', async () => {
        root = await loadFixture('TOOLBOX');
        tree = createTree(root);
        applyPresentationChanges(indexPresentation(tree), 'TOOLBOX', [{ add: { name: 'pushbutton', id: 'nv_btn', sigoption: 'ANY' }, into: { name: 'buttongroup', id: 'ctrl_buttongroup' } }]);
        assert.deepStrictEqual(childIds(findById(root, 'ctrl_buttongroup')), ['ctrl_pushbutton', 'nv_btn']);
    });
});
