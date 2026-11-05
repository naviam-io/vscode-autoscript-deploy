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
var MboConstants = Java.type('psdi.mbo.MboConstants');

/** The Maximo object an enterprise service snapshot is keyed by. */
export const SNAPSHOT_OBJECT = 'MAXIFACEIN';

/** Deletes the existing service and creates it again, with an embedded object structure in between. */
export function process(service: MaximoEnterpriseService): void {
    const maximo: psdi.server.MXServer = MXServer.getMXServer();
    const key = snapshotKey(SNAPSHOT_OBJECT, retainIdentityOf(service));
    let mboSet: psdi.mbo.MboSetRemote | null = null;
    try {
        mboSet = maximo.getMboSet('MAXIFACEIN', maximo.getSystemUserInfo());

        if (service._delete) {
            updateProgress('Deleting enterprise service ' + service.ifaceName);
            deleteEnterpriseService(mboSet, service);
            deleteSnapshot(key);
            updateProgress('Deleted enterprise service ' + service.ifaceName);
        } else {
            updateProgress('Adding/Updating enterprise service ' + service.ifaceName);
            addOrUpdateEnterpriseService(mboSet, service, key);
            deleteSnapshot(key);
            updateProgress('Added/Updated enterprise service ' + service.ifaceName);
        }
    } finally {
        close(mboSet);
    }
}

function retainedSnapshot(mbo: psdi.mbo.MboRemote | null, service: MaximoEnterpriseService, key: string): MaximoEnterpriseService | null {
    let snapshot = readSnapshot(key);
    if (!snapshot && mbo) {
        snapshot = captureExistingState('enterpriseservices', mbo.getUniqueIDValue());
        if (!snapshot) {
            throw Error(
                'Enterprise service ' +
                    service.ifaceName +
                    ' has an existing record whose state could not be captured, so its retained values cannot be preserved.'
            );
        }
        writeSnapshot(key, snapshot);
    }
    return snapshot ? new MaximoEnterpriseService(snapshot) : null;
}

/**
 * Deletes the service, and an embedded object structure marked _delete when the service is deleted. We delete the rules and the gateway properties first
 * as they block deleting the service. Only userdefined services can be deleted, and only if they are not used by an external system.
 */
function deleteEnterpriseService(mboSet: psdi.mbo.MboSetRemote, service: MaximoEnterpriseService): void {
    const mbo = findEnterpriseService(mboSet, service.ifaceName);
    if (mbo) {
        const link = mbo.getMboSet('MAXEXTIFACEIN').moveFirst();
        if (link) {
            throw new Error(
                'Enterprise service ' +
                    service.ifaceName +
                    ' cannot be deleted or recreated while the external system ' +
                    link.getString('EXTSYSNAME') +
                    ' uses it.'
            );
        }
        if (service._delete && !mbo.getBoolean('USERDEFINED')) {
            throw new Error('Enterprise service ' + service.ifaceName + ' is predefined and cannot be deleted.');
        }
        const id = mbo.getUniqueIDValue();
        mbo.getMboSet('MAXIFACEPROC').deleteAll();
        mbo.getMboSet('MAXIFACETYPEPROP').deleteAll();
        mboSet.save();

        mboSet.getMboForUniqueId(id).delete(MboConstants.NOACCESSCHECK);
        mboSet.save();
    }
    if (service.objectStructure && service.objectStructure._delete) {
        deleteIntegrationObject(service, service.objectStructure);
    }
}

function deleteIntegrationObject(service: MaximoEnterpriseService, objectStructure: MaximoIntegrationObject): void {
    if (!service._delete) {
        updateWarning(
            'Enterprise service ' +
                service.ifaceName +
                ': _delete on the object structure ' +
                objectStructure.intObjectName +
                ' is ignored, as the service is not deleted.'
        );
    } else if (isPredefined(objectStructure.intObjectName)) {
        updateWarning(
            'Enterprise service ' + service.ifaceName + ': the object structure ' + objectStructure.intObjectName + ' is predefined and is not deleted.'
        );
    } else {
        processIntegrationObject(objectStructure);
    }
}

