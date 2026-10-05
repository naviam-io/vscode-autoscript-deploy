/// <reference path="../../globals.d.ts" />
/// <reference path="../../manage-facade.d.ts" />

import { close, setValue, toExternalSynonymValue, toInternalSynonymValue, updateProgress, valueOrDefault } from '../core/util';
import { applyRetainedValues, hasRetainDeclarations, retainIdentityOf } from '../core/retained-values';
import { deleteSnapshot, readSnapshot, snapshotKey, writeSnapshot } from '../core/snapshot-store';
import { captureExistingState } from '../core/capture';

var MXServer = Java.type('psdi.server.MXServer');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');
var MboConstants = Java.type('psdi.mbo.MboConstants');

/** The Maximo object a domain snapshot is keyed by. */
export const SNAPSHOT_OBJECT = 'MAXDOMAIN';

export function process(domain: MaximoDomain): void {
    const maximo: psdi.server.MXServer = MXServer.getMXServer();
    const key = snapshotKey(SNAPSHOT_OBJECT, retainIdentityOf(domain));
    let mboSet: psdi.mbo.MboSetRemote | null = null;
    try {
        mboSet = maximo.getMboSet('MAXDOMAIN', maximo.getSystemUserInfo());

        if (domain._delete) {
            updateProgress('Deleting domain ' + domain.domainId);
            deleteDomain(mboSet, domain);
            deleteSnapshot(key);
            updateProgress('Deleted domain ' + domain.domainId);
        } else {
            updateProgress('Adding/Updating domain ' + domain.domainId);
            addOrUpdateDomain(mboSet, domain, key);
            deleteSnapshot(key);
            updateProgress('Added/Updated domain ' + domain.domainId);
        }
    } finally {
        close(mboSet);
    }
}

function deleteDomain(mboSet: psdi.mbo.MboSetRemote, domain: MaximoDomain): void {
    if (internalDomainType(domain) === 'SYNONYM') {
        throw new Error('Cannot delete a synonym domain.');
    }

    setDomainWhere(mboSet, domain.domainId);
    mboSet.deleteAll();
    mboSet.save();
}

function addOrUpdateDomain(mboSet: psdi.mbo.MboSetRemote, domain: MaximoDomain, key: string): void {
    const existing = findDomain(mboSet, domain.domainId);

    if (hasRetainDeclarations(domain)) {
        let snapshot = readSnapshot(key);
        if (!snapshot && existing) {
            snapshot = captureExistingState('domains', existing.getUniqueIDValue());
            if (!snapshot) {
                throw Error('Domain ' + domain.domainId + ' has an existing record whose state could not be captured, so its retained values cannot be preserved.');
            }
            writeSnapshot(key, snapshot);
        }

        domain = applyRetainedValues(domain, snapshot ? new MaximoDomain(snapshot) : null);
    }

    const mbo = existing || mboSet.add();
    applyDomain(mbo, domain);
    mboSet.save();
}

function findDomain(mboSet: psdi.mbo.MboSetRemote, domainId: string): psdi.mbo.MboRemote {
    setDomainWhere(mboSet, domainId);
    return mboSet.moveFirst();
}

function setDomainWhere(mboSet: psdi.mbo.MboSetRemote, domainId: string): void {
    const sqlf = new SqlFormat('domainid = :1');
    sqlf.setObject(1, 'MAXDOMAIN', 'DOMAINID', domainId);
    mboSet.setWhere(sqlf.format());
}

