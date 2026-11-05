/*
 * A plain object document for running the presentation delta engine in Node, standing in for the
 * JDOM adapter the library uses inside Maximo.
 */
import fs from 'fs';
import path from 'path';
import xml2js from 'xml2js';

import { REPO_ROOT } from '../harness.js';

function toNode(name, value, parent) {
    const node = { name: name, attributes: Object.assign({}, value.$ || {}), children: [], parent: parent };
    (value.$$ || []).forEach((child) => node.children.push(toNode(child['#name'], child, node)));
    return node;
}

export async function parsePresentation(xml) {
    const parsed = await xml2js.parseStringPromise(xml, { explicitChildren: true, preserveChildrenOrder: true, explicitRoot: true });
    const rootName = Object.keys(parsed)[0];
    return toNode(rootName, parsed[rootName], null);
}

export function loadFixture(name) {
    return parsePresentation(fs.readFileSync(path.join(REPO_ROOT, 'test', 'unit', 'fixtures', 'presentations', name + '.xml'), 'utf8'));
}

function detach(node) {
    if (node.parent) {
        node.parent.children.splice(node.parent.children.indexOf(node), 1);
        node.parent = null;
    }
}

function insertAt(parent, position, child) {
    detach(child);
    parent.children.splice(position, 0, child);
    child.parent = parent;
}

export function createTree(root) {
    return {
        root: () => root,
        name: (node) => node.name,
        attribute: (node, key) => (Object.prototype.hasOwnProperty.call(node.attributes, key) ? node.attributes[key] : null),
        setAttribute: (node, key, value) => {
            node.attributes[key] = value;
        },
        removeAttribute: (node, key) => {
            delete node.attributes[key];
        },
        children: (node) => node.children.slice(),
        parent: (node) => node.parent,
        create: (name) => ({ name: name, attributes: {}, children: [], parent: null }),
        append: (parent, child) => insertAt(parent, parent.children.length, child),
        insertBefore: (anchor, child) => insertAt(anchor.parent, anchor.parent.children.indexOf(anchor), child),
        insertAfter: (anchor, child) => insertAt(anchor.parent, anchor.parent.children.indexOf(anchor) + 1, child),
        detach: detach
    };
}

export function findById(node, id) {
    if (node.attributes.id === id) {
        return node;
    }
    for (const child of node.children) {
        const found = findById(child, id);
        if (found) {
            return found;
        }
    }
    return null;
}

export function childIds(node) {
    return node.children.map((child) => child.attributes.id);
}

/** The document as nested name#id lines, for comparing whole states. */
export function outline(node, depth = 0) {
    return ['  '.repeat(depth) + node.name + '#' + node.attributes.id].concat(...node.children.map((child) => outline(child, depth + 1))).join('\n');
}
