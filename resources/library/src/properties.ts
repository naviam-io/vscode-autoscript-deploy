/// <reference path="../globals.d.ts" />
/// <reference path="../manage-facade.d.ts" />

import { applyValues, close, updateProgress, valueOrDefault } from './util';

var MXServer = Java.type('psdi.server.MXServer');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');
var MboConstants = Java.type('psdi.mbo.MboConstants');
export type MaximoPropertyType = 'ALN' | 'INTEGER' | 'YORN';
export type MaximoSecureLevel = 'PRIVATE' | 'PUBLIC' | 'SECURE';

export function process(property: MaximoProperty): void {
    const maximo: psdi.server.MXServer = MXServer.getMXServer();
    let mboSet: psdi.mbo.MboSetRemote | null = null;
    try {
        mboSet = maximo.getMboSet('MAXPROP', maximo.getSystemUserInfo());

        if (property._delete) {
            updateProgress('Deleting property ' + property.propName);
            deleteProperty(mboSet, property);
            updateProgress('Deleted property ' + property.propName);
        } else {
            updateProgress('Adding/Updating property ' + property.propName);
            addOrUpdateProperty(mboSet, property);
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

function addOrUpdateProperty(mboSet: psdi.mbo.MboSetRemote, property: MaximoProperty): void {
    const maximo: psdi.server.MXServer = MXServer.getMXServer();

    const mbo = findProperty(mboSet, property.propName) || mboSet.add();
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
        ['DISPPROPVALUE', property.propValue]
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
        ['INSTANCEONLY', property.instanceOnly],
        ['LIVEREFRESH', property.liveRefresh],
        ['MAXTYPE', property.maxType],
        ['NULLSALLOWED', property.nullsAllowed],
        ['ONLINECHANGES', property.onlineChanges],
        ['SECURELEVEL', property.secureLevel]
    ]);

    if (!property.instanceOnly) {
        applyValues(mbo, [['DISPPROPVALUE', property.propValue]]);
    }
}

function applyWritableValues(mbo: psdi.mbo.MboRemote, updates: Array<[string, any]>): void {
    applyValues(
        mbo,
        updates.filter(function (update) {
            return !(mbo as any).getMboValue(update[0]).isReadOnly();
        })
    );
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

function booleanOrDefault(value: any, defaultValue: boolean): boolean {
    return typeof value === 'undefined' ? defaultValue : value == true;
}

export interface MaximoPropertyInstanceInput {
    serverName: string;
    propValue?: string | null;
    serverHost?: string | null;
}

export class MaximoPropertyInstance {
    serverName: string;
    propValue: string | null = '';
    serverHost: string | null = '';

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
    secureLevel?: MaximoSecureLevel | null;
    propValue?: string | null;
    maximoDefault?: string | null;
    maxPropInstance?: MaximoPropertyInstanceInput[] | null;
}

export class MaximoProperty {
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
    secureLevel: MaximoSecureLevel | null = 'PUBLIC';
    propValue: string | null = '';
    maximoDefault: string | null = '';
    maxPropInstance: MaximoPropertyInstance[] = [];

    constructor(input: MaximoPropertyInput) {
        this._delete = valueOrDefault(input._delete, this._delete);

        if (!this._delete && typeof input.propName === 'undefined') {
            throw new Error('The propName property is required and must be a Maximo Property Name field value.');
        }

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
        this.maxPropInstance = Array.isArray(input.maxPropInstance)
            ? input.maxPropInstance.map((instance) => new MaximoPropertyInstance(instance, this.propName))
            : [];
    }
}