function applyDomain(mbo: psdi.mbo.MboRemote, domain: MaximoDomain): void {
    if (mbo.getInt('INTERNAL') === 1) {
        return;
    }

    const domainType = internalDomainType(domain, mbo);
    applyDomainHeader(mbo, domain, domainType);

    switch (domainType) {
        case 'ALN':
            applyDiscreteDomainValues(mbo, 'ALNDOMAINVALUE', domain.domainId, domain.alnDomain);
            break;
        case 'NUMERIC':
            applyDiscreteDomainValues(mbo, 'NUMDOMAINVALUE', domain.domainId, domain.numericDomain);
            break;
        case 'NUMRANGE':
            applyNumRangeDomain(mbo, domain);
            break;
        case 'SYNONYM':
            applySynonymDomain(mbo, domain);
            break;
        case 'MAXTABLE':
            applyTableDomain(mbo, domain.tableDomain);
            break;
        case 'CROSSOVER':
            applyCrossoverDomain(mbo, domain.crossoverDomain);
            break;
        default:
            throw new Error('Provided domain type is not a valid value');
    }
}

function internalDomainType(domain: MaximoDomain, mbo?: psdi.mbo.MboRemote): string {
    return toInternalSynonymValue('DOMTYPE', domain.domainType, mbo);
}

function applyDomainHeader(mbo: psdi.mbo.MboRemote, domain: MaximoDomain, domainType: string): void {
    if (mbo.isNull('DOMAINID')) {
        setValue(mbo, 'DOMAINID', domain.domainId);
        setValue(mbo, 'DOMAINTYPE', toExternalSynonymValue('DOMTYPE', domain.domainType, mbo));
    }

    if (domainType === 'SYNONYM') {
        return;
    }

    if (domainType !== 'MAXTABLE' && domainType !== 'CROSSOVER' && mbo.isNull('MAXTYPE')) {
        setValue(mbo, 'MAXTYPE', domain.maxType);
    }

    if (domainType === 'ALN') {
        setValue(mbo, 'LENGTH', domain.length);
    }

    if (isScaledNumericDomain(domain, domainType)) {
        setValue(mbo, 'LENGTH', domain.length);
        setValue(mbo, 'SCALE', domain.scale);
    }

    setValue(mbo, 'DESCRIPTION', domain.description);
}

function isScaledNumericDomain(domain: MaximoDomain, domainType: string): boolean {
    return (domainType === 'NUMERIC' || domainType === 'NUMRANGE') && (domain.maxType === 'FLOAT' || domain.maxType === 'DECIMAL');
}

function applyDiscreteDomainValues(mbo: psdi.mbo.MboRemote, relationship: string, domainId: string, values: MaximoDiscreteDomainValue[]): void {
    const domainValueSet = mbo.getMboSet(relationship);
    domainValueSet.deleteAll();

    values.forEach(function (value: MaximoDiscreteDomainValue): void {
        const valueMbo = domainValueSet.add();
        setValue(valueMbo, 'VALUE', value.value);
        setValue(valueMbo, 'DESCRIPTION', value.description);
        setValue(valueMbo, 'ORGID', value.orgId);
        setValue(valueMbo, 'SITEID', value.siteId);
        applyValueConditions(valueMbo, domainId, value.value, value.maxDomValCond, false);
    });
}

function applyNumRangeDomain(mbo: psdi.mbo.MboRemote, domain: MaximoDomain): void {
    const numRangeDomainSet = mbo.getMboSet('RANGEDOMSEGMENT');
    numRangeDomainSet.deleteAll();

    domain.numRangeDomain.forEach(function (value: MaximoNumRangeDomainValue): void {
        const numRangeMbo = numRangeDomainSet.add();
        setValue(numRangeMbo, 'RANGESEGMENT', value.rangeSegment);
        setValue(numRangeMbo, 'RANGEMINIMUM', value.rangeMinimum);
        setValue(numRangeMbo, 'RANGEMAXIMUM', value.rangeMaximum);
        setValue(numRangeMbo, 'RANGEINTERVAL', value.rangeInterval);
        setValue(numRangeMbo, 'ORGID', value.orgId);
        setValue(numRangeMbo, 'SITEID', value.siteId);
    });
}

