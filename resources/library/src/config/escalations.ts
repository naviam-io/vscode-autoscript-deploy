/// <reference path="../../globals.d.ts" />
/// <reference path="../../manage-facade.d.ts" />

import { applyOptionalWritableValues, applyValues, close, requireKeys, setValue, toExternalSynonymValue, updateProgress, valueOrDefault } from '../core/util';
import { applyRetainedValues, hasRetainDeclarations, retainIdentityOf } from '../core/retained-values';
import { deleteSnapshot, readSnapshot, snapshotKey, writeSnapshot } from '../core/snapshot-store';
import { captureExistingState } from '../core/capture';

var MXServer = Java.type('psdi.server.MXServer');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');
var MboConstants = Java.type('psdi.mbo.MboConstants');

/** The Maximo object an escalation snapshot is keyed by. */
export const SNAPSHOT_OBJECT = 'ESCALATION';

export function process(escalation: MaximoEscalation): void {
    const maximo: psdi.server.MXServer = MXServer.getMXServer();
    const key = snapshotKey(SNAPSHOT_OBJECT, retainIdentityOf(escalation));
    let mboSet: psdi.mbo.MboSetRemote | null = null;
    try {
        mboSet = maximo.getMboSet('ESCALATION', maximo.getSystemUserInfo());

        if (escalation._delete) {
            updateProgress('Deleting escalation ' + escalation.escalation);
            deleteEscalation(mboSet, escalation);
            deleteSnapshot(key);
            updateProgress('Deleted escalation ' + escalation.escalation);
        } else {
            updateProgress('Adding/Updating escalation ' + escalation.escalation);
            addOrUpdateEscalation(mboSet, escalation, key);
            deleteSnapshot(key);
            updateProgress('Added/Updated escalation ' + escalation.escalation);
        }
    } finally {
        close(mboSet);
    }
}

function deleteEscalation(mboSet: psdi.mbo.MboSetRemote, escalation: MaximoEscalation): void {
    let mbo = findEscalation(mboSet, escalation.escalation);
    if (!mbo) {
        return;
    }

    mbo = deactivateEscalation(mboSet, mbo, escalation.escalation);
    if (!mbo) {
        return;
    }

    mbo.delete();
    mboSet.save();
}

function addOrUpdateEscalation(mboSet: psdi.mbo.MboSetRemote, escalation: MaximoEscalation, key: string): void {
    let mbo = findEscalation(mboSet, escalation.escalation);

    // Captured before the escalation is deactivated and its escalation points are deleted.
    if (hasRetainDeclarations(escalation)) {
        let snapshot = readSnapshot(key);
        if (!snapshot && mbo) {
            snapshot = captureExistingState('escalations', mbo.getUniqueIDValue());
            if (!snapshot) {
                throw Error(
                    'Escalation ' +
                        escalation.escalation +
                        ' has an existing record whose state could not be captured, so its retained values cannot be preserved.'
                );
            }
            writeSnapshot(key, snapshot);
        }

        escalation = applyRetainedValues(escalation, snapshot ? new MaximoEscalation(snapshot) : null);
    }

    if (!mbo) {
        mbo = mboSet.add();
    } else {
        mbo = deactivateEscalation(mboSet, mbo, escalation.escalation);
        if (!mbo) {
            return;
        }
        mbo = clearEscalationChildren(mboSet, mbo, escalation.escalation);
    }

    applyEscalationValues(mbo, escalation);
    mboSet.save();
    activateEscalation(mboSet, escalation);
}

/**
 * ESCALATION.ACTIVE is read only on the Mbo, so the active flag is applied with NOACCESSCHECK once
 * the escalation itself has been persisted and Maximo has created its cron task instance.
 */
function activateEscalation(mboSet: psdi.mbo.MboSetRemote, escalation: MaximoEscalation): void {
    if (!escalation.active) {
        return;
    }

    const mbo = findEscalation(mboSet, escalation.escalation);
    if (!mbo || mbo.getBoolean('ACTIVE')) {
        return;
    }

    setValue(mbo, 'ACTIVE', true, MboConstants.NOACCESSCHECK);
    mboSet.save();
}

function deactivateEscalation(mboSet: psdi.mbo.MboSetRemote, mbo: psdi.mbo.MboRemote, escalationName: string): psdi.mbo.MboRemote {
    if (!mbo.getBoolean('ACTIVE')) {
        return mbo;
    }

    setValue(mbo, 'ACTIVE', false, MboConstants.NOACCESSCHECK);
    mboSet.save();
    return findEscalation(mboSet, escalationName);
}

