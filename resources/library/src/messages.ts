/// <reference path="../globals.d.ts" />
/// <reference path="../manage-facade.d.ts" />

import { applyOptionalValues, applyValues, close, setValue, updateProgress, valueOrDefault } from './util';

var MXServer = Java.type('psdi.server.MXServer');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');

export type MaximoMessageDisplayMethod = 'MSGBOX' | 'STATUS' | 'TEXT';
export type MaximoMessageSuffix = 'E' | 'I' | 'W';
export type MaximoMessageOption = 'close' | 'ok' | 'cancel' | 'yes' | 'no' | 'warning' | 'stop' | 'exclamation';

const messageOptions: MaximoMessageOption[] = ['close', 'ok', 'cancel', 'yes', 'no', 'warning', 'stop', 'exclamation'];

export function process(message: MaximoMessage): void {
    const maximo: psdi.server.MXServer = MXServer.getMXServer();
    let mboSet: psdi.mbo.MboSetRemote | null = null;
    try {
        mboSet = maximo.getMboSet('MAXMESSAGES', maximo.getSystemUserInfo());
        const messageName = message.msgGroup + ':' + message.msgKey;

        if (message._delete) {
            updateProgress('Deleting message ' + messageName);
            deleteMessage(mboSet, message);
            updateProgress('Deleted message ' + messageName);
        } else {
            updateProgress('Adding/Updating message ' + messageName);
            addOrUpdateMessage(mboSet, message);
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

function addOrUpdateMessage(mboSet: psdi.mbo.MboSetRemote, message: MaximoMessage): void {
    const mbo = findMessage(mboSet, message);
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
}

export class MaximoMessage {
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

    constructor(input: MaximoMessageInput) {
        if (!input) {
            throw new Error('A message JSON is required to create the Message object.');
        } else if (typeof input.msgGroup === 'undefined') {
            throw new Error('The msgGroup property is required and must a Maximo Message Group field value.');
        } else if (typeof input.msgKey === 'undefined') {
            throw new Error('The msgKey property is required and must a Maximo Message Key field value.');
        } else if (typeof input.value === 'undefined') {
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
    }
}
