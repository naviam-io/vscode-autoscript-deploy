/// <reference path="../../globals.d.ts" />
/// <reference path="../../manage-facade.d.ts" />

import { applyValues, arrayOrEmpty, requireKeys, toExternalSynonymValue, valueOrDefault } from '../core/util';

var MboConstants = Java.type('psdi.mbo.MboConstants');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');

export function addProcessingRules(channel: psdi.mbo.MboRemote, useWith: string, rules: MaximoProcessingRule[]): void {
    const ruleSet = channel.getMboSet('MAXIFACEPROC');
    rules.forEach(function (rule: MaximoProcessingRule): void {
        const mbo = ruleSet.add();
        applyValues(mbo, [
            ['PROCNAME', rule.procName],
            ['USEWITH', useWith, MboConstants.NOACCESSCHECK],
            ['ISOBJECTPROC', useWith === 'ESOBJECTSTRUCTURE', MboConstants.NOACCESSCHECK],
            ['PROCTYPE', toExternalSynonymValue('IFACEPROCTYPE', rule.action, mbo)],
            ['OBJECTNAME', rule.objectName, MboConstants.NOACCESSCHECK],
            [
                'HIERARCHYPATH',
                typeof rule.hierarchyPath !== 'undefined' ? rule.hierarchyPath : structureHierarchyPath(mbo, rule.objectName),
                MboConstants.NOACCESSCHECK
            ],
            ['DESCRIPTION', rule.description],
            ['CLASSNAME', rule.className],
            ['PROCMESSAGE', rule.procMessage],
            ['ENABLED', rule.enabled],
            ['APPLYONINSERT', rule.applyOnInsert],
            ['APPLYONUPDATE', rule.applyOnUpdate],
            ['APPLYONDELETE', rule.applyOnDelete]
        ]);
        rule.conditions.forEach(function (condition: MaximoProcessingRuleCondition): void {
            addCondition(mbo, condition);
        });
        rule.fields.forEach(function (field: MaximoProcessingRuleField): void {
            applyValues(mbo.getMboSet('MAXREPLACEPROC').add(), [
                ['FIELDNAME', field.fieldName],
                ['REPLACENULL', field.replaceNull],
                ['VALUETYPE', field.valueType],
                ['VALUE', field.value],
                ['MBONAME', field.mboName],
                ['RELATION', field.relation]
            ]);
        });
        rule.columns.forEach(function (column: MaximoProcessingRuleColumn): void {
            applyValues(mbo.getMboSet('MAXPROCCOLS').add(), [
                ['FIELDNAME', column.fieldName],
                ['IFACECONTROL', column.ifaceControl]
            ]);
        });
    });
}

/**
 * The path of the object in the rule's object structure, as the application's object lookup fills it in.
 * Maximo fails validating the columns of conditions and fields without it. Undefined when the object
 * is not given or does not appear exactly once in the structure.
 */
function structureHierarchyPath(rule: psdi.mbo.MboRemote, objectName: string | undefined): string | undefined {
    if (!objectName) {
        return undefined;
    }
    const sqlf = new SqlFormat('intobjectname = :1 and objectname = :2');
    sqlf.setObject(1, 'MAXINTOBJDETAIL', 'INTOBJECTNAME', rule.getString('INTOBJECTNAME'));
    sqlf.setObject(2, 'MAXINTOBJDETAIL', 'OBJECTNAME', objectName);
    const detailSet = rule.getMboSet('$NVHIERARCHYPATH', 'MAXINTOBJDETAIL', sqlf.format());
    return detailSet.count() === 1 ? detailSet.moveFirst()!.getString('HIERARCHYPATH') : undefined;
}

function addCondition(rule: psdi.mbo.MboRemote, condition: MaximoProcessingRuleCondition): void {
    const mbo = rule.getMboSet('MAXIFACECOND').add();
    applyValues(mbo, [['CONDITION', condition.condition]]);
    condition.details.forEach(function (detail: MaximoProcessingRuleConditionDetail): void {
        const row = mbo.getMboSet('MAXCONDDETAIL').add();
        applyValues(row, [
            ['CONDSEQUENCE', detail.condSequence],
            ['CONDTYPE', detail.condType],
            ['EVALTYPE', toExternalSynonymValue('EVALTYPE', detail.evalType, row)],
            ['CHANGETYPE', toExternalSynonymValue('CHANGETYPE', detail.changeType, row)],
            ['COMPARETYPE', detail.compareType],
            ['COLUMNNAME', detail.columnName],
            ['MBONAME', detail.mboName],
            ['MBOCOLUMNNAME', detail.mboColumnName],
            ['RELATION', detail.relation],
            ['VALUE', detail.value],
            ['GLORDER', detail.glOrder]
        ]);
    });
}

