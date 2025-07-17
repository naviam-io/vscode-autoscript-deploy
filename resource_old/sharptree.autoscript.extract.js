/* eslint-disable no-empty */
/* eslint-disable no-redeclare */
/* eslint-disable indent */

/* eslint-disable no-undef */
// @ts-nocheck
RESTRequest = Java.type('com.ibm.tivoli.oslc.RESTRequest');

RuntimeException = Java.type('java.lang.RuntimeException');
System = Java.type('java.lang.System');

URLDecoder = Java.type('java.net.URLDecoder');
StandardCharsets = Java.type('java.nio.charset.StandardCharsets');

MboConstants = Java.type('psdi.mbo.MboConstants');
SqlFormat = Java.type('psdi.mbo.SqlFormat');
MXServer = Java.type('psdi.server.MXServer');

MXException = Java.type('psdi.util.MXException');
MXAccessException = Java.type('psdi.util.MXAccessException');
MXApplicationException = Java.type('psdi.util.MXApplicationException');

MXLoggerFactory = Java.type('psdi.util.logging.MXLoggerFactory');

var logger = MXLoggerFactory.getLogger(
    'maximo.script.' + service.getScriptName()
);

main();

function main() {
    if (typeof httpMethod !== 'undefined') {
        var response = {};

        try {
            checkPermissions('SHARPTREE_UTILS', 'DEPLOYSCRIPT');

            if (httpMethod.toLowerCase() === 'get') {
                var scriptName = getRequestScriptName();
                if (
                    typeof scriptName === 'undefined' ||
                    scriptName === null ||
                    !scriptName
                ) {
                    throw new ScriptError(
                        'missing_script_name',
                        'The script name was not provided. ' +
                            userInfo.getUserName()
                    );
                }

                response.status = 'success';
                response.script = extractScript(scriptName);
                response.scriptLanguage = getScriptLanguage(scriptName);
                responseBody = JSON.stringify(response);
                return;
            } else {
                throw new ScriptError(
                    'only_get_supported',
                    'Only the HTTP GET method is supported when extracting automation scripts.'
                );
            }
        } catch (error) {
            response.status = 'error';

            if (error instanceof ScriptError) {
                response.message = error.message;
                response.reason = error.reason;
            } else if (error instanceof SyntaxError) {
                response.reason = 'syntax_error';
                response.message = error.message;
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

            log_error(error);

            return;
        }
    }
}

function getScriptLanguage(scriptName) {
    var autoScriptSet;
    try {
        autoScriptSet = MXServer.getMXServer().getMboSet(
            'AUTOSCRIPT',
            userInfo
        );
        var sqlf = new SqlFormat('autoscript = :1');
        sqlf.setObject(1, 'AUTOSCRIPT', 'AUTOSCRIPT', scriptName);

        autoScriptSet.setWhere(sqlf.format());

        if (!autoScriptSet.isEmpty()) {
            var autoScript = autoScriptSet.getMbo(0);

            return autoScript.getString('SCRIPTLANGUAGE');
        } else {
            throw new ScriptError(
                'script_not_found',
                'The automation script ' + scriptName + ' was not found.'
            );
        }
    } finally {
        _close(autoScriptSet);
    }
}

function extractScript(scriptName) {
    var autoScriptSet;
    try {
        autoScriptSet = MXServer.getMXServer().getMboSet(
            'AUTOSCRIPT',
            userInfo
        );
        var sqlf = new SqlFormat('autoscript = :1');
        sqlf.setObject(1, 'AUTOSCRIPT', 'AUTOSCRIPT', scriptName);

        autoScriptSet.setWhere(sqlf.format());

        if (!autoScriptSet.isEmpty()) {
            var autoScript = autoScriptSet.getMbo(0);
            var source = autoScript.getString('SOURCE');

            var scriptLanguage = autoScript.getString('SCRIPTLANGUAGE');

            if (scriptLanguage === 'MBR') {
                throw new ScriptError(
                    'mbr_not_supported',
                    'MBR language support is not available.'
                );
            }

            var isPython = false;
            switch (scriptLanguage.toLowerCase()) {
                case 'python':
                case 'jython':
                    isPython = true;
                    break;
            }

            source = removeScriptConfigFromSource(source, isPython);

            if (isPython) {
                return (
                    source +
                    '\n\nscriptConfig="""' +
                    extractScriptConfiguration(autoScript) +
                    '"""'
                );
            } else {
                return (
                    source +
                    '\n\nvar scriptConfig=' +
                    extractScriptConfiguration(autoScript) +
                    ';'
                );
            }
        } else {
            throw new ScriptError(
                'script_not_found',
                'The automation script ' + scriptName + ' was not found.'
            );
        }
    } finally {
        _close(autoScriptSet);
    }
}

function removeScriptConfigFromSource(source, isPython) {
    var result;

    var braces = 0;
    var inBrace = false;
    var inQuote = false;
    var quoteChar;
    var ignoreNext = false;
    var startIndex = -1;
    var endIndex = -1;
    var lineComment = false;
    var blockComment = false;
    var word = '';

    var inScriptConfig = false;
    var lineStart = 0;

    if (isPython) {
        tripleQuoteCount = 0;

        for (var i = 0; i < source.length; i++) {
            var c = source.charAt(i);
            if (c === ' ' || c === '\t' || c === '\n') {
                if (c === '\n') {
                    lineStart = i;
                }
                word = '';
            } else {
                word += c;
            }
            if (!inScriptConfig) {
                if (word === '#') {
                    lineComment = true;
                }

                if (!lineComment) {
                    if (word === 'scriptConfig') {
                        inScriptConfig = true;
                        startIndex = lineStart;
                    }
                } else {
                    if (lineComment && c === '\n') {
                        lineComment = false;
                    }
                }
            } else {
                if (word === '"""' || word.indexOf('"""') > -1) {
                    tripleQuoteCount++;
                    word = '';
                }
            }

            if (tripleQuoteCount == 2) {
                endIndex = i + 1;
                break;
            }
        }
    } else {
        for (var i = 0; i < source.length; i++) {
            var c = source.charAt(i);

            if (c === ' ' || c === '\t' || c === '\n') {
                if (c === '\n') {
                    lineStart = i;
                }
                word = '';
            } else {
                word += c;
            }

            if (!inScriptConfig) {
                if (word === '//') {
                    lineComment = true;
                }

                if (word == '/*') {
                    blockComment = true;
                }

                if (!lineComment && !blockComment) {
                    if (word === 'scriptConfig') {
                        inScriptConfig = true;
                        startIndex = lineStart;
                    }
                } else {
                    if (lineComment && c === '\n') {
                        lineComment = false;
                    }
                    if (blockComment && word === '*/') {
                        blockComment = false;
                    }
                }
            } else {
                if (!inBrace) {
                    if (c === '{') {
                        inBrace = true;
                        braces = 1;
                    }
                } else {
                    if (braces === 0) {
                        if (c === ';' || (c !== '\n' && c !== ' ')) {
                            endIndex = i + 1;
                            break;
                        }
                    } else {
                        if (!inQuote) {
                            if (c === '{') {
                                braces++;
                            } else if (c === '}') {
                                braces--;
                            } else if (c === '"' || c === "'") {
                                inQuote = true;
                                quoteChar = c;
                            }
                        } else {
                            if (c === '\\') {
                                ignoreNext = true;
                            } else if (!ignoreNext && c === quoteChar) {
                                inQuote = false;
                            } else {
                                ignoreNext = false;
                            }
                        }
                    }
                }
            }
        }
    }

    if (endIndex > 0) {
        if (startIndex > 0) {
            result =
                source.substring(0, startIndex) + source.substring(endIndex);
        } else {
            result = source.substring(endIndex);
        }
    } else {
        // did not contain a configuration.
        result = source;
    }

    return result;
}

function extractScriptConfiguration(autoScript) {
    var scriptConfig = {};
    scriptConfig.autoscript = autoScript.getString('AUTOSCRIPT');
    scriptConfig.description = autoScript.getString('DESCRIPTION');
    scriptConfig.version = autoScript.getString('VERSION');
    scriptConfig.active = autoScript.getBoolean('ACTIVE');
    scriptConfig.logLevel = autoScript.getString('LOGLEVEL');
    scriptConfig.allowInvokingScriptFunctions =
        autoScript.getBoolean('INTERFACE');

    var autoScriptVarsSet = autoScript.getMboSet('AUTOSCRIPTVARS');

    if (!autoScriptVarsSet.isEmpty()) {
        var scriptVars = [];
        var autoScriptVar = autoScriptVarsSet.moveFirst();
        while (autoScriptVar) {
            var scriptVar = {};
            scriptVar.varname = autoScriptVar.getString('VARNAME');
            if (!autoScriptVar.isNull('DESCRIPTION')) {
                scriptVar.description = autoScriptVar.getString('DESCRIPTION');
            }
            if (!autoScriptVar.isNull('VARBINDINGTYPE')) {
                scriptVar.varBindingType =
                    autoScriptVar.getString('VARBINDINGTYPE');
            }
            if (!autoScriptVar.isNull('VARTYPE')) {
                scriptVar.varType = autoScriptVar.getString('VARTYPE');
            }
            if (!autoScriptVar.isNull('ALLOWOVERRIDE')) {
                scriptVar.allowOverride =
                    autoScriptVar.getBoolean('ALLOWOVERRIDE');
            }
            if (!autoScriptVar.isNull('NOVALIDATION')) {
                scriptVar.noValidation =
                    autoScriptVar.getBoolean('NOVALIDATION');
            }
            if (!autoScriptVar.isNull('NOACCESSCHECK')) {
                scriptVar.noAccessCheck =
                    autoScriptVar.getBoolean('NOACCESSCHECK');
            }
            if (!autoScriptVar.isNull('NOACTION')) {
                scriptVar.noAction = autoScriptVar.getBoolean('NOACTION');
            }
            if (!autoScriptVar.isNull('LITERALDATATYPE')) {
                scriptVar.literalDataType =
                    autoScriptVar.getString('LITERALDATATYPE');
            }
            if (!autoScriptVar.isNull('VARBINDINGVALUE')) {
                scriptVar.varBindingValue =
                    autoScriptVar.getString('VARBINDINGVALUE');
            }

            scriptVars.push(scriptVar);

            autoScriptVar = autoScriptVarsSet.moveNext();
        }

        if (scriptVars.length > 0) {
            scriptConfig.autoScriptVars = scriptVars;
        }
    }

    var scriptLaunchPointSet = autoScript.getMboSet('SCRIPTLAUNCHPOINT');

    if (!scriptLaunchPointSet.isEmpty()) {
        var launchPoints = [];
        var scriptLaunchPoint = scriptLaunchPointSet.moveFirst();

        while (scriptLaunchPoint) {
            var launchPoint = {};
            launchPoint.launchPointName =
                scriptLaunchPoint.getString('LAUNCHPOINTNAME');
            launchPoint.launchPointType =
                scriptLaunchPoint.getString('LAUNCHPOINTTYPE');
            launchPoint.active = scriptLaunchPoint.getBoolean('ACTIVE');

            if (!scriptLaunchPoint.isNull('DESCRIPTION')) {
                launchPoint.description =
                    scriptLaunchPoint.getString('DESCRIPTION');
            }

            if (launchPoint.launchPointType.toUpperCase() === 'OBJECT') {
                launchPoint.objectName =
                    scriptLaunchPoint.getString('OBJECTNAME');

                if (!scriptLaunchPoint.isNull('CONDITION')) {
                    launchPoint.condition =
                        scriptLaunchPoint.getString('CONDITION');
                }

                switch (scriptLaunchPoint.getInt('EVENTTYPE')) {
                    case 0:
                        launchPoint.initializeValue = true;
                        break;
                    case 1:
                        launchPoint.validateApplication = true;
                        break;
                    case 2:
                        launchPoint.allowObjectCreation = true;
                        break;
                    case 3:
                        launchPoint.allowObjectDeletion = true;
                        break;
                    case 4:
                        launchPoint.save = true;
                        launchPoint.add = scriptLaunchPoint.getBoolean('ADD');
                        launchPoint.update =
                            scriptLaunchPoint.getBoolean('UPDATE');
                        launchPoint.delete =
                            scriptLaunchPoint.getBoolean('DELETE');

                        if (!scriptLaunchPoint.isNull('EVCONTEXT')) {
                            switch (scriptLaunchPoint.getInt('EVCONTEXT')) {
                                case 0:
                                    launchPoint.beforeSave = true;
                                    break;
                                case 1:
                                    launchPoint.afterSave = true;
                                    break;
                                case 2:
                                    launchPoint.afterCommit = true;
                                    break;
                            }
                        }
                        break;
                }
            } else if (
                launchPoint.launchPointType.toUpperCase() === 'ATTRIBUTE'
            ) {
                launchPoint.objectName =
                    scriptLaunchPoint.getString('OBJECTNAME');
                launchPoint.attributeName =
                    scriptLaunchPoint.getString('ATTRIBUTENAME');

                switch (scriptLaunchPoint.getInt('ATTRIBUTEEVENT')) {
                    case 0:
                        launchPoint.initializeAccessRestriction = true;
                        break;
                    case 1:
                        launchPoint.initializeValue = true;
                        break;
                    case 2:
                        launchPoint.validate = true;
                        break;
                    case 3:
                        launchPoint.retrieveList = true;
                        break;
                    case 4:
                        launchPoint.runAction = true;
                        break;
                }
            } else if (launchPoint.launchPointType.toUpperCase() === 'ACTION') {
                if (!scriptLaunchPoint.isNull('ACTIONNAME')) {
                    launchPoint.actionName =
                        scriptLaunchPoint.getString('ACTIONNAME');
                } else {
                    launchPoint.actionName =
                        scriptLaunchPoint.getString('LAUNCHPOINTNAME');
                }
                if (!scriptLaunchPoint.isNull('OBJECTNAME')) {
                    launchPoint.objectName =
                        scriptLaunchPoint.getString('OBJECTNAME');
                }
            } else if (
                launchPoint.launchPointType.toUpperCase() === 'CUSTOMCONDITION'
            ) {
                if (!scriptLaunchPoint.isNull('OBJECTNAME')) {
                    launchPoint.objectName =
                        scriptLaunchPoint.getString('OBJECTNAME');
                }
            }

            var launchPointVarsSet =
                scriptLaunchPoint.getMboSet('LAUNCHPOINTVARS');

            if (!launchPointVarsSet.isEmpty()) {
                pointVars = [];
                var launchPointVars = launchPointVarsSet.moveFirst();

                while (launchPointVars) {
                    var pointVar = {};

                    if (!launchPointVars.isNull('VARNAME')) {
                        pointVar.varName = launchPointVars.getString('VARNAME');
                    }

                    if (!launchPointVars.isNull('VARBINDINGVALUE')) {
                        pointVar.varBindingValue =
                            launchPointVars.getString('VARBINDINGVALUE');
                    }
                    pointVars.push(pointVar);

                    launchPointVars = launchPointVarsSet.moveNext();
                }

                if (pointVars.length > 0) {
                    launchPoint.launchPointVars = pointVars;
                }
            }
            launchPoints.push(launchPoint);

            scriptLaunchPoint = scriptLaunchPointSet.moveNext();
        }

        if (launchPoints.length > 0) {
            scriptConfig.scriptLaunchPoints = launchPoints;
        }
    }

    return JSON.stringify(scriptConfig, null, 4);
}

function getRequestScriptName() {
    var field = RESTRequest.class.getDeclaredField('request');
    field.setAccessible(true);
    var httpRequest = field.get(request);

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

    return URLDecoder.decode(
        action.toLowerCase(),
        StandardCharsets.UTF_8.name()
    );
}

function checkPermissions(app, optionName) {
    if (!userInfo) {
        throw new ScriptError(
            'no_user_info',
            'The userInfo global variable has not been set, therefore the user permissions cannot be verified.'
        );
    }

    if (
        !MXServer.getMXServer()
            .lookup('SECURITY')
            .getProfile(userInfo)
            .hasAppOption(app, optionName) &&
        !isInAdminGroup()
    ) {
        throw new ScriptError(
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

// Logging functions provided for compatibility with older versions where service.log_xxxx is not available.
// eslint-disable-next-line no-unused-vars
function log_debug(msg) {
    logger.debug(msg);
}

// eslint-disable-next-line no-unused-vars
function log_info(msg) {
    logger.info(msg);
}

// eslint-disable-next-line no-unused-vars
function log_warn(msg) {
    logger.warn(msg);
}

function log_error(msg) {
    logger.error(msg);
}

// Cleans up the MboSet connections and closes the set.
function _close(set) {
    if (set) {
        try {
            set.cleanup();
            set.close();
        } catch (ignored) {}
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

// eslint-disable-next-line no-unused-vars
var scriptConfig = {
    autoscript: 'SHARPTREE.AUTOSCRIPT.EXTRACT',
    description: 'Sharptree Automation Script Extract Script',
    version: '1.0.0',
    active: true,
    logLevel: 'INFO',
};
