/// <reference path="../../globals.d.ts" />

import type { PresentationTree } from '../config/presentations';

interface JdomTypes {
    builder: any;
    element: any;
    format: any;
    outputter: any;
}

let cachedJdomTypes: JdomTypes | null = null;

/** JDOM2 where available; older Maximo versions only ship the legacy JDOM. */
export function jdomTypes(): JdomTypes {
    if (cachedJdomTypes === null) {
        let prefix = 'org.jdom2';
        try {
            Java.type(prefix + '.Element');
        } catch (ignored) {
            prefix = 'org.jdom';
        }
        cachedJdomTypes = {
            builder: Java.type(prefix + '.input.SAXBuilder'),
            element: Java.type(prefix + '.Element'),
            format: Java.type(prefix + '.output.Format'),
            outputter: Java.type(prefix + '.output.XMLOutputter')
        };
    }
    return cachedJdomTypes;
}

export function parseJdomDocument(xml: string): any {
    const StringReader = Java.type('java.io.StringReader');
    return new (jdomTypes().builder)().build(new StringReader(xml));
}

export function serializeJdomDocument(document: any): string {
    const types = jdomTypes();
    return String(new types.outputter(types.format.getPrettyFormat()).outputString(document));
}

export function jdomChildren(element: any): any[] {
    const list = element.getChildren();
    const children: any[] = [];
    for (let i = 0; i < list.size(); i++) {
        children.push(list.get(i));
    }
    return children;
}

export function createJdomTree(document: any): PresentationTree<any> {
    return {
        root: function (): any {
            return document.getRootElement();
        },
        name: function (element: any): string {
            return String(element.getName());
        },
        attribute: function (element: any, key: string): string | null {
            const value = element.getAttributeValue(key);
            return value === null || typeof value === 'undefined' ? null : String(value);
        },
        setAttribute: function (element: any, key: string, value: string): void {
            element.setAttribute(key, value);
        },
        removeAttribute: function (element: any, key: string): void {
            element.removeAttribute(key);
        },
        children: jdomChildren,
        parent: function (element: any): any {
            const parent = element.getParentElement();
            return parent === null || typeof parent === 'undefined' ? null : parent;
        },
        create: function (name: string): any {
            return new (jdomTypes().element)(name);
        },
        append: function (parent: any, child: any): void {
            parent.addContent(child);
        },
        insertBefore: function (anchor: any, child: any): void {
            const parent = anchor.getParentElement();
            parent.addContent(parent.indexOf(anchor), child);
        },
        insertAfter: function (anchor: any, child: any): void {
            const parent = anchor.getParentElement();
            parent.addContent(parent.indexOf(anchor) + 1, child);
        },
        detach: function (element: any): void {
            element.detach();
        }
    };
}
