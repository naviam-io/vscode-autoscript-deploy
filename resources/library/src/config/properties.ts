/// <reference path="../../globals.d.ts" />
/// <reference path="../../manage-facade.d.ts" />

import { applyValues, applyWritableValues, arrayOrEmpty, booleanOrDefault, close, requireKeys, toExternalSynonymValue, updateProgress, valueOrDefault } from '../core/util';
import { applyRetainedValues, hasRetainDeclarations, retainIdentityOf } from '../core/retained-values';
import { deleteSnapshot, readSnapshot, snapshotKey, writeSnapshot } from '../core/snapshot-store';
import { captureExistingState } from '../core/capture';

var MXServer = Java.type('psdi.server.MXServer');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');
var MboConstants = Java.type('psdi.mbo.MboConstants');
export type MaximoPropertyType = 'ALN' | 'INTEGER' | 'YORN';

/** The Maximo object a property snapshot is keyed by. */
export const SNAPSHOT_OBJECT = 'MAXPROP';

export function process(property: MaximoProperty): void {
    const maximo: psdi.server.MXServer = MXServer.getMXServer();
    const key = snapshotKey(SNAPSHOT_OBJECT, retainIdentityOf(property));
    let mboSet: psdi.mbo.MboSetRemote | null = null;
    try {
        mboSet = maximo.getMboSet('MAXPROP', maximo.getSystemUserInfo());

        if (property._delete) {
            updateProgress('Deleting property ' + property.propName);
            deleteProperty(mboSet, property);
            deleteSnapshot(key);
            updateProgress('Deleted property ' + property.propName);
        } else {
            updateProgress('Adding/Updating property ' + property.propName);
            addOrUpdateProperty(mboSet, property, key);
            deleteSnapshot(key);
            updateProgress('Added/Updated property ' + property.propName);
        }
    } finally {
        close(mboSet);
    }
}

function deleteProperty(mboSet: psdi.mbo.MboSetRemote, property: MaximoProperty): void {
    const mbo = findProperty(mboSet, property.propName);
    if (mbo) {
        mbo.delete();
        mboSet.save();
    }
}

function addOrUpdateProperty(mboSet: psdi.mbo.MboSetRemote, property: MaximoProperty, key: string): void {
    const maximo: psdi.server.MXServer = MXServer.getMXServer();

    const existing = findProperty(mboSet, property.propName);

    if (hasRetainDeclarations(property)) {
        let snapshot = readSnapshot(key);
        if (!snapshot && existing) {
            snapshot = captureExistingState('properties', existing.getUniqueIDValue());
            if (!snapshot) {
                throw Error(
                    'Property ' + property.propName + ' has an existing record whose state could not be captured, so its retained values cannot be preserved.'
                );
            }
            writeSnapshot(key, snapshot);
        }

        property = applyRetainedValues(property, snapshot ? new MaximoProperty(snapshot) : null);
    }

    const mbo = existing || mboSet.add();
    applyPropertyValues(mbo, property);
    applyPropertyInstances(mbo, property);

    mboSet.save();
    mbo.select();
    if (mbo.getBoolean('LIVEREFRESH')) {
        // refresh the properties so the current value is available.
        maximo.reloadMaximoCache('MAXPROP', property.propName, true);
    }
}

function findProperty(mboSet: psdi.mbo.MboSetRemote, propName: string): psdi.mbo.MboRemote {
    const sqlf = new SqlFormat('propname = :1');
    sqlf.setObject(1, 'MAXPROP', 'PROPNAME', propName);
    mboSet.setWhere(sqlf.format());
    return mboSet.moveFirst();
}

function applyPropertyValues(mbo: psdi.mbo.MboRemote, property: MaximoProperty): void {
    if ((mbo as any).isSystemProperty()) {
        applySystemPropertyValues(mbo, property);
    } else {
        applyCustomPropertyValues(mbo, property);
    }
}

function applySystemPropertyValues(mbo: psdi.mbo.MboRemote, property: MaximoProperty): void {
    applyValues(mbo, [
        ['DESCRIPTION', property.description],
        ['ENCRYPTED', property.encrypted],
        ['MASKED', property.masked],
        ['DISPPROPVALUE', property.propValue, MboConstants.NOACCESSCHECK]
    ]);
}

function applyCustomPropertyValues(mbo: psdi.mbo.MboRemote, property: MaximoProperty): void {
    if (mbo.toBeAdded()) {
        applyValues(mbo, [['PROPNAME', property.propName]]);
    }

    mbo.setValue('MAXIMODEFAULT', property.maximoDefault, MboConstants.NOACCESSCHECK);
    applyValues(mbo, [
        ['DESCRIPTION', property.description],
        ['ENCRYPTED', property.encrypted],
        ['MASKED', property.masked]
    ]);

    applyWritableValues(mbo, [
        ['DOMAINID', property.domainId],
        ['GLOBALONLY', property.globalOnly],
        ['LIVEREFRESH', property.liveRefresh],
        ['MAXTYPE', property.maxType],
        ['NULLSALLOWED', property.nullsAllowed],
        ['ONLINECHANGES', property.onlineChanges],
        ['SECURELEVEL', toExternalSynonymValue('PROPSECURELEVEL', property.secureLevel, mbo)]
    ]);

    mbo.setValue('INSTANCEONLY', property.instanceOnly, MboConstants.NOACCESSCHECK);

    if (!property.instanceOnly) {
        // ONLINECHANGES only stops changes in the System Properties application, not a deployment.
        applyValues(mbo, [['DISPPROPVALUE', property.propValue, MboConstants.NOACCESSCHECK]]);
    }
}

