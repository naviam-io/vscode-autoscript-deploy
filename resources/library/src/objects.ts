/// <reference path="../globals.d.ts" />
/// <reference path="../manage-facade.d.ts" />

import {
    applyNonNullWritableValues,
    applyOptionalValues,
    applyValues,
    applyWritableValues,
    close,
    isWritable,
    setValue,
    updateProgress,
    valueOrDefault
} from './util';

var MXServer = Java.type('psdi.server.MXServer');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');
var MboConstants = Java.type('psdi.mbo.MboConstants');

export function process(maxObject: MaximoObject): void {
    const maximo: psdi.server.MXServer = MXServer.getMXServer();
    let mboSet: psdi.mbo.MboSetRemote | null = null;
    try {
        mboSet = maximo.getMboSet('MAXOBJECTCFG', maximo.getSystemUserInfo());

        if (maxObject._delete) {
            updateProgress('Deleting Maximo Object ' + maxObject.object);
            deleteObject(mboSet, maxObject);
            updateProgress('Deleted Maximo Object ' + maxObject.object);
        } else {
            updateProgress('Adding/Updating Maximo Object ' + maxObject.object);
            addOrUpdateObject(mboSet, maxObject);
            updateProgress('Added/Updated Maximo Object ' + maxObject.object);
        }
    } finally {
        close(mboSet);
    }
}

function deleteObject(mboSet: psdi.mbo.MboSetRemote, maxObject: MaximoObject): void {
    let mbo = findObject(mboSet, maxObject.object);
    if (!mbo) {
        return;
    }
    mbo.delete();
    mboSet.save();
}

function addOrUpdateObject(mboSet: psdi.mbo.MboSetRemote, maxObject: MaximoObject): void {
    let mbo = findObject(mboSet, maxObject.object);
    if (!mbo) {
        mbo = mboSet.add();
    }

    applyObjectValues(mbo, maxObject);

    mboSet.save();
}

function findObject(mboSet: psdi.mbo.MboSetRemote, objectName: string): psdi.mbo.MboRemote {
    const sqlf = new SqlFormat('objectname = :1');
    sqlf.setObject(1, 'MAXOBJECTCFG', 'OBJECTNAME', objectName);
    mboSet.setWhere(sqlf.format());
    mboSet.reset();
    return mboSet.moveFirst();
}

function applyObjectValues(mbo: psdi.mbo.MboRemote, maxObject: MaximoObject): void {
    if (mbo.toBeAdded()) {
        setValue(mbo, 'OBJECTNAME', maxObject.object);
        applyOptionalValues(mbo, [['EXTENDSOBJECT', maxObject.extendsObject]]);

        if (maxObject.description == null) {
            setValue(mbo, 'DESCRIPTION', `${maxObject.object} Table`);
        }
    }

    applyObjectHeaderValues(mbo, maxObject);

    if (maxObject.view) {
        applyViewValues(mbo, maxObject);
    } else {
        applyTableValues(mbo, maxObject);
    }

    applyAttributes(mbo, maxObject);
    applyRelationships(mbo, maxObject);
    applyIndexes(mbo, maxObject);
}

function applyObjectHeaderValues(mbo: psdi.mbo.MboRemote, maxObject: MaximoObject): void {
    applyValues(mbo, [
        ['ENTITYNAME', maxObject.entity],
        ['CLASSNAME', maxObject.class]
    ]);
    applyOptionalValues(mbo, [
        ['DESCRIPTION', maxObject.description],
        ['SERVICENAME', maxObject.service],
        ['MAINOBJECT', maxObject.mainObject]
    ]);
    applyNonNullWritableValues(mbo, [
        ['SITEORGTYPE', maxObject.level],
        ['TRIGROOT', maxObject.triggerRoot]
    ]);
    applyWritableValues(mbo, [['TEXTDIRECTION', maxObject.textDirection]]);
}

