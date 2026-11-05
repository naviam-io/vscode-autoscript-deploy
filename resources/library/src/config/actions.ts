/// <reference path="../../globals.d.ts" />
/// <reference path="../../manage-facade.d.ts" />

import {
    applyValues,
    applyWritableValues,
    close,
    requireKeys,
    setValue,
    toExternalSynonymValue,
    toInternalSynonymValue,
    updateProgress,
    valueOrDefault
} from '../core/util';
import { applyRetainedValues, hasRetainDeclarations, retainIdentityOf } from '../core/retained-values';
import { deleteSnapshot, readSnapshot, snapshotKey, writeSnapshot } from '../core/snapshot-store';
import { captureExistingState } from '../core/capture';

var MXServer = Java.type('psdi.server.MXServer');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');
var MboConstants = Java.type('psdi.mbo.MboConstants');

/** The Maximo object an action snapshot is keyed by. */
export const SNAPSHOT_OBJECT = 'ACTION';

export function process(action: MaximoAction): void {
    const maximo: psdi.server.MXServer = MXServer.getMXServer();
    const key = snapshotKey(SNAPSHOT_OBJECT, retainIdentityOf(action));
    let mboSet: psdi.mbo.MboSetRemote | null = null;
    try {
        mboSet = maximo.getMboSet('ACTION', maximo.getSystemUserInfo());

        if (action._delete) {
            updateProgress('Deleting action ' + action.action);
            deleteAction(mboSet, action);
            deleteSnapshot(key);
            updateProgress('Deleted action ' + action.action);
        } else {
            updateProgress('Adding/Updating action ' + action.action);
            addOrUpdateAction(mboSet, action, key);
            deleteSnapshot(key);
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

function addOrUpdateAction(mboSet: psdi.mbo.MboSetRemote, action: MaximoAction, key: string): void {
    setActionWhere(mboSet, action.action);
    let mbo = mboSet.moveFirst();

    if (hasRetainDeclarations(action)) {
        let snapshot = readSnapshot(key);
        if (!snapshot && mbo) {
            snapshot = captureExistingState('actions', mbo.getUniqueIDValue());
            if (!snapshot) {
                throw Error(
                    'Action ' + action.action + ' has an existing record whose state could not be captured, so its retained values cannot be preserved.'
                );
            }
            writeSnapshot(key, snapshot);
        }

        action = applyRetainedValues(action, snapshot ? new MaximoAction(snapshot) : null);
    }

    // An existing action is updated in place, because Maximo refuses to delete one that an
    // escalation point refers to. A change of type is the exception: the action is recreated so
    // that no value the new type does not use is left behind.
    if (mbo && toInternalSynonymValue('ACTIONTYPE', mbo.getString('TYPE'), mbo) !== toInternalSynonymValue('ACTIONTYPE', action.type, mbo)) {
        mboSet.deleteAll();
        mboSet.save();
        mboSet.reset();
        mbo = null;
    }

    if (!mbo) {
        mbo = mboSet.add();
    }

    applyActionValues(mbo, action);
    mboSet.save();
}

function setActionWhere(mboSet: psdi.mbo.MboSetRemote, actionName: string): void {
    const sqlf = new SqlFormat('action = :1');
    sqlf.setObject(1, 'ACTION', 'ACTION', actionName);
    mboSet.setWhere(sqlf.format());
}

function applyActionValues(mbo: psdi.mbo.MboRemote, action: MaximoAction): void {
    if (mbo.toBeAdded()) {
        setValue(mbo, 'ACTION', action.action);
    }

    applyValues(mbo, [
        ['DESCRIPTION', action.description],
        ['SENDERSYSID', action.senderSysId],
        ['TYPE', toExternalSynonymValue('ACTIONTYPE', action.type, mbo)],
        ['USEWITH', toExternalSynonymValue('ACTIONUSEWITH', action.useWith, mbo)]
    ]);

    const type = toInternalSynonymValue('ACTIONTYPE', action.type, mbo);

    if (type === 'CUSTOM') {
        setValue(mbo, 'VALUE', action.value);
    } else {
        setValue(mbo, 'VALUE2', action.value);
    }

    // A group takes an object too, which an escalation point requires of its action group. Setting
    // the object removes a group's members, so it is applied only when it changes, before they are
    // reconciled.
    if (String(mbo.getString('OBJECTNAME')) !== String(action.objectName || '')) {
        applyWritableValues(mbo, [['OBJECTNAME', action.objectName]]);
    }

    if (type !== 'GROUP') {
        applyWritableValues(mbo, [['PARAMETER', action.parameter]]);
    }

    if (type === 'CHANGESTATUS') {
        setValue(mbo, 'MEMO', action.memo);
    }

    applyActionGroups(mbo, action.actionGroup);
}

/**
 * Maximo rejects a sequence that another member of the group already holds, even one marked for
 * deletion, so a member cannot be removed and another added at the same sequence. Rows are
 * therefore matched by sequence: a changed member is set on the existing row (MEMBER is read only
 * once saved, hence NOACCESSCHECK), and a row that changing the group's object marked for deletion
 * is restored.
 */
function applyActionGroups(mbo: psdi.mbo.MboRemote, actionGroups: MaximoActionGroup[]): void {
    const actionGroupSet = mbo.getMboSet('ACTION_MEMBERS');
    const missing: { [sequence: string]: MaximoActionGroup } = {};
    actionGroups.forEach(function (actionGroup: MaximoActionGroup): void {
        missing[String(Number(actionGroup.sequence))] = actionGroup;
    });

    let actionGroupMbo = actionGroupSet.moveFirst();
    while (actionGroupMbo) {
        const sequence = String(actionGroupMbo.getInt('SEQUENCE'));
        const actionGroup = missing[sequence];
        if (Object.prototype.hasOwnProperty.call(missing, sequence)) {
            if (actionGroupMbo.toBeDeleted()) {
                actionGroupMbo.undelete();
            }
            if (String(actionGroupMbo.getString('MEMBER')) !== String(actionGroup.member)) {
                setValue(actionGroupMbo, 'MEMBER', actionGroup.member, MboConstants.NOACCESSCHECK);
            }
            delete missing[sequence];
        } else if (!actionGroupMbo.toBeDeleted()) {
            actionGroupMbo.delete();
        }
        actionGroupMbo = actionGroupSet.moveNext();
    }

    Object.keys(missing).forEach(function (sequence: string): void {
        const added = actionGroupSet.add();
        setValue(added, 'MEMBER', missing[sequence].member);
        setValue(added, 'SEQUENCE', missing[sequence].sequence);
    });
}

export interface MaximoActionGroupInput {
    member: string;
    sequence: number;
}

export class MaximoActionGroup {
    static _keys = ['sequence'];

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
    type: string;
    useWith: string;
    value?: string | null;
    objectName?: string | null;
    parameter?: string | null;
    memo?: string | null;
    actionGroup?: MaximoActionGroupInput[] | null;
    _retain?: any;
}

export class MaximoAction {
    static _keys = ['action'];

    _delete = false;
    action: string;
    description: string | null = '';
    senderSysId: string | null = 'MX';
    type: string;
    useWith: string;
    value: string | null = '';
    objectName: string | null = '';
    parameter: string | null = '';
    memo: string | null = '';
    actionGroup: MaximoActionGroup[] = [];
    _retain: any = [];

    constructor(input: MaximoActionInput) {
        requireKeys(MaximoAction, input, 'action');

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
        this._retain = valueOrDefault(input._retain, this._retain);
    }
}
