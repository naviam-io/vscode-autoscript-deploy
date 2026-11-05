/// <reference path="../../globals.d.ts" />
/// <reference path="../../manage-facade.d.ts" />

import { applyOptionalValues, applyValues, close, requireKeys, setValue, updateProgress, valueOrDefault } from '../core/util';
import { applyRetainedValues, hasRetainDeclarations, retainIdentityOf } from '../core/retained-values';
import { deleteSnapshot, readSnapshot, snapshotKey, writeSnapshot } from '../core/snapshot-store';
import { captureExistingState } from '../core/capture';

var MXServer = Java.type('psdi.server.MXServer');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');

export type MaximoMessageDisplayMethod = 'MSGBOX' | 'STATUS' | 'TEXT';
export type MaximoMessageSuffix = 'E' | 'I' | 'W';
export type MaximoMessageOption = 'close' | 'ok' | 'cancel' | 'yes' | 'no' | 'warning' | 'stop' | 'exclamation';

const messageOptions: MaximoMessageOption[] = ['close', 'ok', 'cancel', 'yes', 'no', 'warning', 'stop', 'exclamation'];

/** The Maximo object a message snapshot is keyed by. */
export const SNAPSHOT_OBJECT = 'MAXMESSAGES';

export function process(message: MaximoMessage): void {
    const maximo: psdi.server.MXServer = MXServer.getMXServer();
    const key = snapshotKey(SNAPSHOT_OBJECT, retainIdentityOf(message));
    let mboSet: psdi.mbo.MboSetRemote | null = null;
    try {
        mboSet = maximo.getMboSet('MAXMESSAGES', maximo.getSystemUserInfo());
        const messageName = message.msgGroup + ':' + message.msgKey;

        if (message._delete) {
            updateProgress('Deleting message ' + messageName);
            deleteMessage(mboSet, message);
            deleteSnapshot(key);
            updateProgress('Deleted message ' + messageName);
        } else {
            updateProgress('Adding/Updating message ' + messageName);
            addOrUpdateMessage(mboSet, message, key);
            deleteSnapshot(key);
            updateProgress('Added/Updated message ' + messageName);
        }
    } finally {
        close(mboSet);
    }
}

function deleteMessage(mboSet: psdi.mbo.MboSetRemote, message: MaximoMessage): void {
    const mbo = findMessage(mboSet, message);
    if (mbo) {
        mbo.delete();
        mboSet.save();
    }
}

function addOrUpdateMessage(mboSet: psdi.mbo.MboSetRemote, message: MaximoMessage, key: string): void {
    const mbo = findMessage(mboSet, message);

    if (hasRetainDeclarations(message)) {
        let snapshot = readSnapshot(key);
        if (!snapshot && mbo) {
            snapshot = captureExistingState('messages', mbo.getUniqueIDValue());
            if (!snapshot) {
                throw Error(
                    'Message ' +
                        retainIdentityOf(message) +
                        ' has an existing record whose state could not be captured, so its retained values cannot be preserved.'
                );
            }
            writeSnapshot(key, snapshot);
        }

        message = applyRetainedValues(message, snapshot ? new MaximoMessage(snapshot) : null);
    }

    if (mbo) {
        mbo.delete();
        mboSet.save();
        mboSet.reset();
    }

    applyMessageValues(mboSet.add(), message);
    mboSet.save();
}

function findMessage(mboSet: psdi.mbo.MboSetRemote, message: MaximoMessage): psdi.mbo.MboRemote {
    const sqlf = new SqlFormat('msggroup = :1 and msgkey = :2');
    sqlf.setObject(1, 'MAXMESSAGES', 'MSGGROUP', message.msgGroup);
    sqlf.setObject(2, 'MAXMESSAGES', 'MSGKEY', message.msgKey);
    mboSet.setWhere(sqlf.format());
    return mboSet.moveFirst();
}

function applyMessageValues(mbo: psdi.mbo.MboRemote, message: MaximoMessage): void {
    applyValues(mbo, [
        ['MSGGROUP', message.msgGroup],
        ['MSGKEY', message.msgKey],
        ['VALUE', message.value],
        ['DISPLAYMETHOD', message.displayMethod]
    ]);

    if (message.msgId) {
        setValue(mbo, 'MSGID', message.msgId);
    } else {
        applyValues(mbo, [
            ['MSGIDPREFIX', message.prefix ? message.prefix : 'BMXZZ'],
            ['MSGIDSUFFIX', message.suffix ? message.suffix : 'E']
        ]);
    }

    applyMessageOptions(mbo, message);
    applyOptionalValues(mbo, [
        ['ADMINRESPONSE', message.adminResponse],
        ['EXPLANATION', message.explanation],
        ['OPERATORRESPONSE', message.operatorResponse],
        ['SYSTEMACTION', message.systemAction]
    ]);
}

function applyMessageOptions(mbo: psdi.mbo.MboRemote, message: MaximoMessage): void {
    messageOptions.forEach(function (option) {
        setValue(mbo, option, hasMessageOption(message.options, option));
    });
}

function hasMessageOption(options: MaximoMessageOption[], option: MaximoMessageOption): boolean {
    let index = 0;
    while (index < options.length) {
        if ((options[index] as string).toLowerCase() === option) {
            return true;
        }
        index++;
    }

    return false;
}

export interface MaximoMessageInput {
    _delete?: boolean;
    msgGroup: string;
    msgKey: string;
    value: string | null;
    msgId?: string | null;
    displayMethod?: MaximoMessageDisplayMethod | null;
    options?: MaximoMessageOption[] | null;
    prefix?: string | null;
    suffix?: MaximoMessageSuffix | null;
    explanation?: string | null;
    operatorResponse?: string | null;
    adminResponse?: string | null;
    systemAction?: string | null;
    _retain?: any;
}

export class MaximoMessage {
    static _keys = ['msgGroup', 'msgKey'];

    _delete = false;
    msgGroup: string;
    msgKey: string;
    value: string | null;
    msgId: string | null = null;
    displayMethod: MaximoMessageDisplayMethod | null = 'MSGBOX';
    options: MaximoMessageOption[] = ['ok'];
    prefix: string | null = 'BMXZZ';
    suffix: MaximoMessageSuffix | null = 'E';
    explanation: string | null = null;
    operatorResponse: string | null = null;
    adminResponse: string | null = null;
    systemAction: string | null = null;
    _retain: any = [];

    constructor(input: MaximoMessageInput) {
        requireKeys(MaximoMessage, input, 'message');
        if (!input._delete && typeof input.value === 'undefined') {
            throw new Error('The value property is required and must a Maximo Value field value.');
        }

        this.msgGroup = input.msgGroup;
        this.msgKey = input.msgKey;
        this.value = input.value;

        this._delete = valueOrDefault(input._delete, this._delete);
        this.msgId = valueOrDefault(input.msgId, this.msgId);
        this.displayMethod = valueOrDefault(input.displayMethod, this.displayMethod);
        this.options = Array.isArray(input.options) ? input.options : this.options;
        this.prefix = valueOrDefault(input.prefix, this.prefix);
        this.suffix = valueOrDefault(input.suffix, this.suffix);
        this.explanation = valueOrDefault(input.explanation, this.explanation);
        this.operatorResponse = valueOrDefault(input.operatorResponse, this.operatorResponse);
        this.adminResponse = valueOrDefault(input.adminResponse, this.adminResponse);
        this.systemAction = valueOrDefault(input.systemAction, this.systemAction);
        this._retain = valueOrDefault(input._retain, this._retain);
    }
}