function findEscalation(mboSet: psdi.mbo.MboSetRemote, escalationName: string): psdi.mbo.MboRemote {
    const sqlf = new SqlFormat('escalation = :1');
    sqlf.setObject(1, 'ESCALATION', 'ESCALATION', escalationName);
    mboSet.setWhere(sqlf.format());
    mboSet.reset();
    return mboSet.moveFirst();
}

/**
 * The escalation points are deleted and saved before the payload's are added, because Maximo checks
 * a new point's action and notifications against the saved rows.
 */
function clearEscalationChildren(mboSet: psdi.mbo.MboSetRemote, mbo: psdi.mbo.MboRemote, escalationName: string): psdi.mbo.MboRemote {
    mbo.getMboSet('ESCREFPOINT').deleteAll();
    mboSet.save();
    return findEscalation(mboSet, escalationName);
}

function applyEscalationValues(mbo: psdi.mbo.MboRemote, escalation: MaximoEscalation): void {
    if (mbo.toBeAdded()) {
        setValue(mbo, 'ESCALATION', escalation.escalation);
    }

    applyValues(mbo, [
        ['DESCRIPTION', escalation.description],
        ['OBJECTNAME', escalation.objectName],
        ['CONDITION', escalation.condition],
        ['SCHEDULE', escalation.schedule],
        ['CRONTASKNAME', escalation.cronTaskName],
        ['INSTANCENAME', escalation.instanceName],
        ['ESCSTATUSFLAG', escalation.escStatusFlag]
    ]);

    // Calendar, SLA and ownership fields are read only unless the escalation configuration makes
    // them applicable, so they are only applied when supplied and writable.
    applyOptionalWritableValues(mbo, [
        ['ESCCALENDAR', escalation.escCalendar],
        ['ESCSHIFT', escalation.escShift],
        ['ESCCALORGID', escalation.escCalOrgId],
        ['SLANUM', escalation.slaNum],
        ['LANGCODE', escalation.langCode],
        ['ORGID', escalation.orgId],
        ['SITEID', escalation.siteId]
    ]);

    applyEscalationRefPoints(mbo, escalation.escRefPoint);
}

function applyEscalationRefPoints(mbo: psdi.mbo.MboRemote, refPoints: MaximoEscalationRefPoint[]): void {
    const escRefPointSet = mbo.getMboSet('ESCREFPOINT');

    refPoints.forEach(function (refPoint: MaximoEscalationRefPoint): void {
        const escRefPoint = escRefPointSet.add();
        // REFPOINTNUM is read only once added, and Maximo numbers past the deleted points, so the
        // payload number is forced to keep escalation points identifiable across deployments.
        if (refPoint.refPointNum !== null && typeof refPoint.refPointNum !== 'undefined') {
            setValue(escRefPoint, 'REFPOINTNUM', refPoint.refPointNum, MboConstants.NOACCESSCHECK);
        }
        setValue(escRefPoint, 'EVENTATTRIBUTE', refPoint.eventAttribute);
        setValue(escRefPoint, 'ELAPSEDINTERVAL', refPoint.elapsedInterval);
        setValue(escRefPoint, 'INTERVALUOM', toExternalSynonymValue('ESCTIMEINTERVAL', refPoint.intervalUom, escRefPoint));
        setValue(escRefPoint, 'REPEAT', refPoint.repeat);
        setValue(escRefPoint, 'EVENTCONDITION', refPoint.eventCondition);
        setValue(escRefPoint, 'ACTION', refPoint.action);
        applyOptionalWritableValues(escRefPoint, [
            ['CALCORGID', refPoint.calcOrgId],
            ['CALCCALENDAR', refPoint.calcCalendar],
            ['CALCSHIFT', refPoint.calcShift]
        ]);
        applyEscalationNotifications(escRefPoint, refPoint.escNotification);
    });
}

function applyEscalationNotifications(mbo: psdi.mbo.MboRemote, notifications: MaximoEscalationNotification[]): void {
    const escNotificationSet = mbo.getMboSet('ESCNOTIFICATION');

    notifications.forEach(function (notification: MaximoEscalationNotification): void {
        const escNotification = escNotificationSet.add();
        setValue(escNotification, 'TEMPLATEID', notification.templateId);
    });
}

export interface MaximoEscalationNotificationInput {
    templateId: string;
}

export class MaximoEscalationNotification {
    static _keys = ['templateId'];

    templateId: string;

    constructor(input: MaximoEscalationNotificationInput) {
        this.templateId = input.templateId;
    }
}

