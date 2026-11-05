/// <reference path="../../globals.d.ts" />
/// <reference path="../../manage-facade.d.ts" />

import {
    applyValues,
    arrayOrEmpty,
    close,
    rejectDuplicates,
    requireKeys,
    toExternalSynonymValue,
    toInternalSynonymValue,
    updateProgress,
    updateWarning,
    valueOrDefault
} from '../core/util';
import { applyRetainedValues, hasRetainDeclarations, retainIdentityOf } from '../core/retained-values';
import { deleteSnapshot, readSnapshot, snapshotKey, writeSnapshot } from '../core/snapshot-store';
import { captureExistingState } from '../core/capture';
import { MaximoPublishChannel, process as processPublishChannel } from './publish-channels';
import { MaximoEnterpriseService, process as processEnterpriseService } from './enterprise-services';

var MXServer = Java.type('psdi.server.MXServer');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');
var MboConstants = Java.type('psdi.mbo.MboConstants');

/** The Maximo object an external system snapshot is keyed by. */
export const SNAPSHOT_OBJECT = 'MAXEXTSYSTEM';

/**
 * The relationship from MAXEXTSYSCONTROL to the overrides of a control of each type. A value or boolean override holds its value itself,
 * a list or cross-reference override holds its values in rows under it.
 */
const OVERRIDE_OBJECT_BY_CONTROL_TYPE: { [type: string]: string } = {
    VALUE: 'MAXEXTCTLVAL',
    BOOLEAN: 'MAXEXTBOOLVAL',
    LIST: 'MAXEXTOVER',
    CROSSREFERENCE: 'MAXEXTOVER'
};

/** Deletes the existing system and creates it again, with the embedded channels and services in between. */
export function process(system: MaximoExternalSystem): void {
    const maximo: psdi.server.MXServer = MXServer.getMXServer();
    const key = snapshotKey(SNAPSHOT_OBJECT, retainIdentityOf(system));
    let mboSet: psdi.mbo.MboSetRemote | null = null;
    try {
        mboSet = maximo.getMboSet('MAXEXTSYSTEM', maximo.getSystemUserInfo());

        if (system._delete) {
            updateProgress('Deleting external system ' + system.extSysName);
            deleteExternalSystem(mboSet, system);
            deleteSnapshot(key);
            updateProgress('Deleted external system ' + system.extSysName);
        } else {
            updateProgress('Adding/Updating external system ' + system.extSysName);
            addOrUpdateExternalSystem(mboSet, system, key);
            deleteSnapshot(key);
            updateProgress('Added/Updated external system ' + system.extSysName);
        }
    } finally {
        close(mboSet);
    }
}

function retainedSnapshot(mbo: psdi.mbo.MboRemote | null, system: MaximoExternalSystem, key: string): MaximoExternalSystem | null {
    let snapshot = readSnapshot(key);
    if (!snapshot && mbo) {
        snapshot = captureExistingState('externalsystems', mbo.getUniqueIDValue());
        if (!snapshot) {
            throw Error(
                'External system ' +
                    system.extSysName +
                    ' has an existing record whose state could not be captured, so its retained values cannot be preserved.'
            );
        }
        writeSnapshot(key, snapshot);
    }
    return snapshot ? new MaximoExternalSystem(snapshot) : null;
}

/**
 * Deletes the system, then the embedded records marked _delete. See docs/architecture/integration-framework-types.md. Maximo refuses
 * to delete an enabled system, and deleting it deletes its links and controls with it.
 */
function deleteExternalSystem(mboSet: psdi.mbo.MboSetRemote, system: MaximoExternalSystem): void {
    validateEmbeddedNotShared(system, system.publishChannels, 'publishChannel', 'MAXEXTIFACEOUT', 'publish channel');
    validateEmbeddedNotShared(system, system.enterpriseServices, 'enterpriseService', 'MAXEXTIFACEIN', 'enterprise service');
    const mbo = findExternalSystem(mboSet, system.extSysName);
    if (mbo) {
        const id = mbo.getUniqueIDValue();
        if (mbo.getBoolean('ENABLED')) {
            mbo.setValue('ENABLED', false);
            mboSet.save();
        }
        mboSet.getMboForUniqueId(id).delete();
        mboSet.save();
    }
    deleteEmbedded(system.publishChannels, 'publishChannel', processPublishChannel);
    deleteEmbedded(system.enterpriseServices, 'enterpriseService', processEnterpriseService);
}

