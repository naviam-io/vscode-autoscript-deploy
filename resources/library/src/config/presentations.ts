/// <reference path="../../globals.d.ts" />
/// <reference path="../../manage-facade.d.ts" />

import { requireKeys, updateInfo, updateProgress } from '../core/util';
import { createJdomTree, parseJdomDocument, serializeJdomDocument } from '../core/jdom-adapter';
import {
    findMissingSigoptions,
    PreparedPresentation,
    preparePresentationWrite,
    readPresentationXml,
    reloadPresentationCaches,
    writePresentation
} from '../core/presentation-writer';

export interface PresentationReference {
    name: string;
    id: string;
}

export interface PresentationElement {
    name: string;
    id: string;
    children?: PresentationElement[];
    [attribute: string]: any;
}

export interface PresentationChange {
    add?: PresentationElement;
    modify?: PresentationReference;
    move?: PresentationReference;
    remove?: PresentationReference;
    set?: Record<string, string>;
    unset?: string[];
    before?: PresentationReference;
    after?: PresentationReference;
    into?: PresentationReference;
}

export interface MaximoPresentationInput {
    app: string;
    changes: PresentationChange[];
}

/** The XML document operations the delta engine needs, so it runs over JDOM in Maximo and over plain objects in tests. */
export interface PresentationTree<E> {
    root(): E;
    name(element: E): string;
    attribute(element: E, key: string): string | null;
    setAttribute(element: E, key: string, value: string): void;
    removeAttribute(element: E, key: string): void;
    children(element: E): E[];
    parent(element: E): E | null;
    create(name: string): E;
    append(parent: E, child: E): void;
    insertBefore(anchor: E, child: E): void;
    insertAfter(anchor: E, child: E): void;
    detach(element: E): void;
}

export interface PresentationSigoptionUse {
    sigoption: string;
    index: number;
    operation: string;
}

export interface PresentationChangeResult {
    sigoptions: PresentationSigoptionUse[];
    notes: string[];
}

interface PresentationAnchor<E> {
    placement: string;
    element: E;
}

/**
 * A presentation tree with its elements by id, kept current as changes add and remove content. The
 * index is a java.util.HashMap, see docs/modules/nashorn-library.md.
 */
export interface PresentationDocument<E> {
    tree: PresentationTree<E>;
    elements: any;
}

/** Ordered changes to one MAXPRESENTATION document. See docs/modules/nashorn-library.md. */
export class MaximoPresentation {
    static _keys = ['app'];

    app: string;
    changes: PresentationChange[];
    _prepared: PreparedPresentation | null = null;
    _reloadCaches = false;

    constructor(input: MaximoPresentationInput) {
        requireKeys(MaximoPresentation, input, 'presentation');
        this.app = String(input.app).trim().toUpperCase();
        validatePresentationChanges(this.app, input.changes);
        this.changes = input.changes;
    }
}

export function presentationOperations(): string[] {
    return ['add', 'modify', 'move', 'remove'];
}

export function presentationPlacements(): string[] {
    return ['before', 'after', 'into'];
}

export function presentationReservedKeys(): string[] {
    return ['name', 'id', 'children'];
}

export function presentationChangeError(app: string, index: number, operation: string | null, message: string): Error {
    return new Error(app + ' changes[' + index + ']' + (operation ? ' ' + operation : '') + ': ' + message);
}

export function isPresentationName(value: any): boolean {
    return typeof value === 'string' && value.trim() !== '';
}

/** Which of the keys the change declares. */
export function presentationKeysOf(change: any, keys: string[]): string[] {
    return keys.filter(function (key: string): boolean {
        return !!change && typeof change === 'object' && Object.prototype.hasOwnProperty.call(change, key);
    });
}

export function presentationOperationOf(change: PresentationChange): string {
    return presentationKeysOf(change, presentationOperations())[0];
}

export function presentationPlacementOf(change: PresentationChange): string | null {
    const placements = presentationKeysOf(change, presentationPlacements());
    return placements.length > 0 ? placements[0] : null;
}

/**
 * Checks what the engine relies on, and what would otherwise be applied wrongly without an error,
 * such as a misspelt placement. Value types are left to the deploy schema.
 */
export function validatePresentationChanges(app: string, changes: any): void {
    if (!Array.isArray(changes) || changes.length === 0) {
        throw new Error('The presentation ' + app + ' must declare a non-empty "changes" array.');
    }

    changes.forEach(function (change: any, index: number): void {
        validatePresentationChange(app, index, change);
    });
}

