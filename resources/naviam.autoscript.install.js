/* eslint-disable no-undef */
/* eslint-disable no-unused-vars */
// @ts-nocheck
/*
 *   Bootstrap script that is used to install the Naviam Developer Tools.
 */
var RuntimeException = Java.type('java.lang.RuntimeException');

var DBShortcut = Java.type('psdi.mbo.DBShortcut');
var MboConstants = Java.type('psdi.mbo.MboConstants');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');

var MXServer = Java.type('psdi.server.MXServer');

var MXException = Java.type('psdi.util.MXException');
var MXSession = Java.type('psdi.util.MXSession');

main();

function main() {
    try {
        // Before doing anything else, make sure we have a valid installation user that is part of the administrator group.
        if (!isInAdminGroup()) {
            // The installation user must be in the admin group.
            throw new ScriptError(
                'not_admin',
                'The user ' + userInfo.getUserName() + ' is not in the Maximo Administrators group and cannot perform the install.'
            );
        }
        // Set up the Maximo loggers that will be used by the Naviam Developer Tools.
        setupLoggers();

        setupProperties();

        verifyIntegrationObjectSecurity();

        setupSigOptions();

        var success = {
            status: 'success'
        };

        responseBody = JSON.stringify(response);
        return;
    } catch (error) {
        var response = {};
        response.status = 'error';

        if (error instanceof ScriptError) {
            response.message = error.message;
            response.reason = error.reason;
        } else if (error instanceof Error) {
            response.message = error.message;
        } else if (error instanceof MXException) {
            response.reason = error.getErrorGroup() + '_' + error.getErrorKey();
            response.message = error.getMessage();
        } else if (error instanceof RuntimeException) {
            if (error.getCause() instanceof MXException) {
                response.reason = error.getCause().getErrorGroup() + '_' + error.getCause().getErrorKey();
                response.message = error.getCause().getMessage();
            } else {
                response.reason = 'runtime_exception';
                response.message = error.getMessage();
            }
        } else {
            response.cause = error;
        }

        responseBody = JSON.stringify(response);
        return;
    }
}

function fixInspectionForms() {
    // Because Maximo demo data is poor, inspection forms are shipped with missing YORN values that need to be fixed.
    var db = new DBShortcut();
    try {
        db.connect(userInfo.getConnectionKey());
        db.execute(DBShortcut.UPDATE, 'update inspectionform set readconfirmation = 0 where readconfirmation is null');
        db.execute(DBShortcut.UPDATE, 'update inspectionform set audioguided = 0 where audioguided is null');
        db.commit();
    } finally {
        db.close();
    }
}

function setupProperties() {
    addOrUpdateProperty('naviam.autoscript.debug.port', 'Naviam Automation Script Debug Port', '4711', 'INTEGER', 'PUBLIC');
    addOrUpdateProperty('naviam.autoscript.debug.host', 'Naviam Automation Script Debug Host', '0.0.0.0', 'ALN', 'PUBLIC');
    addOrUpdateProperty('naviam.autoscript.debug.js.exclude', 'JavaScript/Nashorn scripts excluded from debugging', '', 'ALN', 'PUBLIC');
    addOrUpdateProperty('naviam.autoscript.debug.enabled', 'Naviam Automation Script Debug Enabled or Disabled', 'true', 'YORN', 'PUBLIC');
    addOrUpdateProperty('naviam.autoscript.debug.client.idleTimeout', 'Idle period in milliseconds before the debugger disconnects', '0', 'INTEGER', 'PUBLIC');
    addOrUpdateProperty('naviam.autoscript.debug.client.livenessPoll', 'Liveness poll period in milliseconds', '1000', 'INTEGER', 'PUBLIC');
    MXServer.getMXServer().reloadMaximoCache('MAXPROP', 'naviam.autoscript.debug.port', true);
    MXServer.getMXServer().reloadMaximoCache('MAXPROP', 'naviam.autoscript.debug.host', true);
    MXServer.getMXServer().reloadMaximoCache('MAXPROP', 'naviam.autoscript.debug.js.exclude', true);
    MXServer.getMXServer().reloadMaximoCache('MAXPROP', 'naviam.autoscript.debug.enabled', true);
    MXServer.getMXServer().reloadMaximoCache('MAXPROP', 'naviam.autoscript.debug.client.idleTimeout', true);
    MXServer.getMXServer().reloadMaximoCache('MAXPROP', 'naviam.autoscript.debug.client.livenessPoll', true);
}