function applySynonymDomain(mbo: psdi.mbo.MboRemote, domain: MaximoDomain): void {
    const synonymDomainSet = mbo.getMboSet('SYNONYMDOMAIN');

    deleteNonDefaultSynonyms(domain.domainId);
    synonymDomainSet.reset();

    domain.synonymDomain.forEach(function (value: MaximoSynonymDomainValue): void {
        const synonymMbo = findSynonym(synonymDomainSet, value.value, value.maxValue) || synonymDomainSet.add();

        if (synonymMbo.toBeAdded()) {
            setValue(synonymMbo, 'VALUE', value.value);
            setValue(synonymMbo, 'MAXVALUE', value.maxValue);
            setValue(synonymMbo, 'ORGID', value.orgId);
            setValue(synonymMbo, 'SITEID', value.siteId);
        }

        setValue(synonymMbo, 'DESCRIPTION', value.description);
        setDefaults(synonymMbo, value.defaults);
        replaceSynonymValueConditions(synonymMbo, domain.domainId, value);

        if (value.defaults) {
            clearOtherSynonymDefaults(synonymDomainSet, value);
        }
    });
}

function deleteNonDefaultSynonyms(domainId: string): void {
    const maximo: psdi.server.MXServer = MXServer.getMXServer();
    let synonymDomainSet: psdi.mbo.MboSetRemote | null = null;

    try {
        synonymDomainSet = maximo.getMboSet('SYNONYMDOMAIN', maximo.getSystemUserInfo());
        const sqlf = new SqlFormat('domainid = :1 and defaults = 0');
        sqlf.setObject(1, 'SYNONYMDOMAIN', 'DOMAINID', domainId);
        synonymDomainSet.setWhere(sqlf.format());

        let synonymMbo = synonymDomainSet.moveFirst();
        while (synonymMbo) {
            try {
                synonymMbo.getMboSet('MAXDOMVALCOND').deleteAll();
                synonymMbo.delete();
            } catch (error) {
                if (!isCannotDeleteMaxValueError(error)) {
                    throw error;
                }
            }
            synonymMbo = synonymDomainSet.moveNext();
        }

        synonymDomainSet.save();
    } finally {
        close(synonymDomainSet);
    }
}

function isCannotDeleteMaxValueError(error: any): boolean {
    return (
        error &&
        typeof error.getErrorGroup === 'function' &&
        typeof error.getErrorKey === 'function' &&
        error.getErrorGroup() === 'system' &&
        error.getErrorKey() === 'cannotDeleteMaxvalue'
    );
}

function findSynonym(mboSet: psdi.mbo.MboSetRemote, value: string, maxValue: string): psdi.mbo.MboRemote {
    const sqlf = new SqlFormat('value = :1 and maxvalue = :2');
    sqlf.setObject(1, 'SYNONYMDOMAIN', 'VALUE', value);
    sqlf.setObject(2, 'SYNONYMDOMAIN', 'MAXVALUE', maxValue);
    mboSet.setUserWhere(sqlf.format());
    mboSet.reset();
    return mboSet.moveFirst();
}

function setDefaults(mbo: psdi.mbo.MboRemote, defaults: boolean | null): void {
    if (!(mbo as any).getMboValue('DEFAULTS').isReadOnly()) {
        setValue(mbo, 'DEFAULTS', defaults);
    }
}

function replaceSynonymValueConditions(mbo: psdi.mbo.MboRemote, domainId: string, value: MaximoSynonymDomainValue): void {
    const maxDomValCondSet = mbo.getMboSet('MAXDOMVALCOND');
    maxDomValCondSet.deleteAll();
    applyValueConditions(mbo, domainId, value.value, value.maxDomValCond, true);
}

