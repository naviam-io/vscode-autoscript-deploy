/// <reference path="../../globals.d.ts" />
/// <reference path="../../manage-facade.d.ts" />

import { arrayOrEmpty, close, rejectDuplicates, requireKeys, setValue, updateProgress, valueOrDefault } from '../core/util';
import { applyRetainedValues, hasRetainDeclarations, retainIdentityOf } from '../core/retained-values';
import { deleteSnapshot, readSnapshot, snapshotKey, writeSnapshot } from '../core/snapshot-store';
import { captureExistingState } from '../core/capture';

var MXServer = Java.type('psdi.server.MXServer');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');

/** The Maximo object an end point snapshot is keyed by. */
export const SNAPSHOT_OBJECT = 'MAXENDPOINT';

export function process(endPoint: MaximoEndPoint): void {
    const maximo: psdi.server.MXServer = MXServer.getMXServer();
    const key = snapshotKey(SNAPSHOT_OBJECT, retainIdentityOf(endPoint));
    let mboSet: psdi.mbo.MboSetRemote | null = null;
    try {
        mboSet = maximo.getMboSet('MAXENDPOINT', maximo.getSystemUserInfo());

        if (endPoint._delete) {
            updateProgress('Deleting end point ' + endPoint.endPointName);
            deleteEndPoint(mboSet, endPoint);
            deleteSnapshot(key);
            updateProgress('Deleted end point ' + endPoint.endPointName);
        } else {
            updateProgress('Adding/Updating end point ' + endPoint.endPointName);
            addOrUpdateEndPoint(mboSet, endPoint, key);
            deleteSnapshot(key);
            updateProgress('Added/Updated end point ' + endPoint.endPointName);
        }
    } finally {
        close(mboSet);
    }
}

function deleteEndPoint(mboSet: psdi.mbo.MboSetRemote, endPoint: MaximoEndPoint): void {
    const mbo = findEndPoint(mboSet, endPoint.endPointName);
    if (mbo) {
        mbo.delete();
        mboSet.save();
    }
}

function addOrUpdateEndPoint(mboSet: psdi.mbo.MboSetRemote, endPoint: MaximoEndPoint, key: string): void {
    const existing = findEndPoint(mboSet, endPoint.endPointName);

    if (hasRetainDeclarations(endPoint)) {
        let snapshot = readSnapshot(key);
        if (!snapshot && existing) {
            snapshot = captureExistingState('endpoints', existing.getUniqueIDValue());
            if (!snapshot) {
                throw Error(
                    'End point ' +
                        endPoint.endPointName +
                        ' has an existing record whose state could not be captured, so its retained values cannot be preserved.'
                );
            }
            writeSnapshot(key, snapshot);
        }

        endPoint = applyRetainedValues(endPoint, snapshot ? new MaximoEndPoint(snapshot) : null);
    }

    let mbo = existing;
    if (!mbo) {
        mbo = mboSet.add();
        mbo.setValue('ENDPOINTNAME', endPoint.endPointName);
    }
    // The handler is read only once set, so Maximo rejects a change to it.
    if (endPoint.handlerName && endPoint.handlerName !== mbo.getString('HANDLERNAME')) {
        mbo.setValue('HANDLERNAME', endPoint.handlerName);
    }

    setValue(mbo, 'DESCRIPTION', endPoint.description);
    applyEndPointProperties(mbo, endPoint);

    mboSet.save();
}

