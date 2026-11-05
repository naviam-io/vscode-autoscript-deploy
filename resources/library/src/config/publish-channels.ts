/// <reference path="../../globals.d.ts" />
/// <reference path="../../manage-facade.d.ts" />

import { applyValues, arrayOrEmpty, close, rejectDuplicates, requireKeys, updateProgress, updateWarning, valueOrDefault } from '../core/util';
import { applyRetainedValues, hasRetainDeclarations, retainIdentityOf } from '../core/retained-values';
import { deleteSnapshot, readSnapshot, snapshotKey, writeSnapshot } from '../core/snapshot-store';
import { captureExistingState } from '../core/capture';
import { MaximoProcessingRule, addProcessingRules } from './processing-rules';
import { MaximoIntegrationControl, addIntegrationControls } from './integration-controls';
import { MaximoIntegrationObject, isPredefined, process as processIntegrationObject } from './integration-objects';

var MXServer = Java.type('psdi.server.MXServer');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');

/** The Maximo object a publish channel snapshot is keyed by. */
export const SNAPSHOT_OBJECT = 'MAXIFACEOUT';

/** Deletes the existing channel and creates it again, with an embedded object structure in between. */
export function process(channel: MaximoPublishChannel): void {
    const maximo: psdi.server.MXServer = MXServer.getMXServer();
    const key = snapshotKey(SNAPSHOT_OBJECT, retainIdentityOf(channel));
    let mboSet: psdi.mbo.MboSetRemote | null = null;
    try {
        mboSet = maximo.getMboSet('MAXIFACEOUT', maximo.getSystemUserInfo());

        if (channel._delete) {
            updateProgress('Deleting publish channel ' + channel.ifaceName);
            deletePublishChannel(mboSet, channel);
            deleteSnapshot(key);
            updateProgress('Deleted publish channel ' + channel.ifaceName);
        } else {
            updateProgress('Adding/Updating publish channel ' + channel.ifaceName);
            addOrUpdatePublishChannel(mboSet, channel, key);
            deleteSnapshot(key);
            updateProgress('Added/Updated publish channel ' + channel.ifaceName);
        }
    } finally {
        close(mboSet);
    }
}

function retainedSnapshot(mbo: psdi.mbo.MboRemote | null, channel: MaximoPublishChannel, key: string): MaximoPublishChannel | null {
    let snapshot = readSnapshot(key);
    if (!snapshot && mbo) {
        snapshot = captureExistingState('publishchannels', mbo.getUniqueIDValue());
        if (!snapshot) {
            throw Error(
                'Publish channel ' +
                    channel.ifaceName +
                    ' has an existing record whose state could not be captured, so its retained values cannot be preserved.'
            );
        }
        writeSnapshot(key, snapshot);
    }
    return snapshot ? new MaximoPublishChannel(snapshot) : null;
}

/**
 * Deletes the channel, and an embedded object structure marked _delete when the channel is deleted. See
 * docs/architecture/integration-framework-types.md. A deployment keeps an object structure it recreates
 * under the same name, so its retained values are captured before it is deleted. The rules block
 * deleting the channel, so they are deleted and saved first.
 */
function deletePublishChannel(mboSet: psdi.mbo.MboSetRemote, channel: MaximoPublishChannel): void {
    const mbo = findPublishChannel(mboSet, channel.ifaceName);
    if (mbo) {
        const link = mbo.getMboSet('MAXEXTIFACEOUT').moveFirst();
        if (link) {
            throw new Error(
                'Publish channel ' +
                    channel.ifaceName +
                    ' cannot be deleted or recreated while the external system ' +
                    link.getString('EXTSYSNAME') +
                    ' uses it.'
            );
        }
        const id = mbo.getUniqueIDValue();
        if (mbo.getBoolean('LISTENER')) {
            (mbo as any).disableListner();
        }
        mbo.getMboSet('MAXIFACEPROC').deleteAll();
        mboSet.save();

        mboSet.getMboForUniqueId(id).delete();
        mboSet.save();
    }
    if (channel.objectStructure && channel.objectStructure._delete) {
        deleteIntegrationObject(channel, channel.objectStructure);
    }
}

function deleteIntegrationObject(channel: MaximoPublishChannel, objectStructure: MaximoIntegrationObject): void {
    if (!channel._delete) {
        updateWarning(
            'Publish channel ' +
                channel.ifaceName +
                ': _delete on the object structure ' +
                objectStructure.intObjectName +
                ' is ignored, as the channel is not deleted.'
        );
    } else if (isPredefined(objectStructure.intObjectName)) {
        updateWarning(
            'Publish channel ' + channel.ifaceName + ': the object structure ' + objectStructure.intObjectName + ' is predefined and is not deleted.'
        );
    } else {
        processIntegrationObject(objectStructure);
    }
}