function applyTableValues(mbo: psdi.mbo.MboRemote, maxObject: MaximoObject): void {
    if (mbo.toBeAdded()) {
        applyOptionalValues(mbo, [['UNIQUECOLUMNNAME', maxObject.uniqueColumn]]);
        applyWritableValues(mbo, [
            ['PERSISTENT', maxObject.persistent],
            ['ADDROWSTAMP', maxObject.addRowstamp]
        ]);
    }

    applyOptionalValues(mbo, [['STORAGEPARTITION', maxObject.storagePartition]]);
    applyWritableValues(mbo, [
        ['LANGTABLENAME', maxObject.languageTable],
        ['LANGCOLUMNNAME', maxObject.languageColumn],
        ['TEXTSEARCHENABLED', maxObject.textSearchEnabled],
        ['EAUDITENABLED', maxObject.auditEnabled]
    ]);

    if (maxObject.indexes && maxObject.indexes.length > 0 && isWritable(mbo, 'ALTIXNAME')) {
        setValue(mbo, 'ALTIXNAME', maxObject.alternateIndex, MboConstants.NOVALIDATION);
    }

    if ((mbo as any).getBoolean('EAUDITENABLED')) {
        applyValues(mbo, [
            ['EAUDITTBNAME', maxObject.auditTable],
            ['EAUDITFILTER', maxObject.eAuditFilter],
            ['ESIGFILTER', maxObject.eSignatureFilter]
        ]);
    }
}

function applyViewValues(mbo: psdi.mbo.MboRemote, maxObject: MaximoObject): void {
    if (mbo.toBeAdded()) {
        setValue(mbo, 'ISVIEW', maxObject.view);
        if (maxObject.joinToObject) {
            setValue(mbo, 'JOINOBJECT', maxObject.joinToObject);
        }
    }

    setValue(mbo, 'VIEWWHERE', maxObject.viewWhere);
    setValue(mbo, 'AUTOSELECT', maxObject.automaticallySelect);

    if (!maxObject.automaticallySelect) {
        setValue(mbo, 'VIEWSELECT', maxObject.viewSelect);
        setValue(mbo, 'VIEWFROM', maxObject.viewFrom);
    }
}

function applyAttributes(mbo: psdi.mbo.MboRemote, maxObject: MaximoObject): void {
    const maxAttributeSet = mbo.getMboSet('MAXATTRIBUTECFG');

    maxObject.attributes?.forEach(function (item: MaximoAttribute) {
        let attribute = maxAttributeSet.moveFirst();
        while (attribute) {
            if (equalsIgnoreCase(attribute.getString('ATTRIBUTENAME'), item.attribute)) {
                break;
            }
            attribute = maxAttributeSet.moveNext();
        }

        if (item._delete) {
            if (attribute != null) {
                attribute.delete();
            }
        } else {
            if (attribute == null) {
                attribute = maxAttributeSet.add();
                setValue(attribute, 'ATTRIBUTENAME', item.attribute);
            }

            setValue(attribute, 'REMARKS', item.description);
            setValue(attribute, 'TITLE', item.title);

            applyAttributeValues(attribute, item);
        }
    });
}

function applyAttributeValues(attribute: psdi.mbo.MboRemote, item: MaximoAttribute): void {
    applyValues(attribute, [
        ['CLASSNAME', item.class],
        ['DEFAULTVALUE', item.defaultValue],
        ['DOMAINID', item.domain],
        ['ALIAS', item.alias]
    ]);
    applyNonNullWritableValues(attribute, [
        ['MAXTYPE', item.type],
        ['SEARCHTYPE', item.searchType],
        ['LENGTH', item.length],
        ['SCALE', item.scale]
    ]);
    applyWritableValues(attribute, [
        ['COLUMNNAME', item.column],
        ['AUTOKEYNAME', item.autonumber],
        ['TEXTDIRECTION', item.textDirection],
        ['SEQUENCENAME', item.sequenceName],
        ['COMPLEXEXPRESSION', item.typeOfComplexExpression],
        ['REQUIRED', item.required],
        ['PERSISTENT', item.persistent],
        ['MUSTBE', item.mustBe],
        ['CANAUTONUM', item.canAutonumber],
        ['LOCALIZABLE', item.localizable],
        ['ISPOSITIVE', item.positive],
        ['ISLDOWNER', item.longDescriptionOwner],
        ['EAUDITENABLED', item.auditEnabled],
        ['MLSUPPORTED', item.multilanguageSupported],
        ['MLINUSE', item.multilanguageInUse],
        ['ESIGENABLED', item.eSignatureEnabled]
    ]);
    setValue(attribute, 'SAMEASOBJECT', item.sameAsObject, MboConstants.NOACCESSCHECK);
    setValue(attribute, 'SAMEASATTRIBUTE', item.sameAsAttribute, MboConstants.NOACCESSCHECK);
    setValue(attribute, 'PRIMARYKEYCOLSEQ', item.primaryColumn, MboConstants.NOACCESSCHECK);
}

