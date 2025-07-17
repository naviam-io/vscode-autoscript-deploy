/* eslint-disable no-undef */
// @ts-nocheck
RuntimeException = Java.type('java.lang.RuntimeException');
ConfigureServiceRemote = Java.type('psdi.app.configure.ConfigureServiceRemote');
AdminModeManager = Java.type('psdi.security.AdminModeManager');
MXServer = Java.type('psdi.server.MXServer');
SqlFormat = Java.type('psdi.mbo.SqlFormat');

MXException = Java.type('psdi.util.MXException');

main();

function main() {
    // if the implicit request variable is present then we are in the context of a REST request
    if (typeof request !== 'undefined' && request) {
        try {
            checkPermissions('SHARPTREE_UTILS', 'DEPLOYSCRIPT');

            var result = {};
            try {
                var action = getRequestAction();

                if (action) {
                    action = action.toLowerCase();
                }

                if (
                    action == 'adminmodeon' &&
                    request.getHttpMethod() == 'POST'
                ) {
                    setAdminModeOn();
                    result.adminModeOnStarted = true;
                } else if (
                    action == 'adminmodeoff' &&
                    request.getHttpMethod() == 'POST'
                ) {
                    setAdminModeOff();
                    result.adminModeOffStarted = true;
                } else if (
                    action == 'adminmodeon' &&
                    request.getHttpMethod() == 'GET'
                ) {
                    result.adminModeOn = isAdminModeOn();
                } else if (
                    action == 'adminmodeoff' &&
                    request.getHttpMethod() == 'GET'
                ) {
                    result.adminModeOff = isAdminModeOff();
                } else if (
                    action == 'configuring' &&
                    request.getHttpMethod() == 'GET'
                ) {
                    result.configuring = dbConfigInProgress();
                } else if (
                    action == 'configdbrequired' &&
                    request.getHttpMethod() == 'GET'
                ) {
                    result.configDBRequired = configDBRequired();
                } else if (
                    action == 'configdblevel' &&
                    request.getHttpMethod() == 'GET'
                ) {
                    result.configDBLevel = configDBLevel();
                } else if (
                    action == 'configdbrequiresadminmode' &&
                    request.getHttpMethod() == 'GET'
                ) {
                    result.configDBRequiresAdminMode = configDBRequiresAdmin();
                } else if (
                    action == 'applyconfigdb' &&
                    request.getHttpMethod() == 'POST'
                ) {
                    applyConfigDB();
                    result.configDBStarted = true;
                } else if (
                    action == 'configmessages' &&
                    request.getHttpMethod() == 'GET'
                ) {
                    result.messages = getConfigurationMessages();
                }
                result.status = 'ok';
            } catch (error) {
                result.error = error.toString();
                result.status = 'error';
            }

            responseBody = JSON.stringify(result, null, 4);
        } catch (error) {
            var response = {};
            response.status = 'error';
            Java.type('java.lang.System').out.println(error);
            if (error instanceof AdminError) {
                response.message = error.message;
                response.reason = error.reason;
            } else if (error instanceof Error) {
                response.message = error.message;
            } else if (error instanceof MXException) {
                response.reason =
                    error.getErrorGroup() + '_' + error.getErrorKey();
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

            if (typeof httpMethod !== 'undefined') {
                responseBody = JSON.stringify(response);
            }

            service.log_error(error);

            return;
        }
    }
}

function getConfigurationMessages() {
    var configureService = MXServer.getMXServer().lookup('CONFIGURE');

    var listenerSet = MXServer.getMXServer().getMboSet(
        'PROCESSMONITOR',
        userInfo
    );
    try {
        var listener = listenerSet.add();
        configureService.listenToConfigDB(listener, true);

        return listener.getString('STATUS');
    } finally {
        if (listenerSet) {
            try {
                listenerSet.close();
                listenerSet.cleanup();
            } catch (ignored) {
                // ignored
            }
        }
    }
}

function setAdminModeOn() {
    if (
        !MXServer.getMXServer()
            .lookup('SECURITY')
            .getProfile(userInfo)
            .hasAppOption('CONFIGUR', 'ADMINMODE')
    ) {
        throw new Error(
            'You do not have permission to manage the system Admin Mode. Make sure you have the "Manage Admin Mode" security permission for the "Database Configuration" application.'
        );
    }
    if (isAdminModeOff()) {
        MXServer.getMXServer().reloadAdminModeByThread(
            AdminModeManager.ADMIN_ON,
            null
        );
    }
}

function setAdminModeOff() {
    if (
        !MXServer.getMXServer()
            .lookup('SECURITY')
            .getProfile(userInfo)
            .hasAppOption('CONFIGUR', 'ADMINMODE')
    ) {
        throw new Error(
            'You do not have permission to manage the system Admin Mode. Make sure you have the "Manage Admin Mode" security permission for the "Database Configuration" application.'
        );
    }
    if (isAdminModeOn()) {
        MXServer.getMXServer().reloadAdminModeByThread(
            AdminModeManager.ADMIN_OFF,
            null
        );
    }
}

function isAdminModeOn() {
    return MXServer.getMXServer().isAdminModeOn(true);
}

function isAdminModeOff() {
    return MXServer.getMXServer().isAdminModeOff(true);
}

function configDBRequired() {
    var configureService = MXServer.getMXServer().lookup('CONFIGURE');
    return (
        configureService.getConfigLevel(userInfo) !==
        ConfigureServiceRemote.CONFIGDB_NONE
    );
}

function configDBLevel() {
    var configureService = MXServer.getMXServer().lookup('CONFIGURE');
    return configureService.getConfigLevel(userInfo);
}

function configDBRequiresAdmin() {
    var configureService = MXServer.getMXServer().lookup('CONFIGURE');
    return (
        configureService.getConfigLevel(userInfo) ==
        ConfigureServiceRemote.CONFIGDB_STRUCT
    );
}

function dbConfigInProgress() {
    var maxVarsService = MXServer.getMXServer().lookup('MAXVARS');
    var configureService = MXServer.getMXServer().lookup('CONFIGURE');
    return (
        maxVarsService.getBoolean('CONFIGURING', null) ||
        configureService.configIsRunning()
    );
}

function applyConfigDB() {
    if (
        !MXServer.getMXServer()
            .lookup('SECURITY')
            .getProfile(userInfo)
            .hasAppOption('CONFIGUR', 'CONFIGURE')
    ) {
        throw new Error(
            'You do not have permission to configure the database. Make sure you have the "Apply Configuration Changes" security permission for the "Database Configuration" application.'
        );
    }

    var set = MXServer.getMXServer().getMboSet('PROCESSMONITOR', userInfo);
    try {
        var monitor = set.add();
        var configureService = MXServer.getMXServer().lookup('CONFIGURE');
        configureService.runConfigDB(monitor);
    } finally {
        try {
            set.close();
            set.cleanup();
        } catch (ignored) {
            // ignored
        }
    }
}

function getRequestAction() {
    var httpRequest = request.getHttpServletRequest();

    var requestURI = httpRequest.getRequestURI();
    var contextPath = httpRequest.getContextPath();
    var resourceReq = requestURI;

    if (contextPath && contextPath !== '') {
        resourceReq = requestURI.substring(contextPath.length());
    }

    if (!resourceReq.startsWith('/')) {
        resourceReq = '/' + resourceReq;
    }

    var isOSLC = true;

    if (
        !resourceReq
            .toLowerCase()
            .startsWith('/oslc/script/' + service.scriptName.toLowerCase())
    ) {
        if (
            !resourceReq
                .toLowerCase()
                .startsWith('/api/script/' + service.scriptName.toLowerCase())
        ) {
            return null;
        } else {
            osOSLC = false;
        }
    }

    var baseReqPath = isOSLC
        ? '/oslc/script/' + service.scriptName
        : '/api/script/' + service.scriptName;
    var action = resourceReq.substring(baseReqPath.length);

    if (action.startsWith('/')) {
        action = action.substring(1);
    }

    if (!action || action.trim() === '') {
        return null;
    }

    return action.toLowerCase();
}

function checkPermissions(app, optionName) {
    if (!userInfo) {
        throw new AdminError(
            'no_user_info',
            'The userInfo global variable has not been set, therefore the user permissions cannot be verified.'
        );
    }

    var userProfile = MXServer.getMXServer()
        .lookup('SECURITY')
        .getProfile(userInfo);

    if (!userProfile.hasAppOption(app, optionName) && !isInAdminGroup()) {
        throw new AdminError(
            'no_permission',
            'The user ' +
                userInfo.getUserName() +
                ' does not have access to the ' +
                optionName +
                ' option in the ' +
                app +
                ' object structure.'
        );
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

// Cleans up the MboSet connections and closes the set.
function _close(set) {
    if (set) {
        try {
            set.cleanup();
            set.close();
        } catch (ignore) {
            // ignored
        }
    }
}

function AdminError(reason, message) {
    Error.call(this, message);
    this.reason = reason;
    this.message = message;
}

// ConfigurationError derives from Error
AdminError.prototype = Object.create(Error.prototype);
AdminError.prototype.constructor = AdminError;
AdminError.prototype.element;

// eslint-disable-next-line no-unused-vars
var scriptConfig = {
    autoscript: 'SHARPTREE.AUTOSCRIPT.ADMIN',
    description: 'Sharptree automation script for admin operations',
    version: '1.0.0',
    active: true,
    logLevel: 'INFO',
};