function addOrUpdateEnterpriseService(mboSet: psdi.mbo.MboSetRemote, service: MaximoEnterpriseService, key: string): void {
    const existing = findEnterpriseService(mboSet, service.ifaceName);
    const userDefined = existing ? existing.getBoolean('USERDEFINED') : undefined;
    if (hasRetainDeclarations(service)) {
        service = applyRetainedValues(service, retainedSnapshot(existing, service, key));
    }
    deleteEnterpriseService(mboSet, service);
    if (service.objectStructure && !service.objectStructure._delete) {
        if (isPredefined(service.intObjectName!)) {
            updateWarning(
                'Enterprise service ' +
                    service.ifaceName +
                    ': the object structure ' +
                    service.intObjectName +
                    ' is predefined and is not changed, reference it by intObjectName instead of embedding it.'
            );
        } else {
            processIntegrationObject(service.objectStructure);
        }
    }

    const mbo = mboSet.add();
    // USEEXTERNALSCHEMA makes the schema fields after it editable.
    applyValues(mbo, [
        ['IFACENAME', service.ifaceName],
        ['INTOBJECTNAME', service.intObjectName],
        ['DESCRIPTION', service.description],
        ['IFACETYPE', service.ifaceType],
        ['MESSAGETYPE', service.messageType],
        ['IFACECONTROL', service.ifaceControl],
        ['IFACETBNAME', service.ifaceTbName],
        ['USEEXTERNALSCHEMA', service.useExternalSchema],
        ['SPLITTAG', service.splitTag],
        ['SCHEMALOCATION', service.schemaLocation],
        ['ELEMENTNAME', service.elementName],
        ['REPLYSCHEMALOC', service.replySchemaLoc],
        ['REPLYELEMENTNAME', service.replyElementName],
        ['IFACEEXITCLASS', service.ifaceExitClass],
        ['IFACEUSEREXITCLASS', service.ifaceUserExitClass],
        ['IFACEMAPNAME', service.ifaceMapName],
        ['REPLYEXITCLASS', service.replyExitClass],
        ['REPLYUSEREXITCLASS', service.replyUserExitClass],
        ['REPLYMAPNAME', service.replyMapName],
        ['USETXNTRACKING', service.useTxnTracking],
        ['STOREMSG', service.storeMsg],
        ['EXTMSGIDFIELD', service.extMsgIdField],
        ['SEARCHFIELD', service.searchField],
        ['INTERPRETERCLASS', service.interpreterClass],
        ['USERDEFINED', userDefined, MboConstants.NOACCESSCHECK]
    ]);
    service.additionalObjectStructures.forEach(function (detail: MaximoEnterpriseServiceObjectStructure): void {
        applyValues(mbo.getMboSet('MAXIFACEINDETAIL').add(), [
            ['INTOBJECTNAME', detail.intObjectName],
            ['IFACEMAPORDER', detail.ifaceMapOrder],
            ['IFACEEXITCLASS', detail.ifaceExitClass],
            ['IFACEUSEREXITCLASS', detail.ifaceUserExitClass],
            ['IFACEMAPNAME', detail.ifaceMapName],
            ['IFACECONTROL', detail.ifaceControl]
        ]);
    });
    service.gatewayProperties.forEach(function (property: MaximoEnterpriseServiceGatewayProperty): void {
        applyValues(mbo.getMboSet('MAXIFACETYPEPROP').add(), [
            ['PARAM', property.param],
            ['VALUE', property.value],
            ['ISXMLTAG', property.isXmlTag]
        ]);
    });
    addIntegrationControls(mbo, 'MAXIFACEINCNTLDETAIL', service.integrationControls);
    addProcessingRules(mbo, 'ESOBJECTSTRUCTURE', service.processingRules);
    addProcessingRules(mbo, 'ESOBJECT', service.objectProcessingRules);
    mboSet.save();
}

function findEnterpriseService(mboSet: psdi.mbo.MboSetRemote, ifaceName: string): psdi.mbo.MboRemote | null {
    const sqlf = new SqlFormat('ifacename = :1');
    sqlf.setObject(1, 'MAXIFACEIN', 'IFACENAME', ifaceName);
    mboSet.setWhere(sqlf.format());
    return mboSet.moveFirst();
}

export class MaximoEnterpriseServiceObjectStructure {
    static _keys = ['intObjectName'];

    intObjectName: string;
    ifaceMapOrder: number | undefined;
    ifaceExitClass: string | undefined;
    ifaceUserExitClass: string | undefined;
    ifaceMapName: string | undefined;
    ifaceControl: string | undefined;
    _retain: any = [];

    constructor(input: any) {
        requireKeys(MaximoEnterpriseServiceObjectStructure, input, 'enterprise service additional object structure');
        this.intObjectName = input.intObjectName;
        this.ifaceMapOrder = input.ifaceMapOrder;
        this.ifaceExitClass = input.ifaceExitClass;
        this.ifaceUserExitClass = input.ifaceUserExitClass;
        this.ifaceMapName = input.ifaceMapName;
        this.ifaceControl = input.ifaceControl;
        this._retain = valueOrDefault(input._retain, this._retain);
    }
}

export class MaximoEnterpriseServiceGatewayProperty {
    static _keys = ['param'];

    param: string;
    value: string | undefined;
    isXmlTag: boolean | undefined;
    _retain: any = [];

    constructor(input: any) {
        requireKeys(MaximoEnterpriseServiceGatewayProperty, input, 'enterprise service gateway property');
        this.param = input.param;
        this.value = input.value;
        this.isXmlTag = input.isXmlTag;
        this._retain = valueOrDefault(input._retain, this._retain);
    }
}

/** The service is recreated on every deployment, so a value left undefined takes the Maximo default. */
export class MaximoEnterpriseService {
    static _keys = ['ifaceName'];