export class MaximoProcessingRuleConditionDetail {
    static _keys = ['condSequence', 'condType'];

    condSequence: number;
    condType: string;
    evalType: string | undefined;
    changeType: string | undefined;
    compareType: string | undefined;
    columnName: string | undefined;
    mboName: string | undefined;
    mboColumnName: string | undefined;
    relation: string | undefined;
    value: string | undefined;
    glOrder: number | undefined;
    _retain: any = [];

    constructor(input: any) {
        this.condSequence = valueOrDefault(input.condSequence, 1);
        this.condType = input.condType;
        requireKeys(MaximoProcessingRuleConditionDetail, this, 'processing rule condition detail');
        this.evalType = input.evalType;
        this.changeType = input.changeType;
        this.compareType = input.compareType;
        this.columnName = input.columnName;
        this.mboName = input.mboName;
        this.mboColumnName = input.mboColumnName;
        this.relation = input.relation;
        this.value = input.value;
        this.glOrder = input.glOrder;
        this._retain = valueOrDefault(input._retain, this._retain);
    }
}

export class MaximoProcessingRuleCondition {
    static _keys = ['condition'];

    condition: number;
    details: MaximoProcessingRuleConditionDetail[] = [];
    _retain: any = [];

    constructor(input: any) {
        this.condition = valueOrDefault(input.condition, 10);
        this.details = arrayOrEmpty<any>(input.details).map(function (detail: any): MaximoProcessingRuleConditionDetail {
            return new MaximoProcessingRuleConditionDetail(detail);
        });
        this._retain = valueOrDefault(input._retain, this._retain);
    }
}

export class MaximoProcessingRuleField {
    static _keys = ['fieldName', 'replaceNull'];

    fieldName: string;
    replaceNull: boolean;
    valueType: string | undefined;
    value: string | undefined;
    mboName: string | undefined;
    relation: string | undefined;
    _retain: any = [];

    constructor(input: any) {
        requireKeys({ _keys: ['fieldName'] }, input, 'processing rule field');
        this.fieldName = input.fieldName;
        this.replaceNull = input.replaceNull == true;
        this.valueType = input.valueType;
        this.value = input.value;
        this.mboName = input.mboName;
        this.relation = input.relation;
        this._retain = valueOrDefault(input._retain, this._retain);
    }
}

export class MaximoProcessingRuleColumn {
    static _keys = ['fieldName'];

    fieldName: string;
    ifaceControl: string | undefined;
    _retain: any = [];

    constructor(input: any) {
        requireKeys(MaximoProcessingRuleColumn, input, 'processing rule column');
        this.fieldName = input.fieldName;
        this.ifaceControl = input.ifaceControl;
        this._retain = valueOrDefault(input._retain, this._retain);
    }
}

export class MaximoProcessingRule {
    static _keys = ['procName'];

    procName: string;
    action: string;
    objectName: string | undefined;
    hierarchyPath: string | undefined;
    description: string | undefined;
    className: string | undefined;
    procMessage: string | undefined;
    enabled: boolean | undefined;
    applyOnInsert: boolean | undefined;
    applyOnUpdate: boolean | undefined;
    applyOnDelete: boolean | undefined;
    conditions: MaximoProcessingRuleCondition[] = [];
    fields: MaximoProcessingRuleField[] = [];
    columns: MaximoProcessingRuleColumn[] = [];
    _retain: any = [];

    constructor(input: any) {
        requireKeys(MaximoProcessingRule, input, 'processing rule');
        if (!input.action) {
            throw new Error('Processing rule ' + input.procName + ' is missing the required action.');
        }
        this.procName = input.procName;
        this.action = input.action;
        this.objectName = input.objectName;
        this.hierarchyPath = input.hierarchyPath;
        this.description = input.description;
        this.className = input.className;
        this.procMessage = input.procMessage;
        this.enabled = input.enabled;
        this.applyOnInsert = input.applyOnInsert;
        this.applyOnUpdate = input.applyOnUpdate;
        this.applyOnDelete = input.applyOnDelete;
        this.conditions = arrayOrEmpty<any>(input.conditions).map(function (condition: any): MaximoProcessingRuleCondition {
            return new MaximoProcessingRuleCondition(condition);
        });
        this.fields = arrayOrEmpty<any>(input.fields).map(function (field: any): MaximoProcessingRuleField {
            return new MaximoProcessingRuleField(field);
        });
        this.columns = arrayOrEmpty<any>(input.columns).map(function (column: any): MaximoProcessingRuleColumn {
            return new MaximoProcessingRuleColumn(column);
        });
        this._retain = valueOrDefault(input._retain, this._retain);
    }
}