function clearOtherSynonymDefaults(mboSet: psdi.mbo.MboSetRemote, value: MaximoSynonymDomainValue): void {
    const sqlf = new SqlFormat('maxvalue = :1 and value != :2');
    sqlf.setObject(1, 'SYNONYMDOMAIN', 'MAXVALUE', value.maxValue);
    sqlf.setObject(2, 'SYNONYMDOMAIN', 'VALUE', value.value);
    mboSet.setUserWhere(sqlf.format());
    mboSet.reset();

    let synonymMbo = mboSet.moveFirst();
    while (synonymMbo) {
        setDefaults(synonymMbo, false);
        synonymMbo = mboSet.moveNext();
    }
}

function applyTableDomain(mbo: psdi.mbo.MboRemote, values: MaximoTableDomainValue[]): void {
    applyTableDomainRows(mbo, 'MAXTABLEDOMAIN', values);
}

function applyCrossoverDomain(mbo: psdi.mbo.MboRemote, values: MaximoCrossoverDomainValue[]): void {
    applyTableDomainRows(mbo, 'MAXTABLEDOMAINFORCROSSOVER', values, applyCrossoverFields);
}

function applyTableDomainRows(
    mbo: psdi.mbo.MboRemote,
    relationship: string,
    values: MaximoTableDomainValue[],
    applyChildren?: (mbo: psdi.mbo.MboRemote, value: MaximoTableDomainValue) => void
): void {
    const tableDomainSet = mbo.getMboSet(relationship);
    tableDomainSet.deleteAll();

    values.forEach(function (value: MaximoTableDomainValue): void {
        const tableMbo = tableDomainSet.add();
        applyTableDomainValues(tableMbo, value);
        if (applyChildren) {
            applyChildren(tableMbo, value);
        }
    });
}

function applyTableDomainValues(mbo: psdi.mbo.MboRemote, value: MaximoTableDomainValue): void {
    setValue(mbo, 'OBJECTNAME', value.objectName, MboConstants.NOVALIDATION);
    setValue(mbo, 'VALIDTNWHERECLAUSE', value.validtnWhereClause);
    setValue(mbo, 'LISTWHERECLAUSE', value.listWhereClause);
    setValue(mbo, 'ERRORRESOURCBUNDLE', value.errorResourceBundle);
    setValue(mbo, 'ERRORACCESSKEY', value.errorAccessKey);
    setValue(mbo, 'ORGID', value.orgId);
    setValue(mbo, 'SITEID', value.siteId);
}

function applyCrossoverFields(mbo: psdi.mbo.MboRemote, value: MaximoTableDomainValue): void {
    const values = (value as MaximoCrossoverDomainValue).crossoverFields;
    const crossoverDomainSet = mbo.getMboSet('CROSSOVERDOMAIN');
    crossoverDomainSet.deleteAll();

    values.forEach(function (value: MaximoCrossoverField): void {
        const crossoverMbo = crossoverDomainSet.add();
        setValue(crossoverMbo, 'SOURCEFIELD', value.sourceField);
        setValue(crossoverMbo, 'DESTFIELD', value.destField);
        setValue(crossoverMbo, 'COPYEVENIFSRCNULL', value.copyEvenIfSrcNull);
        setValue(crossoverMbo, 'COPYONLYIFDESTNULL', value.copyOnlyIfDestNull);
        setValue(crossoverMbo, 'SOURCECONDITION', value.sourceCondition);
        setValue(crossoverMbo, 'DESTCONDITION', value.destCondition);
        setValue(crossoverMbo, 'SEQUENCE', value.sequence);
    });
}

function applyValueConditions(
    mbo: psdi.mbo.MboRemote,
    domainId: string,
    value: string,
    conditions: MaximoDomainValueCondition[],
    uppercaseValue: boolean
): void {
    const maxDomValCondSet = mbo.getMboSet('MAXDOMVALCOND');
    const valueId = domainId + '|' + (uppercaseValue ? String(value).toUpperCase() : value);

    conditions.forEach(function (condition: MaximoDomainValueCondition): void {
        const maxDomValCondMbo = maxDomValCondSet.add();
        setValue(maxDomValCondMbo, 'DOMAINID', domainId);
        setValue(maxDomValCondMbo, 'VALUEID', valueId.toUpperCase());
        setValue(maxDomValCondMbo, 'CONDITIONNUM', condition.conditionNum);
        setValue(maxDomValCondMbo, 'OBJECTNAME', condition.objectName);
    });
}