function addOrUpdateExternalSystem(mboSet: psdi.mbo.MboSetRemote, system: MaximoExternalSystem, key: string): void {
    if (hasRetainDeclarations(system)) {
        system = applyRetainedValues(system, retainedSnapshot(findExternalSystem(mboSet, system.extSysName), system, key));
    }
    validateIntegrationControls(system);
    deleteExternalSystem(mboSet, system);
    addOrUpdateEmbedded(system, system.publishChannels, 'publishChannel', 'MAXIFACEOUT', 'publish channel', processPublishChannel);
    addOrUpdateEmbedded(system, system.enterpriseServices, 'enterpriseService', 'MAXIFACEIN', 'enterprise service', processEnterpriseService);

    const mbo = mboSet.add();
    applyValues(mbo, [
        ['EXTSYSNAME', system.extSysName],
        ['DESCRIPTION', system.description],
        ['ENDPOINTNAME', system.endPointName],
        ['LANGCODE', system.langCode],
        ['BIDICONFIG', system.bidiConfig],
        ['JMSMSGENCODING', system.jmsMsgEncoding],
        ['OUTSEQQUEUENAME', system.outSeqQueueName],
        ['OUTCONTQUEUENAME', system.outContQueueName],
        ['INSEQQUEUENAME', system.inSeqQueueName],
        ['INCONTQUEUENAME', system.inContQueueName]
    ]);
    addLinks(mbo, system.publishChannels, 'publishChannel', 'MAXEXTIFACEOUT');
    addLinks(mbo, system.enterpriseServices, 'enterpriseService', 'MAXEXTIFACEIN');
    system.integrationControls.forEach(function (control: MaximoExternalSystemIntegrationControl): void {
        addControl(mbo, control);
    });
    applyValues(mbo, [['ENABLED', system.enabled]]);
    mboSet.save();
}

/**
 * The publish channel and enterprise service handlers refuse a record another system links, but only once this system is deleted,
 * so the check is made before. When the system itself is deleted, only the records marked _delete are checked.
 */
function validateEmbeddedNotShared(system: MaximoExternalSystem, links: any[], property: string, linkObject: string, label: string): void {
    links.forEach(function (link: any): void {
        const record = link[property];
        if (!record || (system._delete && !record._delete)) {
            return;
        }
        const maximo: psdi.server.MXServer = MXServer.getMXServer();
        let linkSet: psdi.mbo.MboSetRemote | null = null;
        try {
            linkSet = maximo.getMboSet(linkObject, maximo.getSystemUserInfo());
            const sqlf = new SqlFormat('ifacename = :1 and extsysname != :2');
            sqlf.setObject(1, linkObject, 'IFACENAME', record.ifaceName);
            sqlf.setObject(2, linkObject, 'EXTSYSNAME', system.extSysName);
            linkSet.setWhere(sqlf.format());
            const other = linkSet.moveFirst();
            if (other) {
                throw new Error(
                    'External system ' +
                        system.extSysName +
                        ': the embedded ' +
                        label +
                        ' ' +
                        record.ifaceName +
                        ' cannot be deleted or recreated while the external system ' +
                        other.getString('EXTSYSNAME') +
                        ' uses it. Reference it by ifaceName instead of embedding it.'
                );
            }
        } finally {
            close(linkSet);
        }
    });
}

function deleteEmbedded(links: any[], property: string, processRecord: (record: any) => void): void {
    links.forEach(function (link: any): void {
        if (link[property] && link[property]._delete) {
            processRecord(link[property]);
        }
    });
}

/** A predefined record is skipped with a warning. */
function addOrUpdateEmbedded(
    system: MaximoExternalSystem,
    links: any[],
    property: string,
    object: string,
    label: string,
    processRecord: (record: any) => void
): void {
    links.forEach(function (link: any): void {
        const record = link[property];
        if (!record || record._delete) {
            return;
        }
        if (isPredefined(object, record.ifaceName)) {
            updateWarning(
                'External system ' +
                    system.extSysName +
                    ': the ' +
                    label +
                    ' ' +
                    record.ifaceName +
                    ' is predefined and is not changed, reference it by ifaceName instead of embedding it.'
            );
        } else {
            processRecord(record);
        }
    });
}

/** A link whose embedded record is marked _delete is dropped. */
function addLinks(system: psdi.mbo.MboRemote, links: any[], property: string, linkObject: string): void {
    links.forEach(function (link: any): void {
        if (!link[property] || !link[property]._delete) {
            applyValues(system.getMboSet(linkObject).add(), [
                ['IFACENAME', link.ifaceName],
                ['ENDPOINTNAME', link.endPointName],
                ['ISCONTINUOUSQUEUE', link.isContinuousQueue],
                ['ENABLED', link.enabled]
            ]);
        }
    });
}

