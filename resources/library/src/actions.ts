/// <reference path="../globals.d.ts" />
/// <reference path="../manage-facade.d.ts" />

import { applyValues, close, setValue, updateProgress, valueOrDefault } from './util';

var MXServer = Java.type('psdi.server.MXServer');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');

export type MaximoActionType = 'APPACTION' | 'CHANGESTATUS' | 'CUSTOM' | 'EXECUTABLE' | 'GROUP' | 'SETVALUE';

export function process(action: MaximoAction): void {
    const maximo: psdi.server.MXServer = MXServer.getMXServer();
    let mboSet: psdi.mbo.MboSetRemote | null = null;
    try {
        mboSet = maximo.getMboSet('ACTION', maximo.getSystemUserInfo());

        if (action._delete) {
            updateProgress('Deleting action ' + action.action);
            deleteAction(mboSet, action);
            updateProgress('Deleted action ' + action.action);
        } else {
            updateProgress('Adding/Updating action ' + action.action);
            addOrUpdateAction(mboSet, action);
            updateProgress('Added/Updated action ' + action.action);
        }
    } finally {
        close(mboSet);
    }
}

function deleteAction(mboSet: psdi.mbo.MboSetRemote, action: MaximoAction): void {
    setActionWhere(mboSet, action.action);
    mboSet.deleteAll();
    mboSet.save();
}

function addOrUpdateAction(mboSet: psdi.mbo.MboSetRemote, action: MaximoAction): void {
    setActionWhere(mboSet, action.action);
    mboSet.deleteAll();
    mboSet.save();
    mboSet.reset();

    const mbo = mboSet.add();
    applyActionValues(mbo, action);
    mboSet.save();
}

function setActionWhere(mboSet: psdi.mbo.MboSetRemote, actionName: string): void {
    const sqlf = new SqlFormat('action = :1');
    sqlf.setObject(1, 'ACTION', 'ACTION', actionName);
    mboSet.setWhere(sqlf.format());
}

function applyActionValues(mbo: psdi.mbo.MboRemote, action: MaximoAction): void {
    applyValues(mbo, [
        ['ACTION', action.action],
        ['DESCRIPTION', action.description],
        ['SENDERSYSID', action.senderSysId],
        ['TYPE', action.type],
        ['USEWITH', action.useWith]
    ]);

    if (action.type === 'CUSTOM') {
        setValue(mbo, 'VALUE', action.value);
    } else {
        setValue(mbo, 'VALUE2', action.value);
    }

    if (action.type !== 'GROUP') {
        setValue(mbo, 'OBJECTNAME', action.objectName);
        setValue(mbo, 'PARAMETER', action.parameter);
    }

    if (action.type === 'CHANGESTATUS') {
        setValue(mbo, 'MEMO', action.memo);
    }

    applyActionGroups(mbo, action.actionGroup);
}

function applyActionGroups(mbo: psdi.mbo.MboRemote, actionGroups: MaximoActionGroup[]): void {
    const actionGroupSet = mbo.getMboSet('ACTION_MEMBERS');

    actionGroups.forEach(function (actionGroup: MaximoActionGroup): void {
        const actionGroupMbo = actionGroupSet.add();
        setValue(actionGroupMbo, 'MEMBER', actionGroup.member);
        setValue(actionGroupMbo, 'SEQUENCE', actionGroup.sequence);
    });
}

export interface MaximoActionGroupInput {
    member: string;
    sequence: number;
}

export class MaximoActionGroup {
    member: string;
    sequence: number;

    constructor(input: MaximoActionGroupInput) {
        this.member = input.member;
        this.sequence = input.sequence;
    }
}

export interface MaximoActionInput {
    _delete?: boolean;
    action: string;
    description?: string | null;
    senderSysId?: string | null;
    type: MaximoActionType;
    useWith: string;
    value?: string | null;
    objectName?: string | null;
    parameter?: string | null;
    memo?: string | null;
    actionGroup?: MaximoActionGroupInput[] | null;
}

export class MaximoAction {
    _delete = false;
    action: string;
    description: string | null = '';
    senderSysId: string | null = 'MX';
    type: MaximoActionType;
    useWith: string;
    value: string | null = '';
    objectName: string | null = '';
    parameter: string | null = '';
    memo: string | null = '';
    actionGroup: MaximoActionGroup[] = [];

    constructor(input: MaximoActionInput) {
        this.action = input.action;
        this.type = input.type;
        this.useWith = input.useWith;

        this._delete = valueOrDefault(input._delete, this._delete);
        this.description = valueOrDefault(input.description, this.description);
        this.senderSysId = valueOrDefault(input.senderSysId, this.senderSysId);
        this.value = valueOrDefault(input.value, this.value);
        this.objectName = valueOrDefault(input.objectName, this.objectName);
        this.parameter = valueOrDefault(input.parameter, this.parameter);
        this.memo = valueOrDefault(input.memo, this.memo);
        this.actionGroup = (input.actionGroup || []).map((actionGroup) => new MaximoActionGroup(actionGroup));
    }
}