export interface MaximoDomainValueConditionInput {
    conditionNum: string;
    objectName?: string | null;
    _retain?: any;
}

export class MaximoDomainValueCondition {
    static _keys = ['conditionNum', 'objectName'];

    conditionNum: string;
    objectName: string | null = '';
    _retain: any = [];

    constructor(input: MaximoDomainValueConditionInput) {
        this.conditionNum = input.conditionNum;
        this.objectName = valueOrDefault(input.objectName, this.objectName);
        this._retain = typeof input._retain === 'undefined' || input._retain === null ? this._retain : input._retain;
    }
}

export interface MaximoDiscreteDomainValueInput {
    value: string;
    description?: string | null;
    orgId?: string | null;
    siteId?: string | null;
    maxDomValCond?: MaximoDomainValueConditionInput[] | null;
    _retain?: any;
}

export class MaximoDiscreteDomainValue {
    static _keys = ['value', 'orgId', 'siteId'];

    value: string;
    description: string | null = '';
    orgId: string | null = '';
    siteId: string | null = '';
    maxDomValCond: MaximoDomainValueCondition[] = [];
    _retain: any = [];

    constructor(input: MaximoDiscreteDomainValueInput) {
        this.value = input.value;
        this.description = valueOrDefault(input.description, this.description);
        this.orgId = valueOrDefault(input.orgId, this.orgId);
        this.siteId = valueOrDefault(input.siteId, this.siteId);
        this.maxDomValCond = (input.maxDomValCond || []).map((condition) => new MaximoDomainValueCondition(condition));
        this._retain = typeof input._retain === 'undefined' || input._retain === null ? this._retain : input._retain;
    }
}

export interface MaximoAlnDomainValueInput extends MaximoDiscreteDomainValueInput {}

export interface MaximoNumericDomainValueInput extends MaximoDiscreteDomainValueInput {}

export interface MaximoNumRangeDomainValueInput {
    rangeSegment: string;
    rangeMinimum?: number | string | null;
    rangeMaximum?: number | string | null;
    rangeInterval?: number | string | null;
    orgId?: string | null;
    siteId?: string | null;
    _retain?: any;
}

export class MaximoNumRangeDomainValue {
    static _keys = ['rangeSegment', 'orgId', 'siteId'];

    rangeSegment: string;
    rangeMinimum: number | string | null = '';
    rangeMaximum: number | string | null = '';
    rangeInterval: number | string | null = '';
    orgId: string | null = '';
    siteId: string | null = '';
    _retain: any = [];

    constructor(input: MaximoNumRangeDomainValueInput) {
        this.rangeSegment = input.rangeSegment;
        this.rangeMinimum = valueOrDefault(input.rangeMinimum, this.rangeMinimum);
        this.rangeMaximum = valueOrDefault(input.rangeMaximum, this.rangeMaximum);
        this.rangeInterval = valueOrDefault(input.rangeInterval, this.rangeInterval);
        this.orgId = valueOrDefault(input.orgId, this.orgId);
        this.siteId = valueOrDefault(input.siteId, this.siteId);
        this._retain = typeof input._retain === 'undefined' || input._retain === null ? this._retain : input._retain;
    }
}

export interface MaximoSynonymDomainValueInput {
    value: string;
    maxValue: string;
    description?: string | null;
    orgId?: string | null;
    siteId?: string | null;
    defaults?: boolean | null;
    maxDomValCond?: MaximoDomainValueConditionInput[] | null;
    _retain?: any;
}

export class MaximoSynonymDomainValue {
    static _keys = ['value', 'maxValue', 'orgId', 'siteId'];