function addOrUpdateProperty(propName, description, value, maxType, secureLevel) {
    var propertySet;
    try {
        propertySet = MXServer.getMXServer().getMboSet('MAXPROP', MXServer.getMXServer().getSystemUserInfo());

        var sqlFormat = new SqlFormat('propname = :1');
        sqlFormat.setObject(1, 'MAXPROP', 'PROPNAME', propName);

        propertySet.setWhere(sqlFormat.format());
        var property;

        if (propertySet.isEmpty()) {
            property = propertySet.add();
            property.setValue('PROPNAME', propName);
            property.setValue('MAXTYPE', maxType);
            property.setValue('SECURELEVEL', secureLevel);
        } else {
            property = propertySet.moveFirst();
        }

        property.setValue('DESCRIPTION', description);

        var propValueSet = property.getMboSet('MAXPROPVALUE');
        var propValue;

        if (propValueSet.isEmpty()) {
            propValue = propValueSet.add();
        } else {
            propValue = propValueSet.moveFirst();
        }

        propValue.setValue('PROPVALUE', value, MboConstants.NOACCESSCHECK);

        propertySet.save();
    } finally {
        _close(propertySet);
    }
}

// Set up the Naviam Developer Tools loggers
function setupLoggers() {
    service.log_info('Setting up the Naviam Developer Tools Maximo loggers.');

    var loggerSet;

    try {
        loggerSet = MXServer.getMXServer().getMboSet('MAXLOGGER', MXServer.getMXServer().getSystemUserInfo());

        var sqlFormat = new SqlFormat('logger = :1');
        sqlFormat.setObject(1, 'MAXLOGGER', 'LOGGER', 'naviam');

        loggerSet.setWhere(sqlFormat.format());

        if (loggerSet.isEmpty()) {
            addOrUpdateLogger('naviam', 'WARN', null);
            loggerSet.save();
            loggerSet.reset();
        }

        // if the out of the box root logger is missing, abort.
        if (!loggerSet.isEmpty()) {
            var naviamLogger = loggerSet.getMbo(0);
            // Add or update the Naviam Developer Tools loggers.
            addOrUpdateLogger('devtools', 'WARN', naviamLogger);
            addOrUpdateLogger('debug', 'INFO', naviamLogger);
            loggerSet.save();
            try {
                MXServer.getMXServer().lookup('LOGGING').applySettings(false);
            } catch (error) {
                if (error instanceof MXException && error.getErrorKey() == 'applySettingsForFile' && error.getErrorGroup() == 'logging') {
                    service.log_info('Set up the Naviam Developer Tools Maximo loggers.');
                    return;
                } else {
                    throw error;
                }
            }
            service.log_info('Set up the Naviam Developer Tools Maximo loggers.');
        } else {
            service.log_warn(
                // eslint-disable-next-line quotes
                "The root out of the box logger 'autoscript' does not exist, skipping setting up Naviam Developer Tools Maximo loggers."
            );
        }

        // clean up old loggers from previous installs that are no longer used.
        sqlFormat.setObject(1, 'MAXLOGGER', 'LOGGER', 'NAVIAM.AUTOSCRIPT');
        loggerSet.setWhere(sqlFormat.format());
        loggerSet.reset();
        if (!loggerSet.isEmpty()) {
            var deleteLogger = loggerSet.moveFirst();
            deleteLogger.setValue('ACTIVE', false);

            deleteLogger.delete();
            loggerSet.save();
            // refresh the logging configuration to remove the deleted loggers from the system.
            try {
                MXServer.getMXServer().lookup('LOGGING').applySettings(false);
            } catch (error) {
                if (error instanceof MXException && error.getErrorKey() == 'applySettingsForFile' && error.getErrorGroup() == 'logging') {
                    service.log_info('Set up the Naviam Developer Tools Maximo loggers.');
                    return;
                } else {
                    throw error;
                }
            }
        }
    } finally {
        _close(loggerSet);
    }
}

