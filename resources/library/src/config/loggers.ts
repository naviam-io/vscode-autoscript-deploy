/// <reference path="../../globals.d.ts" />
/// <reference path="../../manage-facade.d.ts" />

import { applyValues, close, requireKeys, setValue, updateProgress, valueOrDefault } from '../core/util';
import { applyRetainedValues, hasRetainDeclarations, retainIdentityOf } from '../core/retained-values';
import { deleteSnapshot, readSnapshot, snapshotKey, writeSnapshot } from '../core/snapshot-store';
import { captureExistingState } from '../core/capture';

var MXServer = Java.type('psdi.server.MXServer');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');

export type MaximoLogLevel = 'DEBUG' | 'ERROR' | 'FATAL' | 'INFO' | 'WARN';

/** The Maximo object a logger snapshot is keyed by. */
export const SNAPSHOT_OBJECT = 'MAXLOGGER';

export function process(logger: MaximoLogger): void {
    const maximo: psdi.server.MXServer = MXServer.getMXServer();
    const key = snapshotKey(SNAPSHOT_OBJECT, retainIdentityOf(logger));
    let mboSet: psdi.mbo.MboSetRemote | null = null;
    try {
        mboSet = maximo.getMboSet('MAXLOGGER', maximo.getSystemUserInfo());

        if (logger._delete) {
            updateProgress('Deleting logger ' + logger.logger);
            deleteLogger(mboSet, logger);
            deleteSnapshot(key);
            updateProgress('Deleted logger ' + logger.logger);
        } else {
            updateProgress('Adding/Updating logger ' + logger.logger);
            applyLogger(mboSet, logger, key);
            deleteSnapshot(key);
            updateProgress('Added/Updated logger ' + logger.logger);
        }
    } finally {
        close(mboSet);
    }
}

function applyLogger(mboSet: psdi.mbo.MboSetRemote, logger: MaximoLogger, key: string): void {
    const maxLogger = logger.parentLogKey ? findOrAddChildLogger(mboSet, logger) : findOrAddRootLogger(mboSet, logger);

    if (hasRetainDeclarations(logger)) {
        let snapshot = readSnapshot(key);
        if (!snapshot && !maxLogger.toBeAdded()) {
            snapshot = captureExistingState('loggers', maxLogger.getUniqueIDValue());
            if (!snapshot) {
                throw Error(
                    'Logger ' + logger.logger + ' has an existing record whose state could not be captured, so its retained values cannot be preserved.'
                );
            }
            writeSnapshot(key, snapshot);
        }

        logger = applyRetainedValues(logger, snapshot ? new MaximoLogger(snapshot) : null);
    }

    applyLoggerValues(maxLogger, logger);
    mboSet.save();
    applyLoggingSettings();
}

function deleteLogger(mboSet: psdi.mbo.MboSetRemote, logger: MaximoLogger): void {
    let mbo: psdi.mbo.MboRemote | null;
    if (logger.parentLogKey) {
        const parent = findLoggerByLogKey(mboSet, logger.parentLogKey);
        mbo = parent ? findChildLogger(parent.getMboSet('CHILDLOGGERS'), logger.logger) : null;
    } else {
        mbo = findRootLogger(mboSet, logger);
    }

    if (mbo) {
        deactivateAndDelete(mbo);
        mboSet.save();
    }
}

/**
 * LOGGER is unique only among one parent's children, and Maximo accepts two roots with one name, so a
 * payload's logKey decides on its own. Without one the name does, provided only one logger has it.
 */