/**
 * Adds the controls to an unsaved system that is discarded, so that Maximo refuses an unknown control, a value outside the control's
 * domain or an unknown organization or site before the existing system is deleted.
 */
function validateIntegrationControls(system: MaximoExternalSystem): void {
    if (system.integrationControls.length === 0) {
        return;
    }
    const maximo: psdi.server.MXServer = MXServer.getMXServer();
    let mboSet: psdi.mbo.MboSetRemote | null = null;
    try {
        mboSet = maximo.getMboSet('MAXEXTSYSTEM', maximo.getSystemUserInfo());
        const mbo = mboSet.add();
        // A name of its own, as the existing system's controls would clash with the scratch ones.
        mbo.setValue('EXTSYSNAME', 'NV' + new Date().getTime(), MboConstants.NOVALIDATION);
        system.integrationControls.forEach(function (control: MaximoExternalSystemIntegrationControl): void {
            try {
                addControl(mbo, control);
            } catch (error) {
                throw new Error('External system ' + system.extSysName + ', integration control ' + control.control + ': ' + error.message);
            }
        });
    } finally {
        close(mboSet);
    }
}

/**
 * A value or boolean control holds its value on the control row, a list or cross-reference control in MAXEXTLISTVAL or MAXEXTXREFVAL
 * under it. Each override goes in the table OVERRIDE_OBJECT_BY_CONTROL_TYPE names, a list or cross-reference override with its values in
 * MAXLISTOVERVAL or MAXXREFOVERVAL. The type is read from the control row once IFACECONTROL is set.
 */
function addControl(system: psdi.mbo.MboRemote, control: MaximoExternalSystemIntegrationControl): void {
    const mbo = system.getMboSet('MAXEXTSYSCONTROL').add();
    applyValues(mbo, [['IFACECONTROL', control.control]]);
    const type = toInternalSynonymValue('CONTROLTYPE', mbo.getString('CONTROLTYPE'), mbo);
    const domainId = mbo.isNull('DOMAINID') ? null : mbo.getString('DOMAINID');
    applyControlValues(mbo, domainId, control, 'MAXEXTLISTVAL', 'MAXEXTXREFVAL');
    control.overrides.forEach(function (override: MaximoExternalSystemIntegrationControlOverride): void {
        const row = mbo.getMboSet(OVERRIDE_OBJECT_BY_CONTROL_TYPE[type]).add();
        applyValues(row, [
            ['ORGID', override.orgId],
            ['SITEID', override.siteId]
        ]);
        applyControlValues(row, domainId, override, 'MAXLISTOVERVAL', 'MAXXREFOVERVAL');
    });
}

function applyControlValues(
    mbo: psdi.mbo.MboRemote,
    domainId: string | null,
    values: MaximoExternalSystemIntegrationControl | MaximoExternalSystemIntegrationControlOverride,
    listObject: string,
    crossReferenceObject: string
): void {
    applyValues(mbo, [
        ['VALUE', domainValue(domainId, values.value, mbo)],
        ['ISTRUE', values.isTrue]
    ]);
    values.listValues.forEach(function (row: MaximoExternalSystemIntegrationControlListValue): void {
        const value = mbo.getMboSet(listObject).add();
        applyValues(value, [['VALUE', domainValue(domainId, row.value, value)]]);
    });
    values.crossReferenceValues.forEach(function (row: MaximoExternalSystemIntegrationControlCrossReferenceValue): void {
        const value = mbo.getMboSet(crossReferenceObject).add();
        applyValues(value, [
            ['VALUE', domainValue(domainId, row.value, value)],
            ['NEWVALUE', row.newValue]
        ]);
    });
}

function domainValue(domainId: string | null, value: any, mbo: psdi.mbo.MboRemote): any {
    return domainId ? toExternalSynonymValue(domainId, value, mbo) : value;
}

function isPredefined(object: string, ifaceName: string): boolean {
    const maximo: psdi.server.MXServer = MXServer.getMXServer();
    let mboSet: psdi.mbo.MboSetRemote | null = null;
    try {
        mboSet = maximo.getMboSet(object, maximo.getSystemUserInfo());
        const sqlf = new SqlFormat('ifacename = :1');
        sqlf.setObject(1, object, 'IFACENAME', ifaceName);
        mboSet.setWhere(sqlf.format());
        const mbo = mboSet.moveFirst();
        return mbo !== null && !mbo.getBoolean('USERDEFINED');
    } finally {
        close(mboSet);
    }
}