// Adds or updates a Naviam Developer Tools logger.
// This relies on the calling function calling save on the provided parent MboSet to save the changes.
function addOrUpdateLogger(logger, level, parent) {
    service.log_info('Adding or updating the logger ' + logger + ' and setting the level to ' + level + '.');
    var loggerSet;
    try {
        loggerSet = MXServer.getMXServer().getMboSet('MAXLOGGER', MXServer.getMXServer().getSystemUserInfo());

        // Query for the log key
        var sqlFormat = new SqlFormat('logkey = :1');
        sqlFormat.setObject(1, 'MAXLOGGER', 'LOGKEY', parent == null ? 'log4j.logger.maximo.' + logger : parent.getString('LOGKEY') + '.' + logger);

        loggerSet.setWhere(sqlFormat.format());
        var child;
        // if the logkey does not exist create it, otherwise get the existing logger and update its level.
        if (loggerSet.isEmpty()) {
            child = parent == null ? loggerSet.add() : parent.getMboSet('CHILDLOGGERS').add();
            child.setValue('LOGGER', logger, MboConstants.NOVALIDATION);
            service.log_info('Added the logger ' + logger + ' and set the level to ' + level + '.');
            if (parent == null) {
                loggerSet.save();
            }
        } else {
            // Create a unique child MboSet name and then query based on the logkey where clause.
            var mboSetName = '$' + logger;
            child =
                parent == null
                    ? loggerSet.getMboSet(mboSetName, 'MAXLOGGER', sqlFormat.format()).getMbo(0)
                    : parent.getMboSet(mboSetName, 'MAXLOGGER', sqlFormat.format()).getMbo(0);
            service.log_info('Updated the logger ' + logger + ' and set the level to ' + level + '.');
        }

        child.setValue('LOGLEVEL', level);
    } finally {
        _close(loggerSet);
    }
}

// Verifies that object security has been configured on the NAVIAM_UTILS integration object structure.
function verifyIntegrationObjectSecurity() {
    var maxIntObjectSet;
    var sigOptionSet;
    var appAuthSet;
    try {
        service.log_info('Verifying that the integration object security has been configured.');

        maxIntObjectSet = MXServer.getMXServer().getMboSet('MAXINTOBJECT', MXServer.getMXServer().getSystemUserInfo());

        var sqlFormat = new SqlFormat('intobjectname = :1');
        sqlFormat.setObject(1, 'MAXINTOBJECT', 'INTOBJECTNAME', 'NAVIAM_UTILS');

        maxIntObjectSet.setWhere(sqlFormat.format());

        var maxIntObject;

        if (maxIntObjectSet.isEmpty()) {
            maxIntObject = maxIntObjectSet.add();
            maxIntObject.setValue('INTOBJECTNAME', 'NAVIAM_UTILS');
            maxIntObject.setValue('DESCRIPTION', 'Naviam Developer Tools Security');
            maxIntObject.setValue('USEWITH', 'INTEGRATION');
            var maxIntObjDetail = maxIntObject.getMboSet('MAXINTOBJDETAIL').add();
            maxIntObjDetail.setValue('OBJECTNAME', 'DUMMY_TABLE');
            maxIntObjectSet.save();

            var id = maxIntObject.getUniqueIDValue();
            maxIntObjectSet.reset();
            maxIntObject = maxIntObjectSet.getMboForUniqueId(id);
        } else {
            maxIntObject = maxIntObjectSet.getMbo(0);
        }

        if (!maxIntObject.getBoolean('USEOSSECURITY')) {
            service.log_info('Object structure security has not be configured for NAVIAM_UTILS, checking for pre-existing security configurations.');

            // check if the left over options have been granted to any groups and if so then remove them.
            appAuthSet = MXServer.getMXServer().getMboSet('APPLICATIONAUTH', MXServer.getMXServer().getSystemUserInfo());

            sqlFormat = new SqlFormat('app = :1');
            sqlFormat.setObject(1, 'APPLICATIONAUTH', 'APP', 'NAVIAM_UTILS');

            appAuthSet.setWhere(sqlFormat.format());

            if (!appAuthSet.isEmpty()) {
                appAuthSet.deleteAll();
                appAuthSet.save();
            }

            // Deleting the object structure does not remove the security objects, so we need to make sure they aren't left over from a previous install.
            sigOptionSet = MXServer.getMXServer().getMboSet('SIGOPTION', MXServer.getMXServer().getSystemUserInfo());

            sqlFormat = new SqlFormat('app = :1');
            sqlFormat.setObject(1, 'SIGOPTION', 'APP', 'NAVIAM_UTILS');

            sigOptionSet.setWhere(sqlFormat.format());

            if (!sigOptionSet.isEmpty()) {
                sigOptionSet.deleteAll();
                sigOptionSet.save();
            }

            service.log_info('Security options are configured for NAVIAM_UTILS, removing before setting up object structure security.');

            maxIntObject['setValue(String, boolean)']('USEOSSECURITY', true);
        }

        maxIntObjectSet.save();

        service.log_info('Verified that the integration object security has been configured.');
    } finally {
        _close(appAuthSet);
        _close(sigOptionSet);
        _close(maxIntObjectSet);
    }
}