function applyPropertyInstances(mbo: psdi.mbo.MboRemote, property: MaximoProperty): void {
    const maxPropInstanceSet = mbo.getMboSet('MAXPROPINSTANCE');
    maxPropInstanceSet.deleteAll();

    if (property.globalOnly) {
        return;
    }

    property.maxPropInstance.forEach(function (instance: MaximoPropertyInstance) {
        const maxPropInstance = maxPropInstanceSet.add();

        maxPropInstance.setValue('DISPPROPVALUE', instance.propValue, MboConstants.NOVALIDATION);
        maxPropInstance.setValue('SERVERNAME', instance.serverName);
        maxPropInstance.setValue('SERVERHOST', instance.serverHost);
    });
}

export interface MaximoPropertyInstanceInput {
    serverName: string;
    propValue?: string | null;
    serverHost?: string | null;
    _retain?: any;
}

export class MaximoPropertyInstance {
    static _keys = ['serverName', 'serverHost'];

    serverName: string;
    propValue: string | null = '';
    serverHost: string | null = '';
    _retain: any = [];

    constructor(input: MaximoPropertyInstanceInput, propName: string) {
        if (typeof input.serverName === 'undefined' || !input.serverName) {
            throw new Error('A property instance for property ' + propName + ' is missing or has an empty value for the required serverName property.');
        }

        if ((input.serverName as any).toLowerCase() == 'common') {
            throw new Error(
                'A property instance for property ' +
                    propName +
                    ' has a value of COMMON for the serverName property, define COMMON property values using the dispPropValue property on the root property object.'
            );
        }

        this.serverName = input.serverName;
        this.propValue = valueOrDefault(input.propValue, this.propValue);
        this.serverHost = valueOrDefault(input.serverHost, this.serverHost);
        this._retain = valueOrDefault(input._retain, this._retain);
    }
}

export interface MaximoPropertyInput {
    _delete?: boolean;
    propName: string;
    description?: string | null;
    domainId?: string | null;
    encrypted?: boolean | null;
    globalOnly?: boolean | null;
    instanceOnly?: boolean | null;
    liveRefresh?: boolean | null;
    masked?: boolean | null;
    maxType?: MaximoPropertyType | null;
    nullsAllowed?: boolean | null;
    onlineChanges?: boolean | null;
    secureLevel?: string | null;
    propValue?: string | null;
    maximoDefault?: string | null;
    maxPropInstance?: MaximoPropertyInstanceInput[] | null;
    _retain?: any;
}

export class MaximoProperty {
    static _keys = ['propName'];

    _delete = false;
    propName: string;
    description: string | null = '';
    domainId: string | null = '';
    encrypted = false;
    globalOnly = false;
    instanceOnly = false;
    liveRefresh = true;
    masked = false;
    maxType: MaximoPropertyType | null = 'ALN';
    nullsAllowed = true;
    onlineChanges = true;
    secureLevel: string | null = '!PUBLIC!';
    propValue: string | null = '';
    maximoDefault: string | null = '';
    maxPropInstance: MaximoPropertyInstance[] = [];
    _retain: any = [];

    constructor(input: MaximoPropertyInput) {
        requireKeys(MaximoProperty, input, 'property');
        this._delete = valueOrDefault(input._delete, this._delete);
        this.propName = input.propName;

        this.description = valueOrDefault(input.description, this.description);
        this.domainId = valueOrDefault(input.domainId, this.domainId);
        this.encrypted = booleanOrDefault(input.encrypted, this.encrypted);
        this.globalOnly = booleanOrDefault(input.globalOnly, this.globalOnly);
        this.instanceOnly = booleanOrDefault(input.instanceOnly, this.instanceOnly);
        this.liveRefresh = booleanOrDefault(input.liveRefresh, this.liveRefresh);
        this.masked = booleanOrDefault(input.masked, this.masked);
        this.maxType = valueOrDefault(input.maxType, this.maxType);
        this.nullsAllowed = booleanOrDefault(input.nullsAllowed, this.nullsAllowed);
        this.onlineChanges = booleanOrDefault(input.onlineChanges, this.onlineChanges);
        this.secureLevel = valueOrDefault(input.secureLevel, this.secureLevel);
        this.propValue = valueOrDefault(input.propValue, this.propValue);
        this.maximoDefault = valueOrDefault(input.maximoDefault, this.maximoDefault);
        this.maxPropInstance = arrayOrEmpty(input.maxPropInstance).map((instance) => new MaximoPropertyInstance(instance, this.propName));
        this._retain = valueOrDefault(input._retain, this._retain);
    }
}