    value: string;
    maxValue: string;
    description: string | null = '';
    orgId: string | null = '';
    siteId: string | null = '';
    defaults: boolean | null = false;
    maxDomValCond: MaximoDomainValueCondition[] = [];
    _retain: any = [];

    constructor(input: MaximoSynonymDomainValueInput) {
        this.value = input.value;
        this.maxValue = input.maxValue;
        this.description = valueOrDefault(input.description, this.description);
        this.orgId = valueOrDefault(input.orgId, this.orgId);
        this.siteId = valueOrDefault(input.siteId, this.siteId);
        this.defaults = valueOrDefault(input.defaults, this.defaults);
        this.maxDomValCond = (input.maxDomValCond || []).map((condition) => new MaximoDomainValueCondition(condition));
        this._retain = typeof input._retain === 'undefined' || input._retain === null ? this._retain : input._retain;
    }
}

export interface MaximoTableDomainValueInput {
    objectName: string;
    validtnWhereClause?: string | null;
    listWhereClause?: string | null;
    errorResourceBundle?: string | null;
    errorAccessKey?: string | null;
    orgId?: string | null;
    siteId?: string | null;
    _retain?: any;
}

export class MaximoTableDomainValue {
    static _keys = ['orgId', 'siteId'];

    objectName: string;
    validtnWhereClause: string | null = '';
    listWhereClause: string | null = '';
    errorResourceBundle: string | null = '';
    errorAccessKey: string | null = '';
    orgId: string | null = '';
    siteId: string | null = '';
    _retain: any = [];

    constructor(input: MaximoTableDomainValueInput) {
        this.objectName = input.objectName;
        this.validtnWhereClause = valueOrDefault(input.validtnWhereClause, this.validtnWhereClause);
        this.listWhereClause = valueOrDefault(input.listWhereClause, this.listWhereClause);
        this.errorResourceBundle = valueOrDefault(input.errorResourceBundle, this.errorResourceBundle);
        this.errorAccessKey = valueOrDefault(input.errorAccessKey, this.errorAccessKey);
        this.orgId = valueOrDefault(input.orgId, this.orgId);
        this.siteId = valueOrDefault(input.siteId, this.siteId);
        this._retain = typeof input._retain === 'undefined' || input._retain === null ? this._retain : input._retain;
    }
}

export interface MaximoCrossoverFieldInput {
    sourceField: string;
    destField: string;
    copyEvenIfSrcNull?: boolean | null;
    copyOnlyIfDestNull?: boolean | null;
    sourceCondition?: string | null;
    destCondition?: string | null;
    sequence?: number | null;
    _retain?: any;
}

export class MaximoCrossoverField {
    static _keys = ['sourceField', 'destField'];

    sourceField: string;
    destField: string;
    copyEvenIfSrcNull: boolean | null = false;
    copyOnlyIfDestNull: boolean | null = false;
    sourceCondition: string | null = '';
    destCondition: string | null = '';
    sequence: number | null = null;
    _retain: any = [];

    constructor(input: MaximoCrossoverFieldInput) {
        this.sourceField = input.sourceField;
        this.destField = input.destField;
        this.copyEvenIfSrcNull = valueOrDefault(input.copyEvenIfSrcNull, this.copyEvenIfSrcNull);
        this.copyOnlyIfDestNull = valueOrDefault(input.copyOnlyIfDestNull, this.copyOnlyIfDestNull);
        this.sourceCondition = valueOrDefault(input.sourceCondition, this.sourceCondition);
        this.destCondition = valueOrDefault(input.destCondition, this.destCondition);
        this.sequence = valueOrDefault(input.sequence, this.sequence);
        this._retain = typeof input._retain === 'undefined' || input._retain === null ? this._retain : input._retain;
    }
}

export interface MaximoCrossoverDomainValueInput extends MaximoTableDomainValueInput {
    crossoverFields?: MaximoCrossoverFieldInput[] | null;
}