// Sets up the required signature security options for performing the Naviam Developer Tools installation.
function setupSigOptions() {
    service.log_info('Setting up deploy script security options for Naviam Developer Tools.');
    var sigOptionSet;
    try {
        sigOptionSet = MXServer.getMXServer().getMboSet('SIGOPTION', MXServer.getMXServer().getSystemUserInfo());

        // Query for the NAVIAM_UTILS app with the DEPLOYSCRIPT option.
        var sqlFormat = new SqlFormat('app = :1 and optionname = :2');
        sqlFormat.setObject(1, 'SIGOPTION', 'APP', 'NAVIAM_UTILS');
        sqlFormat.setObject(2, 'SIGOPTION', 'OPTIONNAME', 'DEPLOYSCRIPT');

        sigOptionSet.setWhere(sqlFormat.format());

        // If the DEPLOYSCRIPT does not exist then create it.
        if (sigOptionSet.isEmpty()) {
            service.log_info('The administrative security option DEPLOYSCRIPT for the NAVIAM_UTILS integration object structure does not exist, creating it.');

            var sigoption = sigOptionSet.add();
            sigoption.setValue('APP', 'NAVIAM_UTILS');
            sigoption.setValue('OPTIONNAME', 'DEPLOYSCRIPT');
            sigoption.setValue('DESCRIPTION', 'Deploy Automation Script');
            sigoption.setValue('ESIGENABLED', false);
            sigoption.setValue('VISIBLE', true);
            sigOptionSet.save();
            reloadRequired = true;
        } else {
            service.log_info('The administrative security option DEPLOYSCRIPT for the NAVIAM_UTILS integration object structure already exists, skipping.');
        }

        sqlFormat.setObject(2, 'SIGOPTION', 'OPTIONNAME', 'DEBUGSCRIPT');

        sigOptionSet.setWhere(sqlFormat.format());

        // If the DEBUGSCRIPT does not exist then create it.
        if (sigOptionSet.isEmpty()) {
            service.log_info('The administrative security option DEBUGSCRIPT for the NAVIAM_UTILS integration object structure does not exist, creating it.');

            sigoption = sigOptionSet.add();
            sigoption.setValue('APP', 'NAVIAM_UTILS');
            sigoption.setValue('OPTIONNAME', 'DEBUGSCRIPT');
            sigoption.setValue('DESCRIPTION', 'Debug Automation Script');
            sigoption.setValue('ESIGENABLED', false);
            sigoption.setValue('VISIBLE', true);
            sigOptionSet.save();
            reloadRequired = true;
        } else {
            service.log_info('The administrative security option DEBUGSCRIPT for the NAVIAM_UTILS integration object structure already exists, skipping.');
        }

        service.log_info('Set up administrative security options for Naviam Developer Tools.');
    } finally {
        _close(sigOptionSet);
    }
}

// Determines if the current user is in the administrator group, returns true if the user is, false otherwise.
function isInAdminGroup() {
    var user = userInfo.getUserName();
    service.log_info('Determining if the user ' + user + ' is in the administrator group.');
    var groupUserSet;

    try {
        groupUserSet = MXServer.getMXServer().getMboSet('GROUPUSER', MXServer.getMXServer().getSystemUserInfo());

        // Get the ADMINGROUP MAXVAR value.
        var adminGroup = MXServer.getMXServer().lookup('MAXVARS').getString('ADMINGROUP', null);

        // Query for the current user and the found admin group.
        // The current user is determined by the implicity `user` variable.
        sqlFormat = new SqlFormat('userid = :1 and groupname = :2');
        sqlFormat.setObject(1, 'GROUPUSER', 'USERID', user);
        sqlFormat.setObject(2, 'GROUPUSER', 'GROUPNAME', adminGroup);
        groupUserSet.setWhere(sqlFormat.format());

        if (!groupUserSet.isEmpty()) {
            service.log_info('The user ' + user + ' is in the administrator group ' + adminGroup + '.');
            return true;
        } else {
            service.log_info('The user ' + user + ' is not in the administrator group ' + adminGroup + '.');
            return false;
        }
    } finally {
        _close(groupUserSet);
    }
}

function ScriptError(reason, message) {
    Error.call(this, message);
    this.reason = reason;
    this.message = message;
}

// ConfigurationError derives from Error
ScriptError.prototype = Object.create(Error.prototype);
ScriptError.prototype.constructor = ScriptError;
ScriptError.prototype.element;

// Cleans up the MboSet connections and closes the set.
function _close(set) {
    if (set) {
        try {
            set.close();
            set.cleanup();
        } catch (ignored) {
            /* empty */
        }
    }
}

var scriptConfig = {
    autoscript: 'NAVIAM.AUTOSCRIPT.INSTALL',
    description: 'Naviam Script to Install Developer Tools',
    version: '1.0.0',
    active: true,
    logLevel: 'ERROR'
};
