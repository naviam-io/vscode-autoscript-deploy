/// <reference path="../globals.d.ts" />
/// <reference path="../manage-facade.d.ts" />

import { close, setValue, updateProgress, valueOrDefault } from './util';

var MXServer = Java.type('psdi.server.MXServer');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');
var MboConstants = Java.type('psdi.mbo.MboConstants');

export type MaximoCronTaskAccessLevel = 'FULL' | 'MODIFYONLY' | 'READONLY';

export function process(cronTask: MaximoCronTask): void {
    const maximo: psdi.server.MXServer = MXServer.getMXServer();
    let mboSet: psdi.mbo.MboSetRemote | null = null;
    try {
        mboSet = maximo.getMboSet('CRONTASKDEF', maximo.getSystemUserInfo());

        if (cronTask._delete) {
            updateProgress('Deleting cron task ' + cronTask.cronTaskName);
            deleteCronTask(mboSet, cronTask);
            updateProgress('Deleted cron task ' + cronTask.cronTaskName);
        } else {
            updateProgress('Adding/Updating cron task ' + cronTask.cronTaskName);
            addOrUpdateCronTask(mboSet, cronTask);
            updateProgress('Added/Updated cron task ' + cronTask.cronTaskName);
        }
    } finally {
        close(mboSet);
    }
}

function deleteCronTask(mboSet: psdi.mbo.MboSetRemote, cronTask: MaximoCronTask): void {
    const mbo = findCronTask(mboSet, cronTask.cronTaskName);
    if (!mbo) {
        return;
    }

    const cronTaskInstanceSet = mbo.getMboSet('CRONTASKINSTANCE');
    let instance = cronTaskInstanceSet.moveFirst();
    while (instance) {
        setValue(instance, 'ACTIVE', false);
        instance = cronTaskInstanceSet.moveNext();
    }

    cronTaskInstanceSet.deleteAll();
    setValue(mbo, 'ACCESSLEVEL', 'FULL', MboConstants.NOACCESSCHECK);
    mboSet.save();

    setCronTaskWhere(mboSet, cronTask.cronTaskName);
    mboSet.reset();
    mboSet.deleteAll();
    mboSet.save();
}

function addOrUpdateCronTask(mboSet: psdi.mbo.MboSetRemote, cronTask: MaximoCronTask): void {
    const existing = findCronTask(mboSet, cronTask.cronTaskName);
    if (existing) {
        removeExistingCronTaskForReplace(mboSet, existing, cronTask.cronTaskName);
    }

    const mbo = mboSet.add();
    applyCronTaskValues(mbo, cronTask);
    mboSet.save();
}

function findCronTask(mboSet: psdi.mbo.MboSetRemote, cronTaskName: string): psdi.mbo.MboRemote {
    setCronTaskWhere(mboSet, cronTaskName);
    return mboSet.moveFirst();
}

function setCronTaskWhere(mboSet: psdi.mbo.MboSetRemote, cronTaskName: string): void {
    const sqlf = new SqlFormat('crontaskname = :1');
    sqlf.setObject(1, 'CRONTASKDEF', 'CRONTASKNAME', cronTaskName);
    mboSet.setWhere(sqlf.format());
}

function removeExistingCronTaskForReplace(mboSet: psdi.mbo.MboSetRemote, mbo: psdi.mbo.MboRemote, cronTaskName: string): void {
    const cronTaskInstanceSet = mbo.getMboSet('CRONTASKINSTANCE');
    let instance = cronTaskInstanceSet.moveFirst();
    while (instance) {
        if (!instance.isFlagSet(MboConstants.READONLY)) {
            setValue(instance, 'ACTIVE', false);
            instance.delete();
        }
        instance = cronTaskInstanceSet.moveNext();
    }

    setValue(mbo, 'ACCESSLEVEL', 'FULL', MboConstants.NOACCESSCHECK);
    mboSet.save();
    setCronTaskWhere(mboSet, cronTaskName);
    mboSet.reset();
    mboSet.deleteAll();
    mboSet.save();
    mboSet.reset();
}

function applyCronTaskValues(mbo: psdi.mbo.MboRemote, cronTask: MaximoCronTask): void {
    if (mbo.toBeAdded()) {
        setValue(mbo, 'CRONTASKNAME', cronTask.cronTaskName);
        setValue(mbo, 'CLASSNAME', cronTask.className);
        setValue(mbo, 'ACCESSLEVEL', cronTask.accessLevel);
    }

    setValue(mbo, 'DESCRIPTION', cronTask.description);
    applyCronTaskInstances(mbo, cronTask);
}