export interface MaximoEscalationRefPointInput {
    refPointNum: number;
    eventAttribute?: string | null;
    elapsedInterval?: number | null;
    intervalUom?: string | null;
    repeat?: boolean | null;
    eventCondition?: string | null;
    calcCalendar?: string | null;
    calcShift?: string | null;
    calcOrgId?: string | null;
    action?: string | null;
    escNotification?: MaximoEscalationNotificationInput[] | null;
    _retain?: any;
}

export class MaximoEscalationRefPoint {
    static _keys = ['refPointNum'];

    refPointNum: number;
    eventAttribute?: string | null;
    elapsedInterval?: number | null;
    intervalUom?: string | null;
    repeat: boolean | null = false;
    eventCondition?: string | null;
    calcCalendar?: string | null;
    calcShift?: string | null;
    calcOrgId?: string | null;
    action?: string | null;
    escNotification: MaximoEscalationNotification[] = [];
    _retain: any = [];

    constructor(input: MaximoEscalationRefPointInput) {
        this.refPointNum = input.refPointNum;
        this.eventAttribute = input.eventAttribute;
        this.elapsedInterval = input.elapsedInterval;
        this.intervalUom = input.intervalUom;
        this.repeat = valueOrDefault(input.repeat, this.repeat);
        this.eventCondition = input.eventCondition;
        this.calcCalendar = input.calcCalendar;
        this.calcShift = input.calcShift;
        this.calcOrgId = input.calcOrgId;
        this.action = input.action;
        this.escNotification = (input.escNotification || []).map((notification) => new MaximoEscalationNotification(notification));
        this._retain = valueOrDefault(input._retain, this._retain);
    }
}

export interface MaximoEscalationInput {
    _delete?: boolean;
    escalation: string;
    description?: string | null;
    objectName?: string | null;
    condition?: string | null;
    active?: boolean | null;
    schedule?: string | null;
    cronTaskName?: string | null;
    instanceName?: string | null;
    escStatusFlag?: boolean | null;
    escCalendar?: string | null;
    escShift?: string | null;
    escCalOrgId?: string | null;
    slaNum?: string | null;
    langCode?: string | null;
    orgId?: string | null;
    siteId?: string | null;
    escRefPoint?: MaximoEscalationRefPointInput[] | null;
    _retain?: any;
}

export class MaximoEscalation {
    static _keys = ['escalation'];

    _delete = false;
    escalation: string;
    description: string | null = '';
    objectName: string | null = '';
    condition: string | null = '';
    active: boolean | null = false;
    schedule: string | null = '1h,*,0,*,*,*,*,*,*,*';
    cronTaskName: string | null = 'ESCALATION';
    instanceName: string | null = '';
    escStatusFlag: boolean | null = false;
    escCalendar: string | null = null;
    escShift: string | null = null;
    escCalOrgId: string | null = null;
    slaNum: string | null = null;
    langCode: string | null = null;
    orgId: string | null = null;
    siteId: string | null = null;
    escRefPoint: MaximoEscalationRefPoint[] = [];
    _retain: any = [];

    constructor(input: MaximoEscalationInput) {
        requireKeys(MaximoEscalation, input, 'escalation');
        this.escalation = input.escalation;

        this._delete = valueOrDefault(input._delete, this._delete);
        this.description = valueOrDefault(input.description, this.description);
        this.objectName = valueOrDefault(input.objectName, this.objectName);
        this.condition = valueOrDefault(input.condition, this.condition);
        this.active = valueOrDefault(input.active, this.active);
        this.schedule = valueOrDefault(input.schedule, this.schedule);
        this.cronTaskName = valueOrDefault(input.cronTaskName, this.cronTaskName);
        this.instanceName = valueOrDefault(input.instanceName, this.instanceName);
        this.escStatusFlag = valueOrDefault(input.escStatusFlag, this.escStatusFlag);
        this.escCalendar = valueOrDefault(input.escCalendar, this.escCalendar);
        this.escShift = valueOrDefault(input.escShift, this.escShift);
        this.escCalOrgId = valueOrDefault(input.escCalOrgId, this.escCalOrgId);
        this.slaNum = valueOrDefault(input.slaNum, this.slaNum);
        this.langCode = valueOrDefault(input.langCode, this.langCode);
        this.orgId = valueOrDefault(input.orgId, this.orgId);
        this.siteId = valueOrDefault(input.siteId, this.siteId);
        this.escRefPoint = (input.escRefPoint || []).map((refPoint) => new MaximoEscalationRefPoint(refPoint));
        this._retain = valueOrDefault(input._retain, this._retain);
    }
}
