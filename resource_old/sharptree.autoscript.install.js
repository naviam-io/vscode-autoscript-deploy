/* eslint-disable no-undef */
/* eslint-disable no-unused-vars */
// @ts-nocheck
/*
 *   Bootstrap script that is used to install the Sharptree Automation Script deploy utility.
 */
MboConstants = Java.type('psdi.mbo.MboConstants');

DBShortcut = Java.type('psdi.mbo.DBShortcut');

SqlFormat = Java.type('psdi.mbo.SqlFormat');

MXServer = Java.type('psdi.server.MXServer');

MXSession = Java.type('psdi.util.MXSession');

MXException = Java.type('psdi.util.MXException');

RuntimeException = Java.type('java.lang.RuntimeException');

main();

function main() {
    try {
        // Before doing anything else, make sure we have a valid installation user that is part of the administrator group.
        if (!isInAdminGroup()) {
            // The installation user must be in the admin group.
            throw new ScriptError(
                'not_admin',
                'The user ' +
                    userInfo.getUserName() +
                    ' is not in the Maximo Administrators group and cannot perform the install.'
            );
        }
        // Set up the Maximo loggers that will be used by the Sharptree Automation Script deploy utility.
        setupLoggers();

        verifyIntegrationObjectSecurity();

        setupSigOptions();

        var success = {
            status: 'success',
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
                response.reason =
                    error.getCause().getErrorGroup() +
                    '_' +
                    error.getCause().getErrorKey();
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
        db.execute(
            DBShortcut.UPDATE,
            'update inspectionform set readconfirmation = 0 where readconfirmation is null'
        );
        db.execute(
            DBShortcut.UPDATE,
            'update inspectionform set audioguided = 0 where audioguided is null'
        );
        db.commit();
    } finally {
        db.close();
    }
}

// Set up the Sharptree Automation Script deploy utility loggers
function setupLoggers() {
    service.log_info(
        'Setting up the Sharptree Automation Script deploy utility Maximo loggers.'
    );

    var loggerSet;

    try {
        loggerSet = MXServer.getMXServer().getMboSet(
            'MAXLOGGER',
            MXServer.getMXServer().getSystemUserInfo()
        );

        var sqlFormat = new SqlFormat('logger = :1');
        sqlFormat.setObject(1, 'MAXLOGGER', 'LOGGER', 'autoscript');

        loggerSet.setWhere(sqlFormat.format());

        // if the out of the box root logger is missing, abort.
        if (!loggerSet.isEmpty()) {
            var scriptLogger = loggerSet.getMbo(0);
            // Add or update the Sharptree and Opqo loggers.
            addOrUpdateLogger('SHARPTREE.AUTOSCRIPT', 'WARN', scriptLogger);
            loggerSet.save();
            try {
                MXServer.getMXServer().lookup('LOGGING').applySettings(false);
            } catch (error) {
                if (
                    error instanceof MXException &&
                    error.getErrorKey() == 'applySettingsForFile' &&
                    error.getErrorGroup() == 'logging'
                ) {
                    service.log_info(
                        'Set up the Sharptree Automation Script deploy utility Maximo loggers.'
                    );
                    return;
                } else {
                    throw error;
                }
            }
            service.log_info(
                'Set up the Sharptree Automation Script deploy utility Maximo loggers.'
            );
        } else {
            service.log_warn(
                // eslint-disable-next-line quotes
                "The root out of the box logger 'autoscript' does not exist, skipping setting up Sharptree Automation Script deploy utility Maximo loggers."
            );
        }
    } finally {
        _close(loggerSet);
    }
}

// Adds or updates a Sharptree Automation Script deploy utility logger.
// This relies on the calling function calling save on the provided parent MboSet to save the changes.
function addOrUpdateLogger(logger, level, parent) {
    service.log_info(
        'Adding or updating the logger ' +
            logger +
            ' and setting the level to ' +
            level +
            '.'
    );
    var loggerSet;
    try {
        loggerSet = MXServer.getMXServer().getMboSet(
            'MAXLOGGER',
            MXServer.getMXServer().getSystemUserInfo()
        );

        // Query for the log key
        var sqlFormat = new SqlFormat('logkey = :1');
        sqlFormat.setObject(
            1,
            'MAXLOGGER',
            'LOGKEY',
            parent.getString('LOGKEY') + '.' + logger
        );

        loggerSet.setWhere(sqlFormat.format());
        var child;
        // if the logkey does not exist create it, otherwise get the existing logger and update its level.
        if (loggerSet.isEmpty()) {
            child = parent.getMboSet('CHILDLOGGERS').add();
            child.setValue('LOGGER', logger);
            service.log_info(
                'Added the logger ' +
                    logger +
                    ' and set the level to ' +
                    level +
                    '.'
            );
        } else {
            // Create a unique child MboSet name and then query based on the logkey where clause.
            var mboSetName = '$' + logger;
            child = parent
                .getMboSet(mboSetName, 'MAXLOGGER', sqlFormat.format())
                .getMbo(0);
            service.log_info(
                'Updated the logger ' +
                    logger +
                    ' and set the level to ' +
                    level +
                    '.'
            );
        }

        child.setValue('LOGLEVEL', level);
    } finally {
        _close(loggerSet);
    }
}

// Verifies that object security has been configured on the STAUTOSCRIPT integration object structure.
function verifyIntegrationObjectSecurity() {
    var maxIntObjectSet;
    var sigOptionSet;
    var appAuthSet;
    try {
        service.log_info(
            'Verifying that the integration object security has been configured.'
        );

        maxIntObjectSet = MXServer.getMXServer().getMboSet(
            'MAXINTOBJECT',
            MXServer.getMXServer().getSystemUserInfo()
        );

        var sqlFormat = new SqlFormat('intobjectname = :1');
        sqlFormat.setObject(
            1,
            'MAXINTOBJECT',
            'INTOBJECTNAME',
            'SHARPTREE_UTILS'
        );

        maxIntObjectSet.setWhere(sqlFormat.format());

        var maxIntObject;

        if (maxIntObjectSet.isEmpty()) {
            maxIntObject = maxIntObjectSet.add();
            maxIntObject.setValue('INTOBJECTNAME', 'SHARPTREE_UTILS');
            maxIntObject.setValue(
                'DESCRIPTION',
                'Sharptree Utilities Integration Security'
            );
            maxIntObject.setValue('USEWITH', 'INTEGRATION');
            var maxIntObjDetail = maxIntObject
                .getMboSet('MAXINTOBJDETAIL')
                .add();
            maxIntObjDetail.setValue('OBJECTNAME', 'DUMMY_TABLE');
            maxIntObjectSet.save();

            var id = maxIntObject.getUniqueIDValue();
            maxIntObjectSet.reset();
            maxIntObject = maxIntObjectSet.getMboForUniqueId(id);
        } else {
            maxIntObject = maxIntObjectSet.getMbo(0);
        }

        if (!maxIntObject.getBoolean('USEOSSECURITY')) {
            service.log_info(
                'Object structure security has not be configured for SHARPTREE_UTILS, checking for pre-existing security configurations.'
            );

            // check if the left over options have been granted to any groups and if so then remove them.
            appAuthSet = MXServer.getMXServer().getMboSet(
                'APPLICATIONAUTH',
                MXServer.getMXServer().getSystemUserInfo()
            );

            sqlFormat = new SqlFormat('app = :1');
            sqlFormat.setObject(1, 'APPLICATIONAUTH', 'APP', 'SHARPTREE_UTILS');

            appAuthSet.setWhere(sqlFormat.format());

            if (!appAuthSet.isEmpty()) {
                appAuthSet.deleteAll();
                appAuthSet.save();
            }

            // Deleting the object structure does not remove the security objects, so we need to make sure they aren't left over from a previous install.
            sigOptionSet = MXServer.getMXServer().getMboSet(
                'SIGOPTION',
                MXServer.getMXServer().getSystemUserInfo()
            );

            sqlFormat = new SqlFormat('app = :1');
            sqlFormat.setObject(1, 'SIGOPTION', 'APP', 'SHARPTREE_UTILS');

            sigOptionSet.setWhere(sqlFormat.format());

            if (!sigOptionSet.isEmpty()) {
                sigOptionSet.deleteAll();
                sigOptionSet.save();
            }

            service.log_info(
                'Security options are configured for SHARPTREE_UTILS, removing before setting up object structure security.'
            );

            maxIntObject['setValue(String, boolean)']('USEOSSECURITY', true);
        }

        maxIntObjectSet.save();

        service.log_info(
            'Verified that the integration object security has been configured.'
        );
    } finally {
        _close(appAuthSet);
        _close(sigOptionSet);
        _close(maxIntObjectSet);
    }
}

// Sets up the required signature security options for performing the Sharptree Automation Script deploy utility installation.
function setupSigOptions() {
    service.log_info(
        'Setting up deploy script security options for Sharptree Automation Script deploy utility.'
    );
    var sigOptionSet;
    try {
        sigOptionSet = MXServer.getMXServer().getMboSet(
            'SIGOPTION',
            MXServer.getMXServer().getSystemUserInfo()
        );

        // Query for the STAUTOSCRIPT app with the STADMINACTION option.
        var sqlFormat = new SqlFormat('app = :1 and optionname = :2');
        sqlFormat.setObject(1, 'SIGOPTION', 'APP', 'SHARPTREE_UTILS');
        sqlFormat.setObject(2, 'SIGOPTION', 'OPTIONNAME', 'DEPLOYSCRIPT');

        sigOptionSet.setWhere(sqlFormat.format());

        // If the STADMINACTION does not exist then create it.
        if (sigOptionSet.isEmpty()) {
            service.log_info(
                'The administrative security option DEPLOYSCRIPT for the SHARPTREE_UTILS integration object structure does not exist, creating it.'
            );

            var sigoption = sigOptionSet.add();
            sigoption.setValue('APP', 'SHARPTREE_UTILS');
            sigoption.setValue('OPTIONNAME', 'DEPLOYSCRIPT');
            sigoption.setValue('DESCRIPTION', 'Deploy Automation Script');
            sigoption.setValue('ESIGENABLED', false);
            sigoption.setValue('VISIBLE', true);
            sigOptionSet.save();
            reloadRequired = true;
        } else {
            service.log_info(
                'The administrative security option DEPLOYSCRIPT for the SHARPTREE_UTILS integration object structure already exists, skipping.'
            );
        }

        service.log_info(
            'Set up administrative security options for Sharptree Automation Script deploy utility.'
        );
    } finally {
        _close(sigOptionSet);
    }
}

// Determines if the current user is in the administrator group, returns true if the user is, false otherwise.
function isInAdminGroup() {
    var user = userInfo.getUserName();
    service.log_info(
        'Determining if the user ' + user + ' is in the administrator group.'
    );
    var groupUserSet;

    try {
        groupUserSet = MXServer.getMXServer().getMboSet(
            'GROUPUSER',
            MXServer.getMXServer().getSystemUserInfo()
        );

        // Get the ADMINGROUP MAXVAR value.
        var adminGroup = MXServer.getMXServer()
            .lookup('MAXVARS')
            .getString('ADMINGROUP', null);

        // Query for the current user and the found admin group.
        // The current user is determined by the implicity `user` variable.
        sqlFormat = new SqlFormat('userid = :1 and groupname = :2');
        sqlFormat.setObject(1, 'GROUPUSER', 'USERID', user);
        sqlFormat.setObject(2, 'GROUPUSER', 'GROUPNAME', adminGroup);
        groupUserSet.setWhere(sqlFormat.format());

        if (!groupUserSet.isEmpty()) {
            service.log_info(
                'The user ' +
                    user +
                    ' is in the administrator group ' +
                    adminGroup +
                    '.'
            );
            return true;
        } else {
            service.log_info(
                'The user ' +
                    user +
                    ' is not in the administrator group ' +
                    adminGroup +
                    '.'
            );
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
        } catch (ignored) {}
    }
}
