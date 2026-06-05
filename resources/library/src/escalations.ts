/// <reference path="../globals.d.ts" />
/// <reference path="../manage-facade.d.ts" />

import { applyValues, close, setValue, updateProgress, valueOrDefault } from './util';

var MXServer = Java.type('psdi.server.MXServer');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');

export function process(escalation: MaximoEscalation): void {
    const maximo: psdi.server.MXServer = MXServer.getMXServer();
    let mboSet: psdi.mbo.MboSetRemote | null = null;
    try {
        mboSet = maximo.getMboSet('ESCALATION', maximo.getSystemUserInfo());

        if (escalation._delete) {
            updateProgress('Deleting escalation ' + escalation.escalation);
            deleteEscalation(mboSet, escalation);
            updateProgress('Deleted escalation ' + escalation.escalation);
        } else {
            updateProgress('Adding/Updating escalation ' + escalation.escalation);
            addOrUpdateEscalation(mboSet, escalation);
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

function addOrUpdateEscalation(mboSet: psdi.mbo.MboSetRemote, escalation: MaximoEscalation): void {
    let mbo = findEscalation(mboSet, escalation.escalation);
    if (!mbo) {
        mbo = mboSet.add();
    } else {
        mbo = deactivateEscalation(mboSet, mbo, escalation.escalation);
        if (!mbo) {
            return;
        }
        clearEscalationChildren(mbo);
    }

    applyEscalationValues(mbo, escalation);
    mboSet.save();
}

function deactivateEscalation(mboSet: psdi.mbo.MboSetRemote, mbo: psdi.mbo.MboRemote, escalationName: string): psdi.mbo.MboRemote {
    if (!mbo.getBoolean('ACTIVE')) {
        return mbo;
    }

    setValue(mbo, 'ACTIVE', false);
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

function clearEscalationChildren(mbo: psdi.mbo.MboRemote): void {
    mbo.getMboSet('ESCREFPOINT').deleteAll();
}

function applyEscalationValues(mbo: psdi.mbo.MboRemote, escalation: MaximoEscalation): void {
    if (mbo.toBeAdded()) {
        setValue(mbo, 'ESCALATION', escalation.escalation);
    }

    applyValues(mbo, [
        ['DESCRIPTION', escalation.description],
        ['OBJECTNAME', escalation.objectName],
        ['CONDITION', escalation.condition],
        ['ACTIVE', escalation.active],
        ['SCHEDULE', escalation.schedule],
        ['CRONTASKNAME', escalation.cronTaskName],
        ['INSTANCENAME', escalation.instanceName],
        ['ESCSTATUSFLAG', escalation.escStatusFlag],
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
        setValue(escRefPoint, 'REFPOINTNUM', refPoint.refPointNum);
        setValue(escRefPoint, 'EVENTATTRIBUTE', refPoint.eventAttribute);
        setValue(escRefPoint, 'ELAPSEDINTERVAL', refPoint.elapsedInterval);
        setValue(escRefPoint, 'INTERVALUOM', refPoint.intervalUom);
        setValue(escRefPoint, 'REPEAT', refPoint.repeat);
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
    escNotification?: MaximoEscalationNotificationInput[] | null;
}

export class MaximoEscalationRefPoint {
    refPointNum: number;
    eventAttribute: string | null = '';
    elapsedInterval: number | null = null;
    intervalUom: string | null = '';
    repeat: boolean | null = false;
    escNotification: MaximoEscalationNotification[] = [];

    constructor(input: MaximoEscalationRefPointInput) {
        this.refPointNum = input.refPointNum;
        this.eventAttribute = valueOrDefault(input.eventAttribute, this.eventAttribute);
        this.elapsedInterval = valueOrDefault(input.elapsedInterval, this.elapsedInterval);
        this.intervalUom = valueOrDefault(input.intervalUom, this.intervalUom);
        this.repeat = valueOrDefault(input.repeat, this.repeat);
        this.escNotification = (input.escNotification || []).map((notification) => new MaximoEscalationNotification(notification));
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
}

export class MaximoEscalation {
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
    escCalendar: string | null = '';
    escShift: string | null = '';
    escCalOrgId: string | null = '';
    slaNum: string | null = '';
    langCode: string | null = '';
    orgId: string | null = '';
    siteId: string | null = '';
    escRefPoint: MaximoEscalationRefPoint[] = [];

    constructor(input: MaximoEscalationInput) {
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
    }
}
