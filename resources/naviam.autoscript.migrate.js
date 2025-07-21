/* eslint-disable no-undef */
// @ts-nocheck
var MXServer = Java.type('psdi.server.MXServer');

var DBShortcut = Java.type('psdi.mbo.DBShortcut');
var MboSet = Java.type('psdi.mbo.MboSet');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');

main();

function main() {
    removeSharptreeScripts();
    removeSharptreeLogging();
    migrateApplicationAuthorization();
    removeObjectStructure();
}

function removeObjectStructure() {
    var maxIntObjectSet = MXServer.getMXServer().getMboSet(
        'MAXINTOBJECT',
        userInfo
    );

    try {
        var sqlf = new SqlFormat('intobjectname = :1');
        sqlf.setObject(1, 'MAXINTOBJECT', 'INTOBJECTNAME', 'SHARPTREE_UTILS');
        maxIntObjectSet.setWhere(sqlf.format());
        maxIntObjectSet.reset();

        if (!maxIntObjectSet.isEmpty()) {
            var intObject = maxIntObjectSet.getMbo(0);
            intObject.delete();
            maxIntObjectSet.save();
            service.log_info('Removed MAXINTOBJECT: SHARPTREE_UTILS');
        } else {
            service.log_info(
                'MAXINTOBJECT SHARPTREE_UTILS not found, skipping removal.'
            );
        }
    } finally {
        _close(maxIntObjectSet);
    }
}

function migrateApplicationAuthorization() {
    var dbShortcut = new DBShortcut();
    var connectionKey = userInfo.getConnectionKey();

    try {
        dbShortcut.connect(connectionKey);

        // create a new SqlFormat object to migrate the application authorization
        // from SHARPTREE_UTILS to NAVIAM_UTILS
        var sqlf = new SqlFormat(
            'update applicationauth set app = :1 where app = :2 and not exists (select 1 from applicationauth where app = :3)'
        );
        sqlf.setObject(1, 'APPLICATIONAUTH', 'APP', 'NAVIAM_UTILS');
        sqlf.setObject(2, 'APPLICATIONAUTH', 'APP', 'SHARPTREE_UTILS');
        sqlf.setObject(3, 'APPLICATIONAUTH', 'APP', 'NAVIAM_UTILS');

        dbShortcut.execute(sqlf);
        dbShortcut.commit();
    } finally {
        dbShortcut.close();
    }
}

function removeSharptreeLogging() {
    var maxLoggerSet = MXServer.getMXServer().getMboSet('MAXLOGGER', userInfo);
    try {
        var sqlf = new SqlFormat('logger = :1');
        sqlf.setObject(1, 'MAXLOGGER', 'LOGGER', 'SHARPTREE.AUTOSCRIPT');
        maxLoggerSet.setWhere(sqlf.format());
        var maxLogger = maxLoggerSet.moveFirst();
        if (maxLogger) {
            maxLogger.setValue('ACTIVE', false);
            maxLogger.delete();
            maxLoggerSet.save();
            service.log_info('Removed MAXLOGGER: SHARPTREE.AUTOSCRIPT');
        } else {
            service.log_info(
                'MAXLOGGER SHARPTREE.AUTOSCRIPT not found, skipping removal.'
            );
        }
        // Apply the logging settings.
        MXServer.getMXServer().lookup('LOGGING').applySettings(true);
    } finally {
        _close(maxLoggerSet);
    }
}

function removeSharptreeScripts() {
    var scripts = [
        'SHARPTREE.AUTOSCRIPT.ADMIN',
        'SHARPTREE.AUTOSCRIPT.DEPLOY',
        'SHARPTREE.AUTOSCRIPT.EXTRACT',
        'SHARPTREE.AUTOSCRIPT.FORM',
        'SHARPTREE.AUTOSCRIPT.LIBRARY',
        'SHARPTREE.AUTOSCRIPT.LOGGING',
        'SHARPTREE.AUTOSCRIPT.REPORT',
        'SHARPTREE.AUTOSCRIPT.SCREENS',
        'SHARPTREE.AUTOSCRIPT.STORE',
    ];

    scripts.forEach(function (scriptName) {
        var scriptSet = MXServer.getMXServer().getMboSet(
            'AUTOSCRIPT',
            MXServer.getMXServer().getSystemUserInfo()
        );

        try {
            var sqlf = new SqlFormat('autoscript = :1');
            sqlf.setObject(1, 'AUTOSCRIPT', 'AUTOSCRIPT', scriptName);
            scriptSet.setWhere(sqlf.format());
            scriptSet.reset();

            if (!scriptSet.isEmpty()) {
                var script = scriptSet.getMbo(0);
                script.delete();
                scriptSet.save();
                service.log_info('Removed script: ' + scriptName);
            } else {
                service.log_info('Script not found: ' + scriptName);
            }
        } finally {
            _close(scriptSet);
        }
    });
}

function _close(mboSet) {
    if (mboSet && mboSet instanceof MboSet) {
        try {
            mboSet.close();
            mboSet.cleanup();
        } catch (e) {
            service.log_error('Error closing MboSet: ' + e.message);
        }
    }
}

// eslint-disable-next-line no-unused-vars
var scriptConfig = {
    autoscript: 'NAVIAM.AUTOSCRIPT.MIGRATE',
    description: 'Naviam to script to migrate to Naviam Developer Tools',
    version: '1.0.0',
    active: true,
    logLevel: 'INFO',
};