function findExternalSystem(mboSet: psdi.mbo.MboSetRemote, extSysName: string): psdi.mbo.MboRemote | null {
    const sqlf = new SqlFormat('extsysname = :1');
    sqlf.setObject(1, 'MAXEXTSYSTEM', 'EXTSYSNAME', extSysName);
    mboSet.setWhere(sqlf.format());
    mboSet.reset();
    return mboSet.moveFirst();
}

export class MaximoExternalSystemPublishChannel {
    static _keys = ['ifaceName'];

    ifaceName: string;
    publishChannel: MaximoPublishChannel | undefined;
    enabled: boolean | undefined;
    endPointName: string | undefined;
    isContinuousQueue: boolean | undefined;
    _retain: any = [];

    constructor(input: any) {
        this.publishChannel = input.publishChannel ? new MaximoPublishChannel(input.publishChannel) : undefined;
        this.ifaceName = this.publishChannel ? this.publishChannel.ifaceName : input.ifaceName;
        requireKeys(MaximoExternalSystemPublishChannel, this, 'external system publish channel');
        this.enabled = input.enabled;
        this.endPointName = input.endPointName;
        this.isContinuousQueue = input.isContinuousQueue;
        this._retain = valueOrDefault(input._retain, this._retain);
    }
}

export class MaximoExternalSystemEnterpriseService {
    static _keys = ['ifaceName'];

    ifaceName: string;
    enterpriseService: MaximoEnterpriseService | undefined;
    enabled: boolean | undefined;
    isContinuousQueue: boolean | undefined;
    _retain: any = [];

    constructor(input: any) {
        this.enterpriseService = input.enterpriseService ? new MaximoEnterpriseService(input.enterpriseService) : undefined;
        this.ifaceName = this.enterpriseService ? this.enterpriseService.ifaceName : input.ifaceName;
        requireKeys(MaximoExternalSystemEnterpriseService, this, 'external system enterprise service');
        this.enabled = input.enabled;
        this.isContinuousQueue = input.isContinuousQueue;
        this._retain = valueOrDefault(input._retain, this._retain);
    }
}

export class MaximoExternalSystemIntegrationControlListValue {
    static _keys = ['value'];

    value: string;

    constructor(input: any) {
        requireKeys(MaximoExternalSystemIntegrationControlListValue, input, 'integration control list value');
        this.value = input.value;
    }
}

/** Either side of a cross reference may be blank, so neither key is required. */
export class MaximoExternalSystemIntegrationControlCrossReferenceValue {
    static _keys = ['value', 'newValue'];

    value: string | undefined;
    newValue: string | undefined;

    constructor(input: any) {
        this.value = input.value;
        this.newValue = input.newValue;
    }
}

/** An organization or a site override. */
export class MaximoExternalSystemIntegrationControlOverride {
    static _keys = ['orgId', 'siteId'];

    orgId: string | undefined;
    siteId: string | undefined;
    value: string | undefined;
    isTrue: boolean | undefined;
    listValues: MaximoExternalSystemIntegrationControlListValue[] = [];
    crossReferenceValues: MaximoExternalSystemIntegrationControlCrossReferenceValue[] = [];
    _retain: any = [];

    constructor(input: any) {
        // Maximo keeps an override for an organization or for a site, setting the site clears the organization.
        if (!input || !input.orgId === !input.siteId) {
            throw new Error('An integration control override takes either an "orgId" or a "siteId".');
        }
        this.orgId = input.orgId;
        this.siteId = input.siteId;
        this.value = input.value;
        this.isTrue = input.isTrue;
        this.listValues = listValuesOf(input);
        this.crossReferenceValues = crossReferenceValuesOf(input);
        const owner = 'Integration control override ' + [this.orgId, this.siteId].filter(Boolean).join(' ');
        rejectDuplicates(owner, 'list value', this.listValues, MaximoExternalSystemIntegrationControlListValue._keys);
        rejectDuplicates(owner, 'cross reference value', this.crossReferenceValues, MaximoExternalSystemIntegrationControlCrossReferenceValue._keys);
        this._retain = valueOrDefault(input._retain, this._retain);
    }
}

export class MaximoExternalSystemIntegrationControl {
    static _keys = ['control'];

    control: string;
    value: string | undefined;
    isTrue: boolean | undefined;
    listValues: MaximoExternalSystemIntegrationControlListValue[] = [];
    crossReferenceValues: MaximoExternalSystemIntegrationControlCrossReferenceValue[] = [];
    overrides: MaximoExternalSystemIntegrationControlOverride[] = [];
    _retain: any = [];