function applyIndexes(mbo: psdi.mbo.MboRemote, maxObject: MaximoObject): void {
    const indexSet = mbo.getMboSet('MAXSYSINDEXES');

    maxObject.indexes?.forEach(function (item: Index) {
        let index = indexSet.moveFirst();
        while (index) {
            if (equalsIgnoreCase(index.getString('NAME'), item.index)) {
                break;
            }
            index = indexSet.moveNext();
        }

        if (item._delete) {
            if (index != null) {
                index.delete();
            }
        } else {
            if (index == null && item.columns.length > 0) {
                index = indexSet.add();
                setValue(index, 'NAME', item.index);

                applyWritableValues(index, [
                    ['UNIQUE', item.enforceUniqueness],
                    ['CLUSTERRULE', item.clusteredIndex],
                    ['REQUIRED', item.required],
                    ['TEXTSEARCH', item.textSearchIndex],
                    ['STORAGEPARTITION', item.storagePartition]
                ]);

                var maxSysKeysSet = index.getMboSet('MAXSYSKEYS');

                item.columns.forEach(function (column: Column) {
                    var key = maxSysKeysSet.add();
                    applyWritableValues(key, [
                        ['COLNAME', column.column],
                        ['ASCENDING', column.ascending],
                        ['COLSEQ', column.sequence]
                    ]);
                });
            }
        }
    });
}

function applyRelationships(mbo: psdi.mbo.MboRemote, maxObject: MaximoObject): void {
    const relationshipSet = mbo.getMboSet('MAXRELATIONSHIP');

    maxObject.relationships?.forEach(function (item: Relationship) {
        let relationship = relationshipSet.moveFirst();
        while (relationship) {
            if (equalsIgnoreCase(relationship.getString('NAME'), item.relationship)) {
                break;
            }
            relationship = relationshipSet.moveNext();
        }

        if (item._delete) {
            if (relationship != null) {
                relationship.delete();
            }
        } else {
            if (relationship == null) {
                relationship = relationshipSet.add();
                setValue(relationship, 'NAME', item.relationship);
                setValue(relationship, 'CHILD', item.child);
            } else if (!equalsIgnoreCase(item.child, relationship.getString('CHILD'))) {
                relationship.delete();
                relationship = relationshipSet.add();
                setValue(relationship, 'NAME', item.relationship);
                setValue(relationship, 'CHILD', item.child);
            }

            applyValues(relationship, [
                ['REMARKS', item.remarks],
                ['WHERECLAUSE', item.whereClause]
            ]);

            applyWritableValues(relationship, [
                ['CARDINALITY', item.cardinality],
                ['DBJOINREQUIRED', item.dbJoinRequired],
                ['ISDEFAULT', item.isDefault]
            ]);
        }
    });
}

function equalsIgnoreCase(left: any, right: any): boolean {
    if (left === null || typeof left === 'undefined' || right === null || typeof right === 'undefined') {
        return false;
    }
    return String(left).toLowerCase() === String(right).toLowerCase();
}

export enum MaximoObjectLevel {
    CompanySet = 'COMPANYSET',
    ItemSet = 'ITEMSET',
    Org = 'ORG',
    OrgAppFilter = 'ORGAPPFILTER',
    OrgSite = 'ORGSITE',
    Site = 'SITE',
    SiteAppFilter = 'SITEAPPFILTER',
    System = 'SYSTEM',
    SystemAppFilter = 'SYSTEMAPPFILTER',
    SystemOrg = 'SYSTEMORG',
    SystemOrgSite = 'SYSTEMORGSITE',
    SystemSite = 'SYSTEMSITE'
}