export function validatePresentationChange(app: string, index: number, change: any): void {
    const operations = presentationKeysOf(change, presentationOperations());
    if (operations.length !== 1) {
        throw presentationChangeError(app, index, null, 'a change must declare exactly one of add, modify, move or remove.');
    }

    const operation = operations[0];
    const allowed = operation === 'modify' ? ['modify', 'set', 'unset'] : operation === 'remove' ? ['remove'] : [operation].concat(presentationPlacements());
    Object.keys(change).forEach(function (key: string): void {
        if (allowed.indexOf(key) < 0) {
            throw presentationChangeError(app, index, operation, 'unknown property "' + key + '".');
        }
    });

    const placements = presentationKeysOf(change, presentationPlacements());
    if (placements.length > 1) {
        throw presentationChangeError(app, index, operation, 'declare at most one of before, after or into.');
    }
    if (operation === 'move' && placements.length === 0) {
        throw presentationChangeError(app, index, operation, 'a move must declare one of before, after or into.');
    }

    if (operation === 'add') {
        validatePresentationElement(app, index, change.add, 'add');
    } else {
        validatePresentationControl(app, index, operation, operation, change[operation]);
    }
    placements.forEach(function (placement: string): void {
        validatePresentationControl(app, index, operation, placement, change[placement]);
    });
    if (operation === 'modify') {
        validatePresentationModification(app, index, change);
    }
}

export function validatePresentationControl(app: string, index: number, operation: string, role: string, control: any): void {
    if (!control || !isPresentationName(control.name) || !isPresentationName(control.id)) {
        throw presentationChangeError(app, index, operation, role + ' must have a name and an id.');
    }
}

export function validatePresentationElement(app: string, index: number, element: any, path: string): void {
    validatePresentationControl(app, index, 'add', path, element);
    (element.children || []).forEach(function (child: any, position: number): void {
        validatePresentationElement(app, index, child, path + '.children[' + position + ']');
    });
}

/** The id is what changes find a control by, so it and the element structure cannot be modified. */
export function validatePresentationModification(app: string, index: number, change: any): void {
    const set = change.set || {};
    const unset: string[] = change.unset || [];
    Object.keys(set)
        .concat(unset)
        .forEach(function (key: string): void {
            if (presentationReservedKeys().indexOf(key) >= 0) {
                throw presentationChangeError(app, index, 'modify', '"' + key + '" cannot be set or unset.');
            }
            if (Object.prototype.hasOwnProperty.call(set, key) && unset.indexOf(key) >= 0) {
                throw presentationChangeError(app, index, 'modify', 'attribute "' + key + '" is both set and unset.');
            }
        });
}

export function visitPresentationElements<E>(tree: PresentationTree<E>, element: E, visit: (element: E) => void): void {
    visit(element);
    tree.children(element).forEach(function (child: E): void {
        visitPresentationElements(tree, child, visit);
    });
}

export function visitPresentationDefinitions(definition: PresentationElement, visit: (definition: PresentationElement) => void): void {
    visit(definition);
    (definition.children || []).forEach(function (child: PresentationElement): void {
        visitPresentationDefinitions(child, visit);
    });
}

export function indexPresentation<E>(tree: PresentationTree<E>): PresentationDocument<E> {
    const HashMap = Java.type('java.util.HashMap');
    const doc: PresentationDocument<E> = { tree: tree, elements: new HashMap() };
    indexPresentationElements(doc, tree.root());
    return doc;
}

export function indexPresentationElements<E>(doc: PresentationDocument<E>, element: E): void {
    visitPresentationElements(doc.tree, element, function (current: E): void {
        const id = doc.tree.attribute(current, 'id');
        if (id !== null && !doc.elements.containsKey(id)) {
            doc.elements.put(id, current);
        }
    });
}

export function detachPresentationElement<E>(doc: PresentationDocument<E>, element: E): void {
    visitPresentationElements(doc.tree, element, function (current: E): void {
        const id = doc.tree.attribute(current, 'id');
        if (id !== null && doc.elements.get(id) === current) {
            doc.elements.remove(id);
        }
    });
    doc.tree.detach(element);
}

export function findPresentationElement<E>(doc: PresentationDocument<E>, id: string): E | null {
    return doc.elements.get(id);
}

/**
 * Applies the changes in order to the document. The caller has validated them, see
 * validatePresentationChanges.
 */
export function applyPresentationChanges<E>(doc: PresentationDocument<E>, app: string, changes: PresentationChange[]): PresentationChangeResult {
    const result: PresentationChangeResult = { sigoptions: [], notes: [] };
    changes.forEach(function (change: PresentationChange, index: number): void {
        const operation = presentationOperationOf(change);
        if (operation === 'add') {
            addPresentationElement(doc, app, index, change, result);
        } else if (operation === 'modify') {
            modifyPresentationElement(doc, app, index, change, result);
        } else if (operation === 'move') {
            movePresentationElement(doc, app, index, change);
        } else {
            removePresentationElement(doc, app, index, change, result);
        }
    });
    return result;
}

