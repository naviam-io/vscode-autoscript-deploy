/// <reference path="../globals.d.ts" />
/// <reference path="../manage-facade.d.ts" />

import { applyValues, close, setValue, updateProgress, valueOrDefault } from './util';

var MXServer = Java.type('psdi.server.MXServer');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');

export type MaximoLogLevel = 'DEBUG' | 'ERROR' | 'FATAL' | 'INFO' | 'WARN';

export function process(logger: MaximoLogger): void {
    const maximo: psdi.server.MXServer = MXServer.getMXServer();
    let mboSet: psdi.mbo.MboSetRemote | null = null;
    try {
        mboSet = maximo.getMboSet('MAXLOGGER', maximo.getSystemUserInfo());

        if (logger._delete) {
            updateProgress('Deleting logger ' + logger.logger);
            deleteLogger(mboSet, logger);
            updateProgress('Deleted logger ' + logger.logger);
        } else {
            updateProgress('Adding/Updating logger ' + logger.logger);
            applyLogger(mboSet, logger);
            updateProgress('Added/Updated logger ' + logger.logger);
        }
    } finally {
        close(mboSet);
    }
}

function applyLogger(mboSet: psdi.mbo.MboSetRemote, logger: MaximoLogger): void {
    const maxLogger = logger.parentLogKey ? addChildLogger(mboSet, logger) : addRootLogger(mboSet, logger);

    applyLoggerValues(maxLogger, logger);
    mboSet.save();
    applyLoggingSettings();
}

function deleteLogger(mboSet: psdi.mbo.MboSetRemote, logger: MaximoLogger): void {
    const mbo = findLoggerByName(mboSet, logger.logger);
    if (mbo) {
        deactivateAndDelete(mbo);
        mboSet.save();
    }
}

function addRootLogger(mboSet: psdi.mbo.MboSetRemote, logger: MaximoLogger): psdi.mbo.MboRemote {
    const existingLogger = findLoggerByName(mboSet, logger.logger);
    if (existingLogger) {
        deactivateAndDelete(existingLogger);
    }

    const maxLogger = mboSet.add();
    maxLogger.setValue('LOGGER', logger.logger);
    setValue(maxLogger, 'LOGKEY', logger.logKey);
    return maxLogger;
}

function addChildLogger(mboSet: psdi.mbo.MboSetRemote, logger: MaximoLogger): psdi.mbo.MboRemote {
    const parent = findLoggerByLogKey(mboSet, logger.parentLogKey);
    if (!parent) {
        throw new Error('The parent logger key value ' + logger.parentLogKey + ' does not exist in the target system, cannot add child logger ' + logger.logger);
    }

    const children = parent.getMboSet('CHILDLOGGERS');
    const existingChild = findChildLogger(children, logger.logger);
    if (existingChild) {
        deactivateAndDelete(existingChild);
    }

    const maxLogger = children.add();
    maxLogger.setValue('LOGGER', logger.logger);
    return maxLogger;
}

function findLoggerByName(mboSet: psdi.mbo.MboSetRemote, loggerName: string): psdi.mbo.MboRemote {
    const sqlf = new SqlFormat('logger = :1');
    sqlf.setObject(1, 'MAXLOGGER', 'LOGGER', loggerName);
    mboSet.setWhere(sqlf.format());
    return mboSet.moveFirst();
}

function findLoggerByLogKey(mboSet: psdi.mbo.MboSetRemote, logKey: string): psdi.mbo.MboRemote {
    const sqlf = new SqlFormat('logkey = :1');
    sqlf.setObject(1, 'MAXLOGGER', 'LOGKEY', logKey);
    mboSet.setWhere(sqlf.format());
    return mboSet.moveFirst();
}

function findChildLogger(mboSet: psdi.mbo.MboSetRemote, loggerName: string): psdi.mbo.MboRemote {
    let mbo = mboSet.moveFirst();

    while (mbo) {
        if (mbo.getString('LOGGER').toLowerCase() === loggerName.toLowerCase()) {
            return mbo;
        }
        mbo = mboSet.moveNext();
    }

    return null;
}

function deactivateAndDelete(mbo: psdi.mbo.MboRemote): void {
    mbo.setValue('ACTIVE', false);
    mbo.delete();
}

function applyLoggerValues(mbo: psdi.mbo.MboRemote, logger: MaximoLogger): void {
    applyValues(mbo, [
        ['LOGLEVEL', logger.logLevel],
        ['ACTIVE', logger.active],
        ['APPENDERS', logger.appenders]
    ]);
}

function applyLoggingSettings(): void {
    const loggingService = MXServer.getMXServer().lookup('LOGGING') as psdi.util.logging.LoggingServiceRemote;
    loggingService.applySettings(false);
}

export interface MaximoLoggerInput {
    _delete?: boolean;
    logger: string;
    parentLogKey?: string | null;
    logKey?: string | null;
    logLevel?: MaximoLogLevel | null;
    active?: boolean | null;
    appenders?: string | null;
}

export class MaximoLogger {
    _delete = false;
    logger: string;
    parentLogKey: string | null = '';
    logKey: string | null;
    logLevel: MaximoLogLevel | null = 'ERROR';
    active: boolean | null = false;
    appenders: string | null = '';

    constructor(input: MaximoLoggerInput) {
        this.logger = input.logger;

        this._delete = valueOrDefault(input._delete, this._delete);
        this.parentLogKey = valueOrDefault(input.parentLogKey, this.parentLogKey);
        this.logKey = valueOrDefault(input.logKey, (this.parentLogKey ? this.parentLogKey + '.' : 'log4j.logger.maximo.') + input.logger);
        this.logLevel = valueOrDefault(input.logLevel, this.logLevel);
        this.active = valueOrDefault(input.active, this.active);
        this.appenders = valueOrDefault(input.appenders, this.appenders);

        if (this.parentLogKey && this.logKey && this.logKey.indexOf(this.parentLogKey) !== 0) {
            this.logKey = this.parentLogKey + '.' + this.logger;
        }
    }
}