export class MaximoCrossoverDomainValue {
    static _keys = ['orgId', 'siteId'];

    objectName: string;
    validtnWhereClause: string | null = '';
    listWhereClause: string | null = '';
    errorResourceBundle: string | null = '';
    errorAccessKey: string | null = '';
    orgId: string | null = '';
    siteId: string | null = '';
    crossoverFields: MaximoCrossoverField[] = [];
    _retain: any = [];

    constructor(input: MaximoCrossoverDomainValueInput) {
        this.objectName = input.objectName;
        this.validtnWhereClause = valueOrDefault(input.validtnWhereClause, this.validtnWhereClause);
        this.listWhereClause = valueOrDefault(input.listWhereClause, this.listWhereClause);
        this.errorResourceBundle = valueOrDefault(input.errorResourceBundle, this.errorResourceBundle);
        this.errorAccessKey = valueOrDefault(input.errorAccessKey, this.errorAccessKey);
        this.orgId = valueOrDefault(input.orgId, this.orgId);
        this.siteId = valueOrDefault(input.siteId, this.siteId);
        this.crossoverFields = (input.crossoverFields || []).map((field) => new MaximoCrossoverField(field));
        this._retain = typeof input._retain === 'undefined' || input._retain === null ? this._retain : input._retain;
    }
}

export interface MaximoDomainInput {
    _delete?: boolean;
    domainId: string;
    domainType: string;
    scale?: number | null;
    description?: string | null;
    maxType?: string | null;
    length?: number | null;
    alnDomain?: MaximoAlnDomainValueInput[] | null;
    numericDomain?: MaximoNumericDomainValueInput[] | null;
    numRangeDomain?: MaximoNumRangeDomainValueInput[] | null;
    synonymDomain?: MaximoSynonymDomainValueInput[] | null;
    tableDomain?: MaximoTableDomainValueInput[] | null;
    crossoverDomain?: MaximoCrossoverDomainValueInput[] | null;
    _retain?: any;
}

export class MaximoDomain {
    static _keys = ['domainId'];

    _delete = false;
    domainId: string;
    domainType: string;
    scale: number | null = null;
    description: string | null = '';
    maxType: string | null = '';
    length: number | null = null;
    alnDomain: MaximoDiscreteDomainValue[] = [];
    numericDomain: MaximoDiscreteDomainValue[] = [];
    numRangeDomain: MaximoNumRangeDomainValue[] = [];
    synonymDomain: MaximoSynonymDomainValue[] = [];
    tableDomain: MaximoTableDomainValue[] = [];
    crossoverDomain: MaximoCrossoverDomainValue[] = [];
    _retain: any = [];

    constructor(input: MaximoDomainInput) {
        this.domainId = input.domainId;
        this.domainType = input.domainType;

        this._delete = valueOrDefault(input._delete, this._delete);
        this.scale = valueOrDefault(input.scale, this.scale);
        this.description = valueOrDefault(input.description, this.description);
        this.maxType = valueOrDefault(input.maxType, this.maxType);
        this.length = valueOrDefault(input.length, this.length);
        this.alnDomain = (input.alnDomain || []).map((value) => new MaximoDiscreteDomainValue(value));
        this.numericDomain = (input.numericDomain || []).map((value) => new MaximoDiscreteDomainValue(value));
        this.numRangeDomain = (input.numRangeDomain || []).map((value) => new MaximoNumRangeDomainValue(value));
        this.synonymDomain = (input.synonymDomain || []).map((value) => new MaximoSynonymDomainValue(value));
        this.tableDomain = (input.tableDomain || []).map((value) => new MaximoTableDomainValue(value));
        this.crossoverDomain = (input.crossoverDomain || []).map((value) => new MaximoCrossoverDomainValue(value));
        this._retain = typeof input._retain === 'undefined' || input._retain === null ? this._retain : input._retain;
    }
}