function findRootLogger(mboSet: psdi.mbo.MboSetRemote, logger: MaximoLogger): psdi.mbo.MboRemote | null {
    if (logger.logKey) {
        return findLoggerByLogKey(mboSet, logger.logKey);
    }

    const sqlf = new SqlFormat('logger = :1');
    sqlf.setObject(1, 'MAXLOGGER', 'LOGGER', logger.logger);
    mboSet.setWhere(sqlf.format());
    mboSet.reset();

    const logKeys: string[] = [];
    let mbo = mboSet.moveFirst();
    while (mbo) {
        logKeys.push(mbo.getString('LOGKEY'));
        mbo = mboSet.moveNext();
    }

    if (logKeys.length > 1) {
        throw new Error('More than one logger is named ' + logger.logger + ' (' + logKeys.join(', ') + '). Set logKey or parentLogKey to choose one.');
    }

    return logKeys.length === 1 ? mboSet.moveFirst() : null;
}

function findOrAddRootLogger(mboSet: psdi.mbo.MboSetRemote, logger: MaximoLogger): psdi.mbo.MboRemote {
    const existingLogger = findRootLogger(mboSet, logger);
    if (existingLogger) {
        return existingLogger;
    }

    const maxLogger = mboSet.add();
    maxLogger.setValue('LOGGER', logger.logger);
    maxLogger.setValue('LOGKEY', logger.logKey || 'log4j.logger.maximo.' + logger.logger);

    return maxLogger;
}

function findOrAddChildLogger(mboSet: psdi.mbo.MboSetRemote, logger: MaximoLogger): psdi.mbo.MboRemote {
    const parent = findLoggerByLogKey(mboSet, logger.parentLogKey as string);
    if (!parent) {
        throw new Error(
            'The parent logger key value ' + logger.parentLogKey + ' does not exist in the target system, cannot add child logger ' + logger.logger
        );
    }

    const children = parent.getMboSet('CHILDLOGGERS');
    const existingChild = findChildLogger(children, logger.logger);
    let maxLogger;
    if (!existingChild) {
        // The LOGKEY for child loggers is automatically generated by the system, so we should not need to set it here.
        maxLogger = children.add();
        maxLogger.setValue('LOGGER', logger.logger);
    } else {
        maxLogger = existingChild;
    }

    return maxLogger;
}

function findLoggerByLogKey(mboSet: psdi.mbo.MboSetRemote, logKey: string): psdi.mbo.MboRemote {
    const sqlf = new SqlFormat('logkey = :1');
    sqlf.setObject(1, 'MAXLOGGER', 'LOGKEY', logKey);
    mboSet.setWhere(sqlf.format());
    mboSet.reset();
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
    parent?: string | null;
    _retain?: any;
}

export class MaximoLogger {
    /** LOGKEY is the only unique key, but a payload may omit it, so the snapshot is named after what the payload identifies the logger by. */
    static _keys = ['logger', 'parentLogKey', 'logKey'];

    _delete = false;
    logger: string;
    parentLogKey?: string | null = null;
    logKey?: string | null = null;
    logLevel: MaximoLogLevel | null = 'ERROR';
    active: boolean | null = true;
    appenders: string | null = '';
    parent?: string | null = null;
    _retain: any = [];

    constructor(input: MaximoLoggerInput) {
        // parentLogKey and logKey are optional, so the payload is only required to name the logger.
        requireKeys({ _keys: ['logger'] }, input, 'logger');
        this.logger = input.logger;

        this._delete = valueOrDefault(input._delete, this._delete);
        this.parent = valueOrDefault(input.parent, this.parent);
        this.parentLogKey = input.parentLogKey || (this.parent ? 'log4j.logger.maximo.' + this.parent : this.parentLogKey);
        this.logKey = input.logKey || this.logKey;
        this.logLevel = valueOrDefault(input.logLevel, this.logLevel);
        this.active = valueOrDefault(input.active, this.active);
        this.appenders = valueOrDefault(input.appenders, this.appenders);
        if (this.parentLogKey && this.logKey && this.logKey.indexOf(this.parentLogKey) !== 0) {
            this.logKey = this.parentLogKey + '.' + this.logger;
        }
        this._retain = valueOrDefault(input._retain, this._retain);
    }
}