/** The handler creates the property rows, so only the values of the listed rows are written. */
function applyEndPointProperties(mbo: psdi.mbo.MboRemote, endPoint: MaximoEndPoint): void {
    if (endPoint.properties.length === 0) {
        return;
    }

    const rows: Record<string, psdi.mbo.MboRemote> = {};
    const detailSet = mbo.getMboSet('MAXENDPOINTDTL');
    let row = detailSet.moveFirst();
    while (row) {
        rows[row.getString('PROPERTY')] = row;
        row = detailSet.moveNext();
    }

    endPoint.properties.forEach(function (property: MaximoEndPointProperty): void {
        const detail = rows[property.property];
        if (!detail) {
            throw Error(
                'End point ' + endPoint.endPointName + ' property ' + property.property + ' is not defined by the handler ' + mbo.getString('HANDLERNAME') + '.'
            );
        }

        // An encrypted row keeps its value in PASSWORD, and Maximo makes VALUE read only; a plain row is the reverse.
        const encrypted = (detail as any).getMboValueData('VALUE').isReadOnly();
        if (typeof property.value !== 'undefined' && encrypted) {
            throw Error('End point ' + endPoint.endPointName + ' property ' + property.property + ' is encrypted, so set it with password instead of value.');
        }
        if (typeof property.password !== 'undefined' && !encrypted) {
            throw Error(
                'End point ' + endPoint.endPointName + ' property ' + property.property + ' is not encrypted, so set it with value instead of password.'
            );
        }

        setValue(detail, 'VALUE', property.value);
        setValue(detail, 'PASSWORD', property.password);
        setValue(detail, 'ALLOWOVERRIDE', property.allowOverride);
    });
}

function findEndPoint(mboSet: psdi.mbo.MboSetRemote, endPointName: string): psdi.mbo.MboRemote {
    const sqlf = new SqlFormat('endpointname = :1');
    sqlf.setObject(1, 'MAXENDPOINT', 'ENDPOINTNAME', endPointName);
    mboSet.setWhere(sqlf.format());
    return mboSet.moveFirst();
}

export interface MaximoEndPointPropertyInput {
    property: string;
    value?: string | null;
    password?: string | null;
    allowOverride?: boolean | null;
    _retain?: any;
}

/** A value left undefined is not deployed, so the target keeps it. */
export class MaximoEndPointProperty {
    static _keys = ['property'];

    property: string;
    value: string | null | undefined;
    password: string | null | undefined;
    allowOverride: boolean | undefined;
    _retain: any = [];

    constructor(input: MaximoEndPointPropertyInput, endPointName: string) {
        if (typeof input.property === 'undefined' || !input.property) {
            throw new Error('A property for end point ' + endPointName + ' is missing or has an empty value for the required property name.');
        }
        if (typeof input.value !== 'undefined' && typeof input.password !== 'undefined') {
            throw new Error(
                'End point ' + endPointName + ' property ' + input.property + ' sets both value and password, but a property holds only one of them.'
            );
        }

        this.property = input.property;
        this.value = input.value;
        this.password = input.password;
        this.allowOverride = typeof input.allowOverride === 'undefined' || input.allowOverride === null ? undefined : input.allowOverride == true;
        this._retain = valueOrDefault(input._retain, this._retain);
    }
}

export interface MaximoEndPointInput {
    _delete?: boolean;
    endPointName: string;
    description?: string | null;
    handlerName?: string | null;
    properties?: MaximoEndPointPropertyInput[] | null;
    _retain?: any;
}

export class MaximoEndPoint {
    static _keys = ['endPointName'];

    _delete = false;
    endPointName: string;
    description: string | null = '';
    handlerName: string | null = null;
    properties: MaximoEndPointProperty[] = [];
    _retain: any = [];

    constructor(input: MaximoEndPointInput) {
        requireKeys(MaximoEndPoint, input, 'end point');
        this._delete = valueOrDefault(input._delete, this._delete);
        this.endPointName = input.endPointName;
        this.description = valueOrDefault(input.description, this.description);
        this.handlerName = valueOrDefault(input.handlerName, this.handlerName);
        this.properties = arrayOrEmpty(input.properties).map((property) => new MaximoEndPointProperty(property, this.endPointName));
        rejectDuplicates('End point ' + this.endPointName, 'property', this.properties, MaximoEndPointProperty._keys);
        this._retain = valueOrDefault(input._retain, this._retain);
    }
}