function applyCronTaskInstances(mbo: psdi.mbo.MboRemote, cronTask: MaximoCronTask): void {
    const cronTaskInstanceSet = mbo.getMboSet('CRONTASKINSTANCE');
    if (cronTaskInstanceSet.isFlagSet(MboConstants.READONLY)) {
        return;
    }

    const readOnlyInstanceNames = deleteWritableCronTaskInstances(cronTaskInstanceSet);

    cronTask.cronTaskInstance.forEach(function (instance: MaximoCronTaskInstance): void {
        if (readOnlyInstanceNames.indexOf(instance.instanceName) !== -1) {
            return;
        }

        const instanceMbo = cronTaskInstanceSet.add();
        setValue(instanceMbo, 'INSTANCENAME', instance.instanceName);
        setValue(instanceMbo, 'DESCRIPTION', instance.description);
        setValue(instanceMbo, 'SCHEDULE', instance.schedule);
        setValue(instanceMbo, 'RUNASUSERID', instance.runAsUserId);
        setValue(instanceMbo, 'KEEPHISTORY', instance.keepHistory);
        setValue(instanceMbo, 'ACTIVE', instance.active);
        setValue(instanceMbo, 'MAXHISTORY', instance.maxHistory);
        applyCronTaskParams(instanceMbo, instance);
    });
}

function deleteWritableCronTaskInstances(mboSet: psdi.mbo.MboSetRemote): string[] {
    const readOnlyInstanceNames: string[] = [];
    let instanceMbo = mboSet.moveFirst();

    while (instanceMbo) {
        if (instanceMbo.isFlagSet(MboConstants.READONLY)) {
            readOnlyInstanceNames.push(instanceMbo.getString('INSTANCENAME'));
        } else {
            setValue(instanceMbo, 'ACTIVE', false);
            instanceMbo.delete();
        }
        instanceMbo = mboSet.moveNext();
    }

    return readOnlyInstanceNames;
}

function applyCronTaskParams(mbo: psdi.mbo.MboRemote, instance: MaximoCronTaskInstance): void {
    const cronTaskParamSet = mbo.getMboSet('PARAMETER');

    instance.cronTaskParam.forEach(function (param: MaximoCronTaskParam): void {
        let paramMbo = cronTaskParamSet.moveFirst();
        while (paramMbo) {
            if (paramMbo.getString('PARAMETER') === param.parameter) {
                setValue(paramMbo, 'VALUE', param.value);
            }
            paramMbo = cronTaskParamSet.moveNext();
        }
    });
}

export interface MaximoCronTaskParamInput {
    parameter: string;
    value?: string | null;
}

export class MaximoCronTaskParam {
    parameter: string;
    value: string | null = '';

    constructor(input: MaximoCronTaskParamInput) {
        this.parameter = input.parameter;
        this.value = valueOrDefault(input.value, this.value);
    }
}

export interface MaximoCronTaskInstanceInput {
    instanceName: string;
    description?: string | null;
    schedule?: string | null;
    active?: boolean | null;
    keepHistory?: boolean | null;
    runAsUserId?: string | null;
    maxHistory?: number | null;
    cronTaskParam?: MaximoCronTaskParamInput[] | null;
}

export class MaximoCronTaskInstance {
    instanceName: string;
    description: string | null = '';
    schedule: string | null = '1h,*,0,*,*,*,*,*,*,*';
    active: boolean | null = false;
    keepHistory: boolean | null = true;
    runAsUserId: string | null = 'MAXADMIN';
    maxHistory: number | null = 1000;
    cronTaskParam: MaximoCronTaskParam[] = [];

    constructor(input: MaximoCronTaskInstanceInput) {
        this.instanceName = input.instanceName;
        this.description = valueOrDefault(input.description, this.description);
        this.schedule = valueOrDefault(input.schedule, this.schedule);
        this.active = valueOrDefault(input.active, this.active);
        this.keepHistory = valueOrDefault(input.keepHistory, this.keepHistory);
        this.runAsUserId = valueOrDefault(input.runAsUserId, this.runAsUserId);
        this.maxHistory = valueOrDefault(input.maxHistory, this.maxHistory);
        this.cronTaskParam = (input.cronTaskParam || []).map((param) => new MaximoCronTaskParam(param));
    }
}

export interface MaximoCronTaskInput {
    _delete?: boolean;
    cronTaskName: string;
    description?: string | null;
    className: string;
    accessLevel?: MaximoCronTaskAccessLevel | null;
    cronTaskInstance?: MaximoCronTaskInstanceInput[] | null;
}

export class MaximoCronTask {
    _delete = false;
    cronTaskName: string;
    description: string | null = '';
    className: string;
    accessLevel: MaximoCronTaskAccessLevel | null = 'FULL';
    cronTaskInstance: MaximoCronTaskInstance[] = [];

    constructor(input: MaximoCronTaskInput) {
        this.cronTaskName = input.cronTaskName;
        this.className = input.className;

        this._delete = valueOrDefault(input._delete, this._delete);
        this.description = valueOrDefault(input.description, this.description);
        this.accessLevel = input.accessLevel || this.accessLevel;
        this.cronTaskInstance = (input.cronTaskInstance || []).map((instance) => new MaximoCronTaskInstance(instance));
    }
}