export function resolvePresentationReference<E>(
    doc: PresentationDocument<E>,
    app: string,
    index: number,
    operation: string,
    prefix: string,
    reference: PresentationReference,
    required: boolean
): E | null {
    const element = findPresentationElement(doc, reference.id);
    if (element === null) {
        if (required) {
            throw presentationChangeError(app, index, operation, prefix + reference.name + ' "' + reference.id + '" was not found.');
        }
        return null;
    }

    const name = doc.tree.name(element);
    if (name !== reference.name) {
        throw presentationChangeError(app, index, operation, '"' + reference.id + '" is a ' + name + ', not a ' + reference.name + '.');
    }
    return element;
}

export function resolvePresentationAnchor<E>(doc: PresentationDocument<E>, app: string, index: number, operation: string, change: PresentationChange): PresentationAnchor<E> | null {
    const placement = presentationPlacementOf(change);
    if (placement === null) {
        return null;
    }

    const element = resolvePresentationReference(doc, app, index, operation, 'anchor ', change[placement], true);
    if (placement !== 'into' && element === doc.tree.root()) {
        throw presentationChangeError(app, index, operation, 'cannot place ' + placement + ' the root element, use into instead.');
    }
    return { placement: placement, element: element };
}

export function placePresentationElement<E>(tree: PresentationTree<E>, anchor: PresentationAnchor<E> | null, element: E): void {
    if (anchor === null) {
        tree.append(tree.root(), element);
    } else if (anchor.placement === 'into') {
        tree.append(anchor.element, element);
    } else if (anchor.placement === 'before') {
        tree.insertBefore(anchor.element, element);
    } else {
        tree.insertAfter(anchor.element, element);
    }
}

export function isPresentationDescendant<E>(tree: PresentationTree<E>, element: E, ancestor: E): boolean {
    let current: E | null = element;
    while (current !== null) {
        if (current === ancestor) {
            return true;
        }
        current = tree.parent(current);
    }
    return false;
}

export function buildPresentationElement<E>(tree: PresentationTree<E>, definition: PresentationElement): E {
    const element = tree.create(definition.name);
    tree.setAttribute(element, 'id', definition.id);
    Object.keys(definition).forEach(function (key: string): void {
        if (presentationReservedKeys().indexOf(key) < 0) {
            tree.setAttribute(element, key, definition[key]);
        }
    });
    (definition.children || []).forEach(function (child: PresentationElement): void {
        tree.append(element, buildPresentationElement(tree, child));
    });
    return element;
}

/** Inserts the content at the placement, or replaces the control with the same id in place. */
export function addPresentationElement<E>(doc: PresentationDocument<E>, app: string, index: number, change: PresentationChange, result: PresentationChangeResult): void {
    const definition = change.add;
    const existing = resolvePresentationReference(doc, app, index, 'add', '', definition, false);
    if (existing === doc.tree.root()) {
        throw presentationChangeError(app, index, 'add', 'the root element "' + definition.id + '" cannot be replaced.');
    }

    // The content of a replaced control is removed with it, so its ids may be used again.
    const HashSet = Java.type('java.util.HashSet');
    const replacedIds = new HashSet();
    if (existing !== null) {
        visitPresentationElements(doc.tree, existing, function (element: E): void {
            replacedIds.add(doc.tree.attribute(element, 'id'));
        });
    }

    const addedIds = new HashSet();
    visitPresentationDefinitions(definition, function (element: PresentationElement): void {
        if (!addedIds.add(element.id)) {
            throw presentationChangeError(app, index, 'add', 'id "' + element.id + '" is declared more than once in the added content.');
        }
        if (!replacedIds.contains(element.id) && findPresentationElement(doc, element.id) !== null) {
            throw presentationChangeError(app, index, 'add', 'id "' + element.id + '" already exists in the presentation.');
        }
        if (isPresentationName(element.sigoption)) {
            result.sigoptions.push({ sigoption: element.sigoption, index: index, operation: 'add' });
        }
    });

    const anchor = existing === null ? resolvePresentationAnchor(doc, app, index, 'add', change) : null;
    const element = buildPresentationElement(doc.tree, definition);
    if (existing !== null) {
        doc.tree.insertBefore(existing, element);
        detachPresentationElement(doc, existing);
    } else {
        placePresentationElement(doc.tree, anchor, element);
    }
    indexPresentationElements(doc, element);
}