export enum SearchType {
    None = 'NONE',
    Exact = 'EXACT',
    Wildcard = 'WILDCARD',
    Text = 'TEXT'
}

export enum TextDirection {
    Contextual = 'CONTEXTUAL',
    LTR = 'LTR',
    RTL = 'RTL'
}

export enum Cardinality {
    Multiple = 'MULTIPLE',
    Single = 'SINGLE',
    Undefined = 'UNDEFINED'
}

export interface RelationshipInput {
    _delete?: boolean;
    relationship: string;
    remarks?: string | null;
    child: string;
    whereClause?: string | null;
    cardinality?: Cardinality | null;
    dbJoinRequired?: number | null;
    isDefault?: boolean;
}

export class Relationship {
    _delete: boolean = false;
    relationship: string;
    remarks: string | null = null;
    child: string;
    whereClause: string | null = null;
    cardinality: Cardinality | null = null;
    dbJoinRequired: number | null = null;
    isDefault: boolean = false;

    constructor(input: RelationshipInput) {
        this._delete = valueOrDefault(input._delete, this._delete);
        this.relationship = input.relationship;
        this.remarks = valueOrDefault(input.remarks, this.remarks);
        this.child = input.child;
        this.whereClause = valueOrDefault(input.whereClause, this.whereClause);
        this.cardinality = valueOrDefault(input.cardinality, this.cardinality);
        this.dbJoinRequired = valueOrDefault(input.dbJoinRequired, this.dbJoinRequired);
        this.isDefault = valueOrDefault(input.isDefault, this.isDefault);
    }
}

export interface ColumnInput {
    column: string;
    ascending?: boolean;
    sequence: number;
}

export class Column {
    column: string;
    ascending: boolean = false;
    sequence: number;

    constructor(input: ColumnInput) {
        this.column = input.column;
        this.ascending = valueOrDefault(input.ascending, this.ascending);
        this.sequence = input.sequence;
    }
}

export interface IndexInput {
    _delete?: boolean;
    index: string;
    enforceUniqueness?: boolean;
    clusteredIndex?: boolean;
    required?: boolean;
    textSearchIndex?: boolean;
    storagePartition?: string | null;
    columns?: ColumnInput[] | null;
}

export class Index {
    _delete: boolean = false;
    index: string;
    enforceUniqueness: boolean = false;
    clusteredIndex: boolean = false;
    required: boolean = false;
    textSearchIndex: boolean = false;
    storagePartition: string | null = null;
    columns: Column[] = [];

    constructor(input: IndexInput) {
        this._delete = valueOrDefault(input._delete, this._delete);
        this.index = input.index;
        this.enforceUniqueness = valueOrDefault(input.enforceUniqueness, this.enforceUniqueness);
        this.clusteredIndex = valueOrDefault(input.clusteredIndex, this.clusteredIndex);
        this.required = valueOrDefault(input.required, this.required);
        this.textSearchIndex = valueOrDefault(input.textSearchIndex, this.textSearchIndex);
        this.storagePartition = valueOrDefault(input.storagePartition, this.storagePartition);
        this.columns = Array.isArray(input.columns) ? input.columns.map((column) => new Column(column)) : [];
    }
}

export interface MaximoAttributeInput {
    _delete?: boolean;
    attribute: string;
    description: string;
    title: string;
    type?: string;
    length?: number;
    scale?: number;
    required?: boolean;
    class?: string | null;
    domain?: string | null;
    defaultValue?: string | null;
    alias?: string | null;
    column?: string | null;
    sameAsObject?: string | null;
    sameAsAttribute?: string | null;
    autonumber?: string | null;
    localizable?: boolean;
    textDirection?: TextDirection | null;
    persistent?: boolean;
    mustBe?: boolean;
    positive?: boolean;
    canAutonumber?: boolean;
    longDescriptionOwner?: boolean;
    sequenceName?: string | null;
    typeOfComplexExpression?: string | null;
    auditEnabled?: boolean;
    multilanguageInUse?: boolean;
    multilanguageSupported?: boolean;
    eSignatureEnabled?: boolean;
    primaryColumn?: number | null;
    searchType?: SearchType;
}