    constructor(input: any) {
        requireKeys(MaximoExternalSystemIntegrationControl, input, 'integration control');
        this.control = input.control;
        this.value = input.value;
        this.isTrue = input.isTrue;
        this.listValues = listValuesOf(input);
        this.crossReferenceValues = crossReferenceValuesOf(input);
        this.overrides = arrayOrEmpty<any>(input.overrides).map(function (override: any): MaximoExternalSystemIntegrationControlOverride {
            return new MaximoExternalSystemIntegrationControlOverride(override);
        });
        const owner = 'Integration control ' + this.control;
        rejectDuplicates(owner, 'list value', this.listValues, MaximoExternalSystemIntegrationControlListValue._keys);
        rejectDuplicates(owner, 'cross reference value', this.crossReferenceValues, MaximoExternalSystemIntegrationControlCrossReferenceValue._keys);
        rejectDuplicates(owner, 'override', this.overrides, MaximoExternalSystemIntegrationControlOverride._keys);
        this._retain = valueOrDefault(input._retain, this._retain);
    }
}

function listValuesOf(input: any): MaximoExternalSystemIntegrationControlListValue[] {
    return arrayOrEmpty<any>(input.listValues).map(function (row: any): MaximoExternalSystemIntegrationControlListValue {
        return new MaximoExternalSystemIntegrationControlListValue(row);
    });
}

function crossReferenceValuesOf(input: any): MaximoExternalSystemIntegrationControlCrossReferenceValue[] {
    return arrayOrEmpty<any>(input.crossReferenceValues).map(function (row: any): MaximoExternalSystemIntegrationControlCrossReferenceValue {
        return new MaximoExternalSystemIntegrationControlCrossReferenceValue(row);
    });
}

/** The system is recreated on every deployment, so a value left undefined takes the Maximo default. */
export class MaximoExternalSystem {
    static _keys = ['extSysName'];

    _delete = false;
    extSysName: string;
    description: string | undefined;
    endPointName: string | undefined;
    langCode: string | undefined;
    bidiConfig: string | undefined;
    jmsMsgEncoding: string | undefined;
    outSeqQueueName: string | undefined;
    outContQueueName: string | undefined;
    inSeqQueueName: string | undefined;
    inContQueueName: string | undefined;
    enabled: boolean | undefined;
    publishChannels: MaximoExternalSystemPublishChannel[] = [];
    enterpriseServices: MaximoExternalSystemEnterpriseService[] = [];
    integrationControls: MaximoExternalSystemIntegrationControl[] = [];
    _retain: any = [];

    constructor(input: any) {
        requireKeys(MaximoExternalSystem, input, 'external system');
        this._delete = valueOrDefault(input._delete, this._delete);
        this.extSysName = input.extSysName;
        this.description = input.description;
        this.endPointName = input.endPointName;
        this.langCode = input.langCode;
        this.bidiConfig = input.bidiConfig;
        this.jmsMsgEncoding = input.jmsMsgEncoding;
        this.outSeqQueueName = input.outSeqQueueName;
        this.outContQueueName = input.outContQueueName;
        this.inSeqQueueName = input.inSeqQueueName;
        this.inContQueueName = input.inContQueueName;
        this.enabled = input.enabled;
        this.publishChannels = arrayOrEmpty<any>(input.publishChannels).map(function (link: any): MaximoExternalSystemPublishChannel {
            return new MaximoExternalSystemPublishChannel(link);
        });
        this.enterpriseServices = arrayOrEmpty<any>(input.enterpriseServices).map(function (link: any): MaximoExternalSystemEnterpriseService {
            return new MaximoExternalSystemEnterpriseService(link);
        });
        this.integrationControls = arrayOrEmpty<any>(input.integrationControls).map(function (control: any): MaximoExternalSystemIntegrationControl {
            return new MaximoExternalSystemIntegrationControl(control);
        });
        const owner = 'External system ' + this.extSysName;
        rejectDuplicates(owner, 'publish channel', this.publishChannels, MaximoExternalSystemPublishChannel._keys);
        rejectDuplicates(owner, 'enterprise service', this.enterpriseServices, MaximoExternalSystemEnterpriseService._keys);
        rejectDuplicates(owner, 'integration control', this.integrationControls, MaximoExternalSystemIntegrationControl._keys);
        this._retain = valueOrDefault(input._retain, this._retain);
    }
}