function addOrUpdatePublishChannel(mboSet: psdi.mbo.MboSetRemote, channel: MaximoPublishChannel, key: string): void {
    if (hasRetainDeclarations(channel)) {
        channel = applyRetainedValues(channel, retainedSnapshot(findPublishChannel(mboSet, channel.ifaceName), channel, key));
    }
    deletePublishChannel(mboSet, channel);
    if (channel.objectStructure && !channel.objectStructure._delete) {
        if (isPredefined(channel.intObjectName)) {
            updateWarning(
                'Publish channel ' +
                    channel.ifaceName +
                    ': the object structure ' +
                    channel.intObjectName +
                    ' is predefined and is not changed, reference it by intObjectName instead of embedding it.'
            );
        } else {
            processIntegrationObject(channel.objectStructure);
        }
    }

    const mbo = mboSet.add();
    applyValues(mbo, [
        ['IFACENAME', channel.ifaceName],
        ['INTOBJECTNAME', channel.intObjectName],
        ['DESCRIPTION', channel.description],
        ['PUBLISHJSON', channel.publishJson],
        ['RETAINMBOS', channel.retainMbos],
        ['SKIPDIFFOBJECT', channel.skipDiffObject],
        ['STOREMSG', channel.storeMsg],
        ['USETXNTRACKING', channel.useTxnTracking],
        ['EVENTFILTERCLASS', channel.eventFilterClass],
        ['EXTMSGIDFIELD', channel.extMsgIdField],
        ['IFACEEXITCLASS', channel.ifaceExitClass],
        ['IFACEMAPNAME', channel.ifaceMapName],
        ['IFACEUSEREXITCLASS', channel.ifaceUserExitClass],
        ['IFACETBNAME', channel.ifaceTbName],
        ['SEARCHFIELD', channel.searchField],
        ['TEMPLATENAME', channel.templateName]
    ]);
    addIntegrationControls(mbo, 'MAXIFACEOUTCNTL', channel.integrationControls);
    addProcessingRules(mbo, 'PUBLISHCHANNEL', channel.processingRules);

    // LISTENER is read only; Maximo spells the method that enables it this way.
    if (channel.listener) {
        (mbo as any).enableListner();
    }
    mboSet.save();
}

function findPublishChannel(mboSet: psdi.mbo.MboSetRemote, ifaceName: string): psdi.mbo.MboRemote | null {
    const sqlf = new SqlFormat('ifacename = :1');
    sqlf.setObject(1, 'MAXIFACEOUT', 'IFACENAME', ifaceName);
    mboSet.setWhere(sqlf.format());
    return mboSet.moveFirst();
}

/** The channel is recreated on every deployment, so a value left undefined takes the Maximo default. */
export class MaximoPublishChannel {
    static _keys = ['ifaceName'];

    _delete = false;
    ifaceName: string;
    description: string | undefined;
    intObjectName: string | undefined;
    objectStructure: MaximoIntegrationObject | undefined;
    listener: boolean | undefined;
    publishJson: boolean | undefined;
    retainMbos: boolean | undefined;
    skipDiffObject: boolean | undefined;
    storeMsg: boolean | undefined;
    useTxnTracking: boolean | undefined;
    eventFilterClass: string | undefined;
    extMsgIdField: string | undefined;
    ifaceExitClass: string | undefined;
    ifaceMapName: string | undefined;
    ifaceUserExitClass: string | undefined;
    ifaceTbName: string | undefined;
    searchField: string | undefined;
    templateName: string | undefined;
    integrationControls: MaximoIntegrationControl[] = [];
    processingRules: MaximoProcessingRule[] = [];
    _retain: any = [];

    constructor(input: any) {
        requireKeys(MaximoPublishChannel, input, 'publish channel');
        this._delete = valueOrDefault(input._delete, this._delete);
        this.ifaceName = input.ifaceName;
        this.description = input.description;
        if (input.objectStructure) {
            if (input.intObjectName && input.intObjectName !== input.objectStructure.intObjectName) {
                throw new Error('Publish channel ' + input.ifaceName + ' intObjectName ' + input.intObjectName + ' does not match its objectStructure.');
            }
            this.objectStructure = new MaximoIntegrationObject(input.objectStructure);
        }
        this.intObjectName = this.objectStructure ? this.objectStructure.intObjectName : input.intObjectName;
        if (!this._delete && !this.intObjectName) {
            throw new Error('Publish channel ' + input.ifaceName + ' needs an intObjectName or an objectStructure.');
        }
        this.listener = input.listener;
        this.publishJson = input.publishJson;
        this.retainMbos = input.retainMbos;
        this.skipDiffObject = input.skipDiffObject;
        this.storeMsg = input.storeMsg;
        this.useTxnTracking = input.useTxnTracking;
        this.eventFilterClass = input.eventFilterClass;
        this.extMsgIdField = input.extMsgIdField;
        this.ifaceExitClass = input.ifaceExitClass;
        this.ifaceMapName = input.ifaceMapName;
        this.ifaceUserExitClass = input.ifaceUserExitClass;
        this.ifaceTbName = input.ifaceTbName;
        this.searchField = input.searchField;
        this.templateName = input.templateName;
        this.integrationControls = arrayOrEmpty<any>(input.integrationControls).map(function (control: any): MaximoIntegrationControl {
            return new MaximoIntegrationControl(control);
        });
        this.processingRules = arrayOrEmpty<any>(input.processingRules).map(function (rule: any): MaximoProcessingRule {
            return new MaximoProcessingRule(rule);
        });
        const owner = 'Publish channel ' + this.ifaceName;
        rejectDuplicates(owner, 'integration control', this.integrationControls, MaximoIntegrationControl._keys);
        rejectDuplicates(owner, 'processing rule', this.processingRules, MaximoProcessingRule._keys);
        this._retain = valueOrDefault(input._retain, this._retain);
    }
}