export class MaximoAttribute {
    _delete: boolean = false;
    attribute: string;
    description: string;
    title: string;
    type?: string;
    length?: number;
    scale?: number;
    required: boolean = false;
    class?: string | null;
    domain?: string | null;
    defaultValue?: string | null;
    alias?: string | null;
    column?: string | null;
    sameAsObject?: string | null;
    sameAsAttribute?: string | null;
    autonumber?: string | null;
    localizable: boolean = false;
    textDirection?: TextDirection | null;
    persistent: boolean = true;
    mustBe: boolean = false;
    positive: boolean = false;
    canAutonumber: boolean = false;
    longDescriptionOwner: boolean = false;
    sequenceName?: string | null;
    typeOfComplexExpression?: string | null;
    auditEnabled: boolean = false;
    multilanguageInUse: boolean = false;
    multilanguageSupported: boolean = false;
    eSignatureEnabled: boolean = false;
    primaryColumn: number | null = null;
    searchType?: SearchType;

    constructor(input: MaximoAttributeInput) {
        this._delete = valueOrDefault(input._delete, this._delete);
        this.attribute = input.attribute;
        this.description = input.description;
        this.title = input.title;
        this.type = valueOrDefault(input.type, this.type);
        this.length = valueOrDefault(input.length, this.length);
        this.scale = valueOrDefault(input.scale, this.scale);
        this.required = valueOrDefault(input.required, this.required);
        this.class = valueOrDefault(input.class, this.class);
        this.domain = valueOrDefault(input.domain, this.domain);
        this.defaultValue = valueOrDefault(input.defaultValue, this.defaultValue);
        this.alias = valueOrDefault(input.alias, this.alias);
        this.column = valueOrDefault(input.column, this.column);
        this.sameAsObject = valueOrDefault(input.sameAsObject, this.sameAsObject);
        this.sameAsAttribute = valueOrDefault(input.sameAsAttribute, this.sameAsAttribute);
        this.autonumber = valueOrDefault(input.autonumber, this.autonumber);
        this.localizable = valueOrDefault(input.localizable, this.localizable);
        this.textDirection = valueOrDefault(input.textDirection, this.textDirection);
        this.persistent = valueOrDefault(input.persistent, this.persistent);
        this.mustBe = valueOrDefault(input.mustBe, this.mustBe);
        this.positive = valueOrDefault(input.positive, this.positive);
        this.canAutonumber = valueOrDefault(input.canAutonumber, this.canAutonumber);
        this.longDescriptionOwner = valueOrDefault(input.longDescriptionOwner, this.longDescriptionOwner);
        this.sequenceName = valueOrDefault(input.sequenceName, this.sequenceName);
        this.typeOfComplexExpression = valueOrDefault(input.typeOfComplexExpression, this.typeOfComplexExpression);
        this.auditEnabled = valueOrDefault(input.auditEnabled, this.auditEnabled);
        this.multilanguageInUse = valueOrDefault(input.multilanguageInUse, this.multilanguageInUse);
        this.multilanguageSupported = valueOrDefault(input.multilanguageSupported, this.multilanguageSupported);
        this.eSignatureEnabled = valueOrDefault(input.eSignatureEnabled, this.eSignatureEnabled);
        this.primaryColumn = valueOrDefault(input.primaryColumn, this.primaryColumn);
        this.searchType = valueOrDefault(input.searchType, this.searchType);
    }
}

export interface MaximoObjectInput {
    _delete?: boolean;
    object: string;
    description?: string;
    service?: string;
    entity?: string | null;
    class?: string | null;
    extendsObject?: string | null;
    level?: MaximoObjectLevel;
    textDirection?: TextDirection | null;
    mainObject?: boolean;
    persistent?: boolean;
    storagePartition?: string | null;
    uniqueColumn?: string | null;
    languageTable?: string | null;
    languageColumn?: string | null;
    alternateIndex?: string | null;
    triggerRoot?: string | null;
    addRowstamp?: boolean;
    textSearchEnabled?: boolean;
    view?: boolean;
    viewWhere?: string | null;
    joinToObject?: string | null;
    viewSelect?: string | null;
    automaticallySelect?: boolean;
    viewFrom?: string | null;
    auditEnabled?: boolean;
    auditTable?: string | null;
    eAuditFilter?: string | null;
    eSignatureFilter?: string | null;
    attributes?: MaximoAttributeInput[] | null;
    relationships?: RelationshipInput[] | null;
    indexes?: IndexInput[] | null;
}

