/**
 * The retained values engine: applies a snapshot of an existing record to a deployment payload that
 * marks properties with "_retain". See docs/modules/nashorn-library.md for the contract.
 *
 * Knows nothing about any configuration type, and must stay free of Java.type so it can be unit
 * tested outside Maximo.
 */

/** "_retain" is itself an array, so markers have to be excluded before collections are detected. */
function retainIsMarker(name: string): boolean {
    return name.charAt(0) === '_';
}

/** A collection is any array of objects on the payload; the model classes already declare which. */
function retainIsCollection(value: any): boolean {
    return Array.isArray(value) && (value.length === 0 || (value[0] !== null && typeof value[0] === 'object'));
}

/** The natural key of a collection's rows. An empty collection has nothing to match, so none. */
function retainKeysOf(rows: any[]): string[] {
    const first = rows.length > 0 ? rows[0] : null;
    const keys = first && first.constructor ? (first.constructor as any)._keys : null;
    return Array.isArray(keys) ? keys : [];
}

function retainSameRow(left: any, right: any, keys: string[]): boolean {
    if (!left || !right || keys.length === 0) {
        return false;
    }

    for (let index = 0; index < keys.length; index++) {
        if (left[keys[index]] !== right[keys[index]]) {
            return false;
        }
    }

    return true;
}

function retainFindRow(rows: any[], row: any, keys: string[]): any {
    for (let index = 0; index < rows.length; index++) {
        if (retainSameRow(rows[index], row, keys)) {
            return rows[index];
        }
    }

    return null;
}

function retainCollectionNames(target: any): string[] {
    const names: string[] = [];
    for (const name in target) {
        if (Object.prototype.hasOwnProperty.call(target, name) && !retainIsMarker(name) && retainIsCollection(target[name])) {
            names.push(name);
        }
    }

    return names;
}

/** Whether anything in the tree asks for retention, so an ordinary payload can skip capture. */
export function hasRetainDeclarations(target: any): boolean {
    if (!target) {
        return false;
    }

    if (Array.isArray(target._retain) && target._retain.length > 0) {
        return true;
    }

    const names = retainCollectionNames(target);
    for (let nameIndex = 0; nameIndex < names.length; nameIndex++) {
        const rows = target[names[nameIndex]];
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
            if (hasRetainDeclarations(rows[rowIndex])) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Copies retained scalars from the snapshot, recursing into collections matched by natural key. A
 * row with no snapshot counterpart is left alone, so a newly shipped row gets the product default.
 * A "_retain" entry naming a collection instead appends the snapshot rows the payload does not
 * declare, so rows the customer added survive.
 */
function retainInto(target: any, snapshot: any): void {
    if (!target || !snapshot) {
        return;
    }

    const declared = Array.isArray(target._retain) ? target._retain : [];
    const retainedCollections: string[] = [];

    for (let index = 0; index < declared.length; index++) {
        const name = declared[index];
        if (typeof name !== 'string' || retainIsMarker(name)) {
            continue;
        }

        if (retainIsCollection(target[name])) {
            retainedCollections.push(name);
        } else if (Object.prototype.hasOwnProperty.call(snapshot, name)) {
            target[name] = snapshot[name];
        }
    }

    retainCollectionNames(target).forEach(function (name: string): void {
        const targetRows = target[name];
        const snapshotRows = Array.isArray(snapshot[name]) ? snapshot[name] : [];
        const keys = retainKeysOf(targetRows);

        targetRows.forEach(function (row: any): void {
            retainInto(row, retainFindRow(snapshotRows, row, keys));
        });

        if (retainedCollections.indexOf(name) === -1) {
            return;
        }

        for (let index = 0; index < snapshotRows.length; index++) {
            const row = snapshotRows[index];
            if (row && !retainFindRow(targetRows, row, keys)) {
                targetRows.push(row);
            }
        }
    });
}

/**
 * Applies the snapshot and returns the result rebuilt through the payload's own model constructors,
 * which default every property the snapshot omitted. Without that rebuild an appended snapshot row
 * can be missing a collection the apply layer dereferences, or a scalar setValue silently skips.
 * Mutates target as well, so a caller ignoring the return value still sees the retained scalars.
 */
export function applyRetainedValues(target: any, snapshot: any): any {
    retainInto(target, snapshot);

    if (!target || !target.constructor) {
        return target;
    }

    return new target.constructor(target);
}

/** The record's natural key values joined into one string, used as the snapshot identity. */
export function retainIdentityOf(target: any): string {
    const keys = target && target.constructor ? (target.constructor as any)._keys : null;
    if (!Array.isArray(keys) || keys.length === 0) {
        throw Error('Cannot identify this record for retention because its model declares no _keys.');
    }

    const values: string[] = [];
    for (let index = 0; index < keys.length; index++) {
        values.push(String(target[keys[index]]));
    }

    return values.join(':');
}