    _delete = false;
    ifaceName: string;
    description: string | undefined;
    intObjectName: string | undefined;
    objectStructure: MaximoIntegrationObject | undefined;
    ifaceType: string | undefined;
    messageType: string | undefined;
    ifaceControl: string | undefined;
    ifaceTbName: string | undefined;
    useExternalSchema: boolean | undefined;
    splitTag: string | undefined;
    schemaLocation: string | undefined;
    elementName: string | undefined;
    replySchemaLoc: string | undefined;
    replyElementName: string | undefined;
    ifaceExitClass: string | undefined;
    ifaceUserExitClass: string | undefined;
    ifaceMapName: string | undefined;
    replyExitClass: string | undefined;
    replyUserExitClass: string | undefined;
    replyMapName: string | undefined;
    useTxnTracking: boolean | undefined;
    storeMsg: boolean | undefined;
    extMsgIdField: string | undefined;
    searchField: string | undefined;
    interpreterClass: string | undefined;
    additionalObjectStructures: MaximoEnterpriseServiceObjectStructure[] = [];
    gatewayProperties: MaximoEnterpriseServiceGatewayProperty[] = [];
    integrationControls: MaximoIntegrationControl[] = [];
    processingRules: MaximoProcessingRule[] = [];
    objectProcessingRules: MaximoProcessingRule[] = [];
    _retain: any = [];

    constructor(input: any) {
        requireKeys(MaximoEnterpriseService, input, 'enterprise service');
        this._delete = valueOrDefault(input._delete, this._delete);
        this.ifaceName = input.ifaceName;
        this.description = input.description;
        if (input.objectStructure) {
            if (input.intObjectName && input.intObjectName !== input.objectStructure.intObjectName) {
                throw new Error('Enterprise service ' + input.ifaceName + ' intObjectName ' + input.intObjectName + ' does not match its objectStructure.');
            }
            this.objectStructure = new MaximoIntegrationObject(input.objectStructure);
        }
        this.intObjectName = this.objectStructure ? this.objectStructure.intObjectName : input.intObjectName;
        if (!this._delete && !this.intObjectName) {
            throw new Error('Enterprise service ' + input.ifaceName + ' needs an intObjectName or an objectStructure.');
        }
        this.ifaceType = input.ifaceType;
        this.messageType = input.messageType;
        this.ifaceControl = input.ifaceControl;
        this.ifaceTbName = input.ifaceTbName;
        this.useExternalSchema = input.useExternalSchema;
        this.splitTag = input.splitTag;
        this.schemaLocation = input.schemaLocation;
        this.elementName = input.elementName;
        this.replySchemaLoc = input.replySchemaLoc;
        this.replyElementName = input.replyElementName;
        this.ifaceExitClass = input.ifaceExitClass;
        this.ifaceUserExitClass = input.ifaceUserExitClass;
        this.ifaceMapName = input.ifaceMapName;
        this.replyExitClass = input.replyExitClass;
        this.replyUserExitClass = input.replyUserExitClass;
        this.replyMapName = input.replyMapName;
        this.useTxnTracking = input.useTxnTracking;
        this.storeMsg = input.storeMsg;
        this.extMsgIdField = input.extMsgIdField;
        this.searchField = input.searchField;
        this.interpreterClass = input.interpreterClass;
        this.additionalObjectStructures = arrayOrEmpty<any>(input.additionalObjectStructures).map(function (
            detail: any
        ): MaximoEnterpriseServiceObjectStructure {
            return new MaximoEnterpriseServiceObjectStructure(detail);
        });
        this.gatewayProperties = arrayOrEmpty<any>(input.gatewayProperties).map(function (property: any): MaximoEnterpriseServiceGatewayProperty {
            return new MaximoEnterpriseServiceGatewayProperty(property);
        });
        this.integrationControls = arrayOrEmpty<any>(input.integrationControls).map(function (control: any): MaximoIntegrationControl {
            return new MaximoIntegrationControl(control);
        });
        this.processingRules = arrayOrEmpty<any>(input.processingRules).map(function (rule: any): MaximoProcessingRule {
            return new MaximoProcessingRule(rule);
        });
        this.objectProcessingRules = arrayOrEmpty<any>(input.objectProcessingRules).map(function (rule: any): MaximoProcessingRule {
            return new MaximoProcessingRule(rule);
        });
        const owner = 'Enterprise service ' + this.ifaceName;
        rejectDuplicates(owner, 'additional object structure', this.additionalObjectStructures, MaximoEnterpriseServiceObjectStructure._keys);
        rejectDuplicates(owner, 'gateway property', this.gatewayProperties, MaximoEnterpriseServiceGatewayProperty._keys);
        rejectDuplicates(owner, 'integration control', this.integrationControls, MaximoIntegrationControl._keys);
        rejectDuplicates(owner, 'processing rule', this.processingRules, MaximoProcessingRule._keys);
        rejectDuplicates(owner, 'object processing rule', this.objectProcessingRules, MaximoProcessingRule._keys);
        this._retain = valueOrDefault(input._retain, this._retain);
    }
}