export class MaximoObject {
    _delete = false;
    object: string;
    description: string | null = null;
    service: string | null = null;
    entity: string | null = null;
    class: string | null = null;
    extendsObject: string | null = null;
    level?: MaximoObjectLevel;
    textDirection: TextDirection | null = null;
    mainObject: boolean = false;
    persistent: boolean = true;
    storagePartition: string | null = null;
    uniqueColumn: string | null = null;
    languageTable: string | null = null;
    languageColumn: string | null = null;
    alternateIndex: string | null = null;
    triggerRoot: string | null = null;
    addRowstamp: boolean = true;
    textSearchEnabled: boolean = false;
    view: boolean = false;
    viewWhere: string | null = null;
    joinToObject: string | null = null;
    viewSelect: string | null = null;
    automaticallySelect: boolean = true;
    viewFrom: string | null = null;
    auditEnabled: boolean = false;
    auditTable: string | null = null;
    eAuditFilter: string | null = null;
    eSignatureFilter: string | null = null;
    attributes: MaximoAttribute[] = [];
    relationships: Relationship[] = [];
    indexes: Index[] = [];

    constructor(input: MaximoObjectInput) {
        this._delete = valueOrDefault(input._delete, this._delete);
        this.object = input.object;
        this.description = valueOrDefault(input.description, this.description);
        this.service = valueOrDefault(input.service, this.service);
        this.entity = valueOrDefault(input.entity, this.entity);
        this.class = valueOrDefault(input.class, this.class);
        this.extendsObject = valueOrDefault(input.extendsObject, this.extendsObject);
        this.level = valueOrDefault(input.level, this.level);
        this.textDirection = valueOrDefault(input.textDirection, this.textDirection);
        this.mainObject = valueOrDefault(input.mainObject, this.mainObject);
        this.persistent = valueOrDefault(input.persistent, this.persistent);
        this.storagePartition = valueOrDefault(input.storagePartition, this.storagePartition);
        this.uniqueColumn = valueOrDefault(input.uniqueColumn, this.uniqueColumn);
        this.languageTable = valueOrDefault(input.languageTable, this.languageTable);
        this.languageColumn = valueOrDefault(input.languageColumn, this.languageColumn);
        this.alternateIndex = valueOrDefault(input.alternateIndex, this.alternateIndex);
        this.triggerRoot = valueOrDefault(input.triggerRoot, this.triggerRoot);
        this.addRowstamp = valueOrDefault(input.addRowstamp, this.addRowstamp);
        this.textSearchEnabled = valueOrDefault(input.textSearchEnabled, this.textSearchEnabled);
        this.view = valueOrDefault(input.view, this.view);
        this.viewWhere = valueOrDefault(input.viewWhere, this.viewWhere);
        this.joinToObject = valueOrDefault(input.joinToObject, this.joinToObject);
        this.viewSelect = valueOrDefault(input.viewSelect, this.viewSelect);
        this.automaticallySelect = valueOrDefault(input.automaticallySelect, this.automaticallySelect);
        this.viewFrom = valueOrDefault(input.viewFrom, this.viewFrom);
        this.auditEnabled = valueOrDefault(input.auditEnabled, this.auditEnabled);
        this.auditTable = valueOrDefault(input.auditTable, this.auditTable);
        this.eAuditFilter = valueOrDefault(input.eAuditFilter, this.eAuditFilter);
        this.eSignatureFilter = valueOrDefault(input.eSignatureFilter, this.eSignatureFilter);
        this.attributes = Array.isArray(input.attributes) ? input.attributes.map((attribute) => new MaximoAttribute(attribute)) : [];
        this.relationships = Array.isArray(input.relationships) ? input.relationships.map((relationship) => new Relationship(relationship)) : [];
        this.indexes = Array.isArray(input.indexes) ? input.indexes.map((index) => new Index(index)) : [];
    }
}