export function modifyPresentationElement<E>(doc: PresentationDocument<E>, app: string, index: number, change: PresentationChange, result: PresentationChangeResult): void {
    const element = resolvePresentationReference(doc, app, index, 'modify', '', change.modify, true);
    const set = change.set || {};
    Object.keys(set).forEach(function (key: string): void {
        doc.tree.setAttribute(element, key, set[key]);
        if (key === 'sigoption' && isPresentationName(set[key])) {
            result.sigoptions.push({ sigoption: set[key], index: index, operation: 'modify' });
        }
    });
    (change.unset || []).forEach(function (key: string): void {
        doc.tree.removeAttribute(element, key);
    });
}

export function movePresentationElement<E>(doc: PresentationDocument<E>, app: string, index: number, change: PresentationChange): void {
    const element = resolvePresentationReference(doc, app, index, 'move', '', change.move, true);
    if (element === doc.tree.root()) {
        throw presentationChangeError(app, index, 'move', 'the root element cannot be moved.');
    }

    const anchor = resolvePresentationAnchor(doc, app, index, 'move', change);
    if (isPresentationDescendant(doc.tree, anchor.element, element)) {
        throw presentationChangeError(app, index, 'move', 'cannot move ' + change.move.name + ' "' + change.move.id + '" relative to itself or its own content.');
    }

    doc.tree.detach(element);
    placePresentationElement(doc.tree, anchor, element);
}

export function removePresentationElement<E>(doc: PresentationDocument<E>, app: string, index: number, change: PresentationChange, result: PresentationChangeResult): void {
    const element = resolvePresentationReference(doc, app, index, 'remove', '', change.remove, false);
    if (element === null) {
        result.notes.push(presentationChangeError(app, index, 'remove', change.remove.name + ' "' + change.remove.id + '" was not found, nothing to remove.').message);
        return;
    }
    if (element === doc.tree.root()) {
        throw presentationChangeError(app, index, 'remove', 'the root element cannot be removed.');
    }
    detachPresentationElement(doc, element);
}

/** The records grouped by app, in payload order, so several entries for one app apply to one document. */
export function groupPresentationsByApp(records: MaximoPresentation[]): MaximoPresentation[][] {
    const groups: MaximoPresentation[][] = [];
    const positions: Record<string, number> = {};
    records.forEach(function (record: MaximoPresentation): void {
        if (!Object.prototype.hasOwnProperty.call(positions, record.app)) {
            positions[record.app] = groups.length;
            groups.push([]);
        }
        groups[positions[record.app]].push(record);
    });
    return groups;
}

/**
 * Applies every change in memory and checks every reference before anything in the payload is
 * written, then leaves the result on the last record of each app for process to write.
 */
export function preparePresentations(records: MaximoPresentation[]): void {
    groupPresentationsByApp(records).forEach(function (group: MaximoPresentation[]): void {
        const app = group[0].app;
        updateProgress('Preparing presentation changes for ' + app);

        const document = parseJdomDocument(readPresentationXml(app));
        const doc = indexPresentation(createJdomTree(document));
        const notes: string[] = [];
        group.forEach(function (record: MaximoPresentation): void {
            const result = applyPresentationChanges(doc, app, record.changes);
            if (doc.tree.name(doc.tree.root()) === 'presentation') {
                verifyPresentationSigoptions(app, result);
            }
            result.notes.forEach(function (note: string): void {
                notes.push(note);
            });
        });

        group[group.length - 1]._prepared = preparePresentationWrite(app, serializeJdomDocument(document));
        notes.forEach(updateInfo);
    });

    if (records.length > 0) {
        records[records.length - 1]._reloadCaches = true;
    }
}

export function verifyPresentationSigoptions(app: string, result: PresentationChangeResult): void {
    if (result.sigoptions.length === 0) {
        return;
    }

    const missing = findMissingSigoptions(
        app,
        result.sigoptions.map(function (use: PresentationSigoptionUse): string {
            return use.sigoption;
        })
    );
    result.sigoptions.forEach(function (use: PresentationSigoptionUse): void {
        if (missing.indexOf(use.sigoption.toUpperCase()) >= 0) {
            throw presentationChangeError(app, use.index, use.operation, 'signature option "' + use.sigoption + '" does not exist for the application.');
        }
    });
}

export function processPresentation(record: MaximoPresentation): void {
    if (record._prepared !== null) {
        updateProgress('Updating presentation ' + record.app);
        writePresentation(record._prepared);
        updateProgress('Updated presentation ' + record.app);
    }
    if (record._reloadCaches) {
        reloadPresentationCaches();
    }
}
