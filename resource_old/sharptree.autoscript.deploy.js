/* eslint-disable no-redeclare */
/* eslint-disable indent */
/* eslint-disable quotes */
/* eslint-disable no-undef */
// @ts-nocheck
load('nashorn:parser.js');

var MboConstants = Java.type('psdi.mbo.MboConstants');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');
var MXServer = Java.type('psdi.server.MXServer');

var MXException = Java.type('psdi.util.MXException');

var ScriptBinding = Java.type('com.ibm.tivoli.maximo.script.ScriptBinding');
var ScriptCache = Java.type('com.ibm.tivoli.maximo.script.ScriptCache');
var ScriptDriverFactory = Java.type(
    'com.ibm.tivoli.maximo.script.ScriptDriverFactory'
);

var ScriptContext = Java.type('javax.script.ScriptContext');
var ScriptEngineManager = Java.type('javax.script.ScriptEngineManager');

var ScriptException = Java.type('javax.script.ScriptException');

var RuntimeException = Java.type('java.lang.RuntimeException');
var Runnable = Java.type('java.lang.Runnable');

var Thread = Java.type('java.lang.Thread');

var Calendar = Java.type('java.util.Calendar');
var HashMap = Java.type('java.util.HashMap');

var NoSuchMethodException = Java.type('java.lang.NoSuchMethodException');

// Global input variables
scriptSource = '';

MXLoggerFactory = Java.type('psdi.util.logging.MXLoggerFactory');

var logger = MXLoggerFactory.getLogger(
    'maximo.script.' + service.getScriptName()
);

load({
    script: ScriptCache.getInstance()
        .getScriptInfo('SHARPTREE.AUTOSCRIPT.LIBRARY')
        .getScriptSource(),
    name: 'SHARPTREE.AUTOSCRIPT.LIBRARY',
});

if (typeof httpMethod !== 'undefined') {
    main();
}

function main() {
    var response = {};
    try {
        checkPermissions('SHARPTREE_UTILS', 'DEPLOYSCRIPT');

        var action;

        if (typeof requestBody !== 'undefined') {
            action = getRequestAction();

            if (httpMethod != 'POST') {
                throw new ScriptError(
                    'only_post_supported',
                    'Only the HTTP POST method is supported when deploying automation scripts.'
                );
            }
            scriptSource = requestBody;
            if (!scriptSource) {
                throw new ScriptError(
                    'no_script_source',
                    'A script source must be the request body.'
                );
            }

            if (action && action.startsWith('source')) {
                scriptSource = requestBody;
                if (!scriptSource) {
                    throw new ScriptError(
                        'no_script_source',
                        'A script source must be the request body.'
                    );
                }

                var scriptConfig = getConfigFromScript(
                    scriptSource,
                    action.split('/')[1]
                );

                var sqlf = new SqlFormat('autoscript = :1');
                sqlf.setObject(
                    1,
                    'AUTOSCRIPT',
                    'AUTOSCRIPT',
                    scriptConfig.autoscript
                );
                var autoScriptSet;
                try {
                    autoScriptSet = MXServer.getMXServer().getMboSet(
                        'AUTOSCRIPT',
                        userInfo
                    );
                    autoScriptSet.setWhere(sqlf.format());
                    if (!autoScriptSet.isEmpty()) {
                        response = {};
                        response.source = autoScriptSet
                            .getMbo(0)
                            .getString('SOURCE');
                        responseBody = JSON.stringify(response);
                        return;
                    } else {
                        response = {};
                        response.source = '';
                        responseBody = JSON.stringify(response);
                        return;
                    }
                } finally {
                    _close(autoScriptSet);
                }
            } else if (action && action == 'config') {
                deployConfig(JSON.parse(requestBody));
                return;
            }
        } else if (
            typeof request !== 'undefined' &&
            typeof httpMethod !== 'undefined'
        ) {
            if (httpMethod === 'GET') {
                if (request.getQueryParam('deployId')) {
                    responseBody = JSON.stringify(
                        getDeploymentResult(request.getQueryParam('deployId'))
                    );
                    return;
                } else {
                    action = getRequestAction();
                    if (action) {
                        if (action.startsWith('version')) {
                            var response = {
                                version: getScriptVersion(
                                    'SHARPTREE.AUTOSCRIPT.DEPLOY'
                                ),
                            };
                            responseBody = JSON.stringify(response);
                            return;
                        }
                    }
                }
            } else if (httpMethod == 'PUT') {
                if (
                    request.getQueryParam('deployId') &&
                    request.getQueryParam('cancel') == 'true'
                ) {
                    var bulletinBoardSet = MXServer.getMXServer().getMboSet(
                        'BULLETINBOARD',
                        userInfo
                    );
                    try {
                        var bulletinBoard = bulletinBoardSet.getMboForUniqueId(
                            request.getQueryParam('deployId')
                        );
                        if (bulletinBoard) {
                            bulletinBoard.delete();
                            bulletinBoardSet.save();
                        }
                        responseBody = JSON.stringify({
                            deploying: false,
                            status: 'success',
                        });
                        return;
                    } finally {
                        _close(bulletinBoardSet);
                    }
                }
            }
        }

        // if the script source is available then call the deploy script.
        // This allows the deployScript function to be called from the context directly if the script it loaded from another script.
        if (scriptSource) {
            var response = deployScript(scriptSource, action);
            responseBody = JSON.stringify(response);
        }
    } catch (error) {
        response.status = 'error';
        // ensure the error is logged to the Maximo logs
        Java.type('java.lang.System').out.println(error);
        if (error instanceof ScriptError) {
            response.message = error.message;
            response.reason = error.reason;
        } else if (error instanceof SyntaxError) {
            response.reason = 'syntax_error';
            response.message = error.message;
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

        if (typeof httpMethod !== 'undefined') {
            responseBody = JSON.stringify(response);
        }

        service.log_error(error);

        return;
    }

    if (typeof response.status === 'undefined' || response.status == null) {
        response.status = 'success';
    }

    if (typeof requestBody !== 'undefined' && requestBody) {
        responseBody = JSON.stringify(response);
    }
    return;
}

function deployScript(scriptSource, language) {
    var scriptConfig = getConfigFromScript(scriptSource, language);
    var deployId = -1;
    var result = { scriptName: scriptConfig.autoscript };
    if (scriptConfig) {
        validateScriptConfig(scriptConfig);
        var autoScriptSet;

        try {
            autoScriptSet = MXServer.getMXServer().getMboSet(
                'AUTOSCRIPT',
                userInfo
            );
            var sqlf = new SqlFormat('autoscript = :1');
            sqlf.setObject(
                1,
                'AUTOSCRIPT',
                'AUTOSCRIPT',
                scriptConfig.autoscript
            );

            autoScriptSet.setWhere(sqlf.format());

            var autoscript;

            if (autoScriptSet.isEmpty()) {
                autoscript = autoScriptSet.add();
                autoscript.setValue('AUTOSCRIPT', scriptConfig.autoscript);
                autoscript.setValue(
                    'SCRIPTLANGUAGE',
                    language ? language : 'javascript'
                );
                autoscript.setValue('ACTIVE', true);
            } else {
                autoscript = autoScriptSet.getMbo(0);
                if (
                    typeof scriptConfig._delete !== 'undefined' &&
                    scriptConfig._delete === true
                ) {
                    autoscript.delete();
                    autoScriptSet.save();
                    result.scriptName = scriptConfig.autoscript;
                    result.deploying = false;
                    result.deleted = true;
                    result.status = 'success';
                    return result;
                }
            }
            autoscript.setValue('SOURCE', scriptSource);

            var autoScriptId = autoscript.getUniqueIDValue();

            // Delete all the launch points to ensure they are recreated correctly.
            // Deleting the launch variables first so the script variables can be deleted without reference errors.
            scriptLaunchPointSet = autoscript.getMboSet('SCRIPTLAUNCHPOINT');
            scriptLaunchPointSet.deleteAll();

            autoScriptSet.save();

            //Refetch the auto script
            autoScriptSet.reset();
            autoscript = autoScriptSet.getMboForUniqueId(autoScriptId);

            // Delete the script variables to ensure they are recreated correctly.
            autoScriptVarsSet = autoscript.getMboSet('AUTOSCRIPTVARS');
            autoScriptVarsSet.deleteAll();

            autoScriptSet.save();

            //Refetch the auto script
            autoScriptSet.reset();
            autoscript = autoScriptSet.getMboForUniqueId(autoScriptId);

            scriptLaunchPointSet = autoscript.getMboSet('SCRIPTLAUNCHPOINT');
            autoScriptVarsSet = autoscript.getMboSet('AUTOSCRIPTVARS');

            if (scriptConfig.description) {
                autoscript.setValue('DESCRIPTION', scriptConfig.description);
            }

            setValueIfAvailable(
                autoscript,
                'DESCRIPTION',
                scriptConfig.description
            );
            setValueIfAvailable(autoscript, 'VERSION', scriptConfig.version);
            setValueIfAvailable(autoscript, 'ACTIVE', scriptConfig.active);
            setValueIfAvailable(autoscript, 'LOGLEVEL', scriptConfig.logLevel);

            if (
                typeof scriptConfig.allowInvokingScriptFunctions ==
                    'undefined' ||
                scriptConfig.allowInvokingScriptFunctions == null
            ) {
                if (
                    scriptConfig.autoscript
                        .toUpperCase()
                        .startsWith('APPBEAN') ||
                    scriptConfig.autoscript.toUpperCase().startsWith('DATABEAN')
                ) {
                    setValueIfAvailable(autoscript, 'INTERFACE', true);
                }
            } else {
                setValueIfAvailable(
                    autoscript,
                    'INTERFACE',
                    scriptConfig.allowInvokingScriptFunctions
                );
            }

            if (typeof scriptConfig.autoScriptVars !== 'undefined') {
                scriptConfig.autoScriptVars.forEach(function (element) {
                    if (typeof element.varname !== 'undefined') {
                        var autoScriptVar = autoScriptVarsSet.add();
                        autoScriptVar.setValue('VARNAME', element.varname);
                        setValueIfAvailable(
                            autoScriptVar,
                            'DESCRIPTION',
                            element.description
                        );
                        setValueIfAvailable(
                            autoScriptVar,
                            'VARBINDINGTYPE',
                            element.varBindingType
                        );
                        setValueIfAvailable(
                            autoScriptVar,
                            'VARTYPE',
                            element.varType
                        );
                        setValueIfAvailable(
                            autoScriptVar,
                            'ALLOWOVERRIDE',
                            element.allowOverride
                        );

                        if (
                            element.varBindingType.toUpperCase() != 'LITERAL' &&
                            element.varType.toUpperCase() != 'IN'
                        ) {
                            setValueIfAvailable(
                                autoScriptVar,
                                'NOVALIDATION',
                                element.noValidation
                            );
                            setValueIfAvailable(
                                autoScriptVar,
                                'NOACCESSCHECK',
                                element.noAccessCheck
                            );
                            setValueIfAvailable(
                                autoScriptVar,
                                'NOACTION',
                                element.noAction
                            );
                        }

                        setValueIfAvailable(
                            autoScriptVar,
                            'LITERALDATATYPE',
                            element.literalDataType
                        );
                        setValueIfAvailable(
                            autoScriptVar,
                            'VARBINDINGVALUE',
                            element.varBindingValue,
                            MboConstants.NOACCESSCHECK
                        );
                    }
                });
            }

            if (scriptConfig.scriptLaunchPoints) {
                scriptConfig.scriptLaunchPoints.forEach(function (element) {
                    if (
                        typeof element.launchPointName !== 'undefined' &&
                        typeof element.launchPointType !== 'undefined'
                    ) {
                        var scriptLaunchPoint = scriptLaunchPointSet.add();
                        scriptLaunchPoint.setValue(
                            'LAUNCHPOINTNAME',
                            element.launchPointName
                        );
                        scriptLaunchPoint.setValue(
                            'LAUNCHPOINTTYPE',
                            element.launchPointType,
                            MboConstants.NOACCESSCHECK
                        );

                        if (typeof element.active !== 'undefined') {
                            scriptLaunchPoint.setValue(
                                'ACTIVE',
                                element.active
                            );
                        } else {
                            scriptLaunchPoint.setValue('ACTIVE', true);
                        }

                        setValueIfAvailable(
                            scriptLaunchPoint,
                            'DESCRIPTION',
                            element.description
                        );

                        if (
                            element.launchPointType.toUpperCase() === 'OBJECT'
                        ) {
                            if (typeof element.objectName === 'undefined') {
                                throw new ScriptError(
                                    'missing_attribute',
                                    'The objectName is a required attribute when defining an Object launch point.'
                                );
                            }

                            scriptLaunchPoint.setValue(
                                'OBJECTNAME',
                                element.objectName
                            );

                            setValueIfAvailable(
                                scriptLaunchPoint,
                                'CONDITION',
                                element.condition
                            );

                            if (
                                typeof element.initializeValue !==
                                    'undefined' &&
                                element.initializeValue
                            ) {
                                scriptLaunchPoint.setValue('EVENTTYPE', '0');
                            } else if (
                                typeof element.validateApplication !==
                                    'undefined' &&
                                element.validateApplication
                            ) {
                                scriptLaunchPoint.setValue('EVENTTYPE', '1');
                            } else if (
                                typeof element.allowObjectCreation !==
                                    'undefined' &&
                                element.allowObjectCreation
                            ) {
                                scriptLaunchPoint.setValue('EVENTTYPE', '2');
                            } else if (
                                typeof element.allowObjectDeletion !==
                                    'undefined' &&
                                element.allowObjectDeletion
                            ) {
                                scriptLaunchPoint.setValue('EVENTTYPE', '3');
                            } else if (
                                typeof element.save !== 'undefined' &&
                                element.save
                            ) {
                                scriptLaunchPoint.setValue('EVENTTYPE', '4');
                                var saveActionAdded = false;
                                if (
                                    typeof element.add !== 'undefined' &&
                                    element.add
                                ) {
                                    scriptLaunchPoint.setValue('ADD', true);
                                    saveActionAdded = true;
                                }
                                if (
                                    typeof element.update !== 'undefined' &&
                                    element.update
                                ) {
                                    scriptLaunchPoint.setValue('UPDATE', true);
                                    saveActionAdded = true;
                                }
                                if (
                                    typeof element.delete !== 'undefined' &&
                                    element.delete
                                ) {
                                    scriptLaunchPoint.setValue('DELETE', true);
                                    saveActionAdded = true;
                                }

                                if (!saveActionAdded) {
                                    throw new ScriptError(
                                        'missing_save_action',
                                        'At least one object save action of either add, update, or delete must be provided.'
                                    );
                                }

                                var saveWhenAdded = false;
                                if (
                                    typeof element.beforeSave !== 'undefined' &&
                                    element.beforeSave
                                ) {
                                    scriptLaunchPoint.setValue(
                                        'EVCONTEXT',
                                        '0'
                                    );
                                    saveWhenAdded = true;
                                } else if (
                                    typeof element.afterSave !== 'undefined' &&
                                    element.afterSave
                                ) {
                                    scriptLaunchPoint.setValue(
                                        'EVCONTEXT',
                                        '1'
                                    );
                                    saveWhenAdded = true;
                                } else if (
                                    typeof element.afterCommit !==
                                        'undefined' &&
                                    element.afterCommit
                                ) {
                                    scriptLaunchPoint.setValue(
                                        'EVCONTEXT',
                                        '2'
                                    );
                                    saveWhenAdded = true;
                                }

                                if (!saveWhenAdded) {
                                    throw new ScriptError(
                                        'missing_action_type',
                                        'A save action type of beforeSave, afterSave, or afterCommit must be provided.'
                                    );
                                }
                            } else {
                                throw new ScriptError(
                                    'missing_attribute',
                                    'One of the following attributes is required when defining an Object launch point: initializeValue, validateApplication, allowObjectCreation, allowObjectDeletion, or save.'
                                );
                            }
                        } else if (
                            element.launchPointType.toUpperCase() ===
                            'ATTRIBUTE'
                        ) {
                            if (element.objectName === 'undefined') {
                                throw new ScriptError(
                                    'missing_attribute',
                                    'The objectName is a required attribute when defining an Attribute launch point.'
                                );
                            }
                            if (element.attributeName === 'undefined') {
                                throw new ScriptError(
                                    'missing_attribute',
                                    'The attributeName is a required attribute when defining an Attribute launch point.'
                                );
                            }
                            scriptLaunchPoint.setValue(
                                'OBJECTNAME',
                                element.objectName
                            );
                            scriptLaunchPoint.setValue(
                                'ATTRIBUTENAME',
                                element.attributeName
                            );

                            if (
                                typeof element.initializeAccessRestriction !==
                                    'undefined' &&
                                element.initializeAccessRestriction
                            ) {
                                scriptLaunchPoint.setValue(
                                    'ATTRIBUTEEVENT',
                                    '0'
                                );
                            } else if (
                                typeof element.initializeValue !==
                                    'undefined' &&
                                element.initializeValue
                            ) {
                                scriptLaunchPoint.setValue(
                                    'ATTRIBUTEEVENT',
                                    '1'
                                );
                            } else if (
                                typeof element.validate !== 'undefined' &&
                                element.validate
                            ) {
                                scriptLaunchPoint.setValue(
                                    'ATTRIBUTEEVENT',
                                    '2'
                                );
                            } else if (
                                typeof element.retrieveList !== 'undefined' &&
                                element.retrieveList
                            ) {
                                scriptLaunchPoint.setValue(
                                    'ATTRIBUTEEVENT',
                                    '3'
                                );
                            } else if (
                                typeof element.runAction !== 'undefined' &&
                                element.runAction
                            ) {
                                scriptLaunchPoint.setValue(
                                    'ATTRIBUTEEVENT',
                                    '4'
                                );
                            } else {
                                throw new ScriptError(
                                    'missing_attribute',
                                    'One of the following attributes is required when defining an Attribute launch point: initializeAccessRestriction, initializeValue, validate, retrieveList or runAction.'
                                );
                            }
                        } else if (
                            element.launchPointType.toUpperCase() === 'ACTION'
                        ) {
                            if (typeof element.actionName === 'undefined') {
                                throw new ScriptError(
                                    'missing_attribute',
                                    'The actionName is required when defining an Action launch point'
                                );
                            }
                            scriptLaunchPoint.setValue(
                                'ACTIONNAME',
                                element.actionName
                            );
                            setValueIfAvailable(
                                scriptLaunchPoint,
                                'OBJECTNAME',
                                element.objectName
                            );
                        } else if (
                            element.launchPointType.toUpperCase() ===
                            'CUSTOMCONDITION'
                        ) {
                            setValueIfAvailable(
                                scriptLaunchPoint,
                                'OBJECTNAME',
                                element.objectName
                            );
                        } else {
                            throw new ScriptError(
                                'unknown_launchpoint_type',
                                'The launch point type ' +
                                    element.launchPointType +
                                    ' is not supported.'
                            );
                        }

                        if (typeof element.launchPointVars !== 'undefined') {
                            var launchPointVarsSet =
                                scriptLaunchPoint.getMboSet('LAUNCHPOINTVARS');

                            if (launchPointVarsSet.isEmpty()) {
                                throw new ScriptError(
                                    'no_variable_defined',
                                    'A launch point variable has been defined, but there are no script variables defined.'
                                );
                            }

                            element.launchPointVars.forEach(function (
                                elementChild
                            ) {
                                if (
                                    typeof elementChild.varName ===
                                        'undefined' ||
                                    typeof elementChild.varBindingValue ===
                                        'undefined'
                                ) {
                                    throw new ScriptError(
                                        'missing_attribute',
                                        'A varName and varBindingValue are required when defining a launch point variable.'
                                    );
                                }

                                var launchPointVars =
                                    launchPointVarsSet.moveFirst();
                                var found = false;
                                while (launchPointVars && !found) {
                                    if (
                                        launchPointVars
                                            .getString('VARNAME')
                                            .equalsIgnoreCase(
                                                elementChild.varName
                                            )
                                    ) {
                                        launchPointVars.setValue(
                                            'OVERRIDDEN',
                                            true,
                                            MboConstants.NOACCESSCHECK
                                        );
                                        launchPointVars.setValue(
                                            'VARBINDINGVALUE',
                                            elementChild.varBindingValue,
                                            MboConstants.NOACCESSCHECK
                                        );
                                        found = true;
                                    }

                                    launchPointVars =
                                        launchPointVarsSet.moveNext();
                                }

                                if (!found) {
                                    throw new ScriptError(
                                        'no_variable_defined',
                                        'The launch point variable ' +
                                            elementChild.varName +
                                            ' has been defined, but there is no corresponding script variable.'
                                    );
                                }
                            });
                        }
                    } else {
                        throw new ScriptError(
                            'missing_attribute',
                            'The launchPointName and launchPointType are required attributes when defining a script launch point.'
                        );
                    }
                });
            }

            autoScriptSet.save();

            try {
                // save the configuration details.
                service
                    .invokeScript('SHARPTREE.AUTOSCRIPT.STORE')
                    .createOrUpdateScript(
                        scriptConfig.autoscript.toUpperCase(),
                        scriptSource,
                        userInfo.getUserName()
                    );
            } catch (error) {
                log_error(
                    'Error saving script configuration history.' +
                        JSON.stringify(error)
                );
            }

            var messages = scriptConfig.messages;

            if (Array.isArray(messages)) {
                messages.forEach(function (message) {
                    createOrUpdateMessage(message);
                });
            }

            var maxvars = scriptConfig.maxvars;

            if (Array.isArray(maxvars)) {
                maxvars.forEach(function (maxvar) {
                    createOrUpdateMaxVar(maxvar);
                });
            }

            var properties = scriptConfig.properties;

            if (Array.isArray(properties)) {
                properties.forEach(function (property) {
                    createOrUpdateProperty(property);
                });
            }

            var ctx = new HashMap();
            if (scriptConfig.onDeploy) {
                var manager = new ScriptEngineManager();
                var engine = manager.getEngineByName(
                    language ? language : 'javascript'
                );

                var bindings = engine.createBindings();

                if (!bindings.put) {
                    var ctx = new HashMap();
                    ctx.put('service', service);
                    ctx.put('request', request);
                    ctx.put('userInfo', userInfo);
                    ctx.put('onDeploy', true);
                    bindings = new ScriptBinding(ctx);
                } else {
                    bindings.put('service', service);
                    bindings.put('request', request);
                    bindings.put('userInfo', userInfo);
                    bindings.put('onDeploy', true);
                }

                engine
                    .getContext()
                    .setBindings(bindings, ScriptContext.GLOBAL_SCOPE);

                engine.eval(scriptSource);

                try {
                    engine.invokeFunction(scriptConfig.onDeploy);
                } catch (error) {
                    if (error instanceof NoSuchMethodException) {
                        throw new ScriptError(
                            'ondeploy_function_notfound',
                            'The onDeploy function "' +
                                scriptConfig.onDeploy +
                                '" was not found.'
                        );
                    } else if (error instanceof ScriptException) {
                        throw new ScriptError(
                            'error_ondeploy',
                            'Error calling onDeploy function "' +
                                scriptConfig.onDeploy +
                                '" :' +
                                error.message
                        );
                    }
                }
            } else if (
                typeof scriptConfig.onDeployScript !== 'undefined' &&
                scriptConfig.onDeployScript
            ) {
                var deployScript = ScriptCache.getInstance().getScriptInfo(
                    scriptConfig.onDeployScript
                );
                if (deployScript) {
                    var ctx = new HashMap();
                    ctx.put('service', service);
                    ctx.put('request', request);
                    ctx.put('userInfo', userInfo);
                    ctx.put('onDeploy', true);

                    ScriptDriverFactory.getInstance()
                        .getScriptDriver(deployScript.getName())
                        .runScript(deployScript.getName(), ctx);

                    if (
                        typeof scriptConfig.deleteDeployScript ===
                            'undefined' ||
                        scriptConfig.deleteDeployScript == null ||
                        scriptConfig.deleteDeployScript
                    ) {
                        var deployAutoScriptSet;
                        try {
                            deployAutoScriptSet =
                                MXServer.getMXServer().getMboSet(
                                    'AUTOSCRIPT',
                                    userInfo
                                );
                            var deploySqlf = new SqlFormat('autoscript = :1');
                            deploySqlf.setObject(
                                1,
                                'AUTOSCRIPT',
                                'AUTOSCRIPT',
                                deployScript.getName()
                            );

                            deployAutoScriptSet.setWhere(deploySqlf.format());
                            var deployAutoScript =
                                deployAutoScriptSet.moveFirst();
                            if (deployAutoScript) {
                                deployAutoScript.delete();
                                deployAutoScriptSet.save();
                            }
                        } finally {
                            _close(deployAutoScriptSet);
                        }
                    }
                }
            } else {
                var deployScript = ScriptCache.getInstance().getScriptInfo(
                    scriptConfig.autoscript + '.DEPLOY'
                );
                if (deployScript) {
                    var bulletinBoardSet = MXServer.getMXServer().getMboSet(
                        'BULLETINBOARD',
                        userInfo
                    );

                    try {
                        var bulletinBoard = bulletinBoardSet.add();
                        bulletinBoard.setValue(
                            'SUBJECT',
                            'Deploy script configuration ' +
                                scriptConfig.autoscript
                        );
                        bulletinBoard.setValue(
                            'MESSAGE',
                            'Deployment progress is being tracked in the associated Communication Log.'
                        );
                        var progress = {
                            description:
                                'Deploying script configuration ' +
                                scriptConfig.autoscript,
                            progress: [],
                        };
                        var commlog = bulletinBoard.getMboSet('COMMLOG').add();
                        commlog.setValue(
                            'SENDFROM',
                            service.getProperty('mxe.adminEmail')
                        );
                        commlog.setValue(
                            'MESSAGE',
                            JSON.stringify(progress, null, 4)
                        );
                        var calendar = Calendar.getInstance();
                        calendar.setTime(bulletinBoard.getDate('POSTDATE'));
                        calendar.add(Calendar.MINUTE, 30);
                        bulletinBoard.setValue(
                            'EXPIREDATE',
                            calendar.getTime()
                        );
                        bulletinBoardSet.save();
                        deployId = bulletinBoard.getUniqueIDValue();
                    } finally {
                        _close(bulletinBoardSet);
                    }

                    var updateProgress = function (progress) {
                        if (typeof deployId !== 'undefined') {
                            var bulletinBoardSet;

                            try {
                                bulletinBoardSet =
                                    MXServer.getMXServer().getMboSet(
                                        'BULLETINBOARD',
                                        MXServer.getMXServer().getSystemUserInfo()
                                    );

                                var bulletinBoard =
                                    bulletinBoardSet.getMboForUniqueId(
                                        deployId
                                    );

                                if (bulletinBoard) {
                                    var message = JSON.parse(
                                        bulletinBoard.getString(
                                            'COMMLOG.MESSAGE'
                                        )
                                    );
                                    message.progress.push({
                                        message: progress,
                                        timestamp: Java.type(
                                            'psdi.util.MXFormat'
                                        ).dateTimeToString(
                                            MXServer.getMXServer().getDate()
                                        ),
                                    });

                                    bulletinBoard.setValue(
                                        'COMMLOG.MESSAGE',
                                        JSON.stringify(message, null, 4)
                                    );
                                    bulletinBoardSet.save();
                                } else {
                                    throw Error(
                                        'The script deployment bulletin board record with id ' +
                                            deployId +
                                            ' was not found. Cancelling deployment.'
                                    );
                                }
                            } catch (error) {
                                Java.type('java.lang.System').out.println(
                                    'Error updating progress: ' + error
                                );
                                throw error;
                            } finally {
                                if (bulletinBoardSet) {
                                    bulletinBoardSet.cleanup();
                                    bulletinBoardSet.close();
                                }
                            }
                        }
                    };

                    var ctx = new HashMap();
                    ctx.put('service', service);
                    ctx.put('request', request);
                    ctx.put('userInfo', userInfo);
                    ctx.put('onDeploy', true);
                    ctx.put('updateProgress', updateProgress);

                    var backgroundUserInfo = userInfo;
                    var ScriptDeployRunner = Java.extend(Runnable, {
                        run: function () {
                            var bulletinBoardSet =
                                MXServer.getMXServer().getMboSet(
                                    'BULLETINBOARD',
                                    backgroundUserInfo
                                );

                            try {
                                ScriptDriverFactory.getInstance()
                                    .getScriptDriver(deployScript.getName())
                                    .runScript(deployScript.getName(), ctx);

                                var bulletinBoard =
                                    bulletinBoardSet.getMboForUniqueId(
                                        deployId
                                    );
                                if (bulletinBoard) {
                                    bulletinBoard.delete();
                                    bulletinBoardSet.save();
                                }
                            } catch (error) {
                                var bulletinBoard =
                                    bulletinBoardSet.getMboForUniqueId(
                                        deployId
                                    );
                                if (bulletinBoard) {
                                    var progress = JSON.parse(
                                        bulletinBoard.getString(
                                            'COMMLOG.MESSAGE'
                                        )
                                    );

                                    if (
                                        typeof error.getErrorGroup !==
                                            'undefined' &&
                                        error.getErrorGroup() == 'script' &&
                                        error.getErrorKey() ==
                                            'errorrunningscript'
                                    ) {
                                        progress.error =
                                            Java.type(
                                                'psdi.util.MXExceptionMediator'
                                            ).getMessage(
                                                error.getDetail(),
                                                MXServer.getMXServer().getBaseLang()
                                            ) +
                                            ' of script ' +
                                            error.getParameters()[0];
                                    } else {
                                        if (
                                            typeof error.printStackTrace ===
                                            'function'
                                        ) {
                                            error.printStackTrace();
                                        }
                                        progress.error = error.getMessage();
                                    }

                                    bulletinBoard.setValue(
                                        'STATUS',
                                        'REJECTED'
                                    );
                                    bulletinBoard.setValue(
                                        'COMMLOG.MESSAGE',
                                        JSON.stringify(progress, null, 4)
                                    );
                                    bulletinBoardSet.save();
                                }

                                Java.type('java.lang.System').out.println(
                                    error
                                );
                                if (typeof service !== 'undefined') {
                                    service.log_error(
                                        'Script Deployment Error',
                                        error
                                    );
                                }
                            } finally {
                                _close(bulletinBoardSet);

                                // remove the deploy script.
                                if (
                                    typeof scriptConfig.deleteDeployScript ===
                                        'undefined' ||
                                    scriptConfig.deleteDeployScript == null ||
                                    scriptConfig.deleteDeployScript
                                ) {
                                    var deployAutoScriptSet;
                                    try {
                                        deployAutoScriptSet =
                                            MXServer.getMXServer().getMboSet(
                                                'AUTOSCRIPT',
                                                MXServer.getMXServer().getSystemUserInfo()
                                            );
                                        var deploySqlf = new SqlFormat(
                                            'autoscript = :1'
                                        );
                                        deploySqlf.setObject(
                                            1,
                                            'AUTOSCRIPT',
                                            'AUTOSCRIPT',
                                            deployScript.getName()
                                        );

                                        deployAutoScriptSet.setWhere(
                                            deploySqlf.format()
                                        );
                                        var deployAutoScript =
                                            deployAutoScriptSet.moveFirst();
                                        if (deployAutoScript) {
                                            deployAutoScript.delete();
                                            deployAutoScriptSet.save();
                                        }
                                    } finally {
                                        _close(deployAutoScriptSet);
                                    }
                                }
                            }
                        },
                    });

                    var scriptDeployRunner = new Thread(
                        new ScriptDeployRunner()
                    );
                    scriptDeployRunner.start();

                    result = getDeploymentResult(deployId);
                    if (result.deploying) {
                        result.deployid = deployId;
                    }
                    result.scriptName = scriptConfig.autoscript;
                    return result;
                }
            }
        } finally {
            _close(autoScriptSet);
        }

        return result;
    } else {
        throw new ScriptError(
            'config_not_found',
            'Configuration variable scriptConfig was not found in the script.'
        );
    }
}

function getDeploymentResult(deployId) {
    try {
        var bulletinBoardSet = MXServer.getMXServer().getMboSet(
            'BULLETINBOARD',
            userInfo
        );
        var entry = bulletinBoardSet.getMboForUniqueId(deployId);

        if (entry) {
            var message = JSON.parse(entry.getString('COMMLOG.MESSAGE'));
            if (entry.getString('STATUS') == 'REJECTED') {
                message.status = 'error';
                message.error = JSON.parse(
                    entry.getString('COMMLOG.MESSAGE')
                ).error;
                message.deploying = false;
                return message;
            } else {
                message.deploying = true;
                message.status = 'success';
                return message;
            }
        } else {
            return { deploying: false };
        }
    } finally {
        _close(bulletinBoardSet);
    }
}

function setValueIfAvailable(mbo, attribute, value) {
    if (
        typeof value !== 'undefined' &&
        mbo.getMboValue(attribute).isFlagSet(MboConstants.READONLY) == false
    ) {
        mbo.setValue(attribute, value);
    }
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

function getConfigFromScript(scriptSource, languageHint) {
    if (scriptSource) {
        if (languageHint === 'python' || languageHint === 'jython') {
            // var regex = / *scriptConfig.*"""((.|\n|\r)*)"""/gm;
            var regex = /^(?!#).*scriptConfig.*"""(.|\n|\r)*?"""/gm;
            var found = scriptSource.match(regex);
            if (found && found.length == 1) {
                var config = found[0];
                config = config
                    .trim()
                    .substring(config.indexOf('{'), config.length - 3);
                return JSON.parse(config);
            } else {
                throw new ScriptError(
                    'config_not_found',
                    'Configuration variable scriptConfig was not found in the script.'
                );
            }
        } else {
            var ast;
            try {
                ast = parse(scriptSource);
            } catch (error) {
                // attempt to parse python script
                try {
                    return getConfigFromPythonScript(scriptSource);
                } catch (error) {
                    log_error(JSON.stringify(error));
                    throw new ScriptError(
                        'parsing_error',
                        'Error parsing script, please see log for details.'
                    );
                }
            }
            if (ast.type === 'Program' && ast.body) {
                var result;
                ast.body.forEach(function (element) {
                    if (element.type === 'VariableDeclaration') {
                        if (element.declarations) {
                            element.declarations.forEach(function (
                                declaration
                            ) {
                                if (
                                    declaration.id &&
                                    declaration.id.type === 'Identifier' &&
                                    declaration.id.name === 'scriptConfig'
                                ) {
                                    result = astToJavaScript(declaration.init);
                                }
                            });
                        }
                    }
                });

                if (result) {
                    return result;
                } else {
                    throw new ScriptError(
                        'config_not_found',
                        'Configuration variable scriptConfig was not found in the script.'
                    );
                }
            } else {
                throw new ScriptError(
                    'script_wrong_type',
                    'The script must be of type Program and have a body to be deployed.'
                );
            }
        }
    } else {
        throw new ScriptError(
            'no_script_source',
            'The script source is required to deploy the script.'
        );
    }
}

function getConfigFromPythonScript(scriptSource) {
    var regex = /^(?!#).*scriptConfig.*"""(.|\n|\r)*?"""/gm;
    var found = scriptSource.match(regex);
    if (found && found.length == 1) {
        var config = found[0];
        config = config
            .trim()
            .substring(config.indexOf('{'), config.length - 3);
        return JSON.parse(config);
    } else {
        throw new ScriptError(
            'config_not_found',
            'Configuration variable scriptConfig was not found in the script.'
        );
    }
}

function createOrUpdateProperty(property) {
    if (typeof property.propName === 'undefined' || !property.propName) {
        throw new ScriptError(
            'message_missing_varname',
            'The property record is missing the required property "propName"'
        );
    }

    var maxPropSet;
    try {
        maxPropSet = MXServer.getMXServer().getMboSet(
            'MAXPROP',
            MXServer.getMXServer().getSystemUserInfo()
        );
        var sqlf = new SqlFormat('propname = :1');
        sqlf.setObject(1, 'MAXPROP', 'PROPNAME', property.propName);
        maxPropSet.setWhere(sqlf.format());

        if (property.delete) {
            if (!maxPropSet.isEmpty()) {
                maxPropSet.moveFirst().delete();
            }
        } else {
            var maxProp;
            if (maxPropSet.isEmpty()) {
                maxProp = maxPropSet.add();
                maxProp.setValue('PROPNAME', property.propName);
            } else {
                maxProp = maxPropSet.moveFirst();
            }

            if (typeof property.secureLevel !== 'undefined') {
                maxProp.setValue('SECURELEVEL', property.secureLevel);
            }

            if (typeof property.maxType !== 'undefined') {
                maxProp.setValue('MAXTYPE', property.maxType);
            }

            if (
                typeof property.description !== 'undefined' &&
                property.description
            ) {
                maxProp.setValue('DESCRIPTION', property.description);
            }

            if (typeof property.encrypted !== 'undefined') {
                maxProp.setValue('ENCRYPTED', property.encrypted);
            }

            if (typeof property.masked !== 'undefined') {
                maxProp.setValue('MASKED', property.masked);
            }

            if (typeof property.globalOnly !== 'undefined') {
                maxProp.setValue('GLOBALONLY', property.globalOnly);
            }

            if (typeof property.onlineChanges !== 'undefined') {
                maxProp.setValue('ONLINECHANGES', property.onlineChanges);
            }

            if (typeof property.liveRefresh !== 'undefined') {
                maxProp.setValue('LIVEREFRESH', property.liveRefresh);
            }

            if (typeof property.domainId !== 'undefined') {
                maxProp.setValue('DOMAINID', property.domainId);
            } else {
                maxProp.setValueNull('DOMAINID');
            }

            if (typeof property.nullsAllowed !== 'undefined') {
                maxProp.setValue('NULLSALLOWED', property.nullsAllowed);
            }

            var propValueSet = maxProp.getMboSet('MAXPROPVALUE');
            var propValue;

            if (propValueSet.isEmpty()) {
                propValue = propValueSet.add();
            } else {
                propValue = propValueSet.moveFirst();
            }

            var toBeAdded = propValue.toBeAdded();

            if (
                typeof property.propValue !== 'undefined' &&
                property.propValue
            ) {
                propValue.setValue(
                    'PROPVALUE',
                    property.propValue,
                    MboConstants.NOACCESSCHECK
                );
            }
        }

        maxPropSet.save();

        if (
            toBeAdded &&
            typeof property.initialPropValue !== 'undefined' &&
            property.initialPropValue
        ) {
            var id = maxProp.getUniqueIDValue();
            maxPropSet.reset();
            maxPropSet
                .getMboForUniqueId(id)
                .getMboSet('MAXPROPVALUE')
                .moveFirst()
                .setValue(
                    'PROPVALUE',
                    property.initialPropValue,
                    MboConstants.NOACCESSCHECK
                );

            // refresh the properties so the current value is available.
            maxPropSet.save();
        }

        MXServer.getMXServer().reloadMaximoCache(
            'MAXPROP',
            property.propName,
            true
        );
    } finally {
        _close(maxPropSet);
    }
}

function createOrUpdateMaxVar(maxvar) {
    if (typeof maxvar.varName === 'undefined' || !maxvar.varName) {
        throw new ScriptError(
            'message_missing_varname',
            'The maxvar record is missing the required property "varName"'
        );
    } else {
        maxvar.varName = maxvar.varName.toUpperCase();
    }

    if (typeof maxvar.varType === 'undefined' || !maxvar.varType) {
        throw new ScriptError(
            'message_missing_vartype',
            'The maxvar record is missing the required property "varType"'
        );
    } else {
        maxvar.varType = maxvar.varType.toUpperCase();
    }

    var maxvarTypeSet;
    try {
        maxvarTypeSet = MXServer.getMXServer().getMboSet(
            'MAXVARTYPE',
            MXServer.getMXServer().getSystemUserInfo()
        );

        var sqlf = new SqlFormat('varname = :1');
        sqlf.setObject(1, 'MAXVARTYPE', 'VARNAME', maxvar.varName);

        maxvarTypeSet.setWhere(sqlf.format());
        var maxvarType;

        if (typeof maxvar.delete !== 'undefined' && maxvar.delete) {
            if (!maxvarTypeSet.isEmpty()) {
                var maxvarType = maxvarTypeSet.moveFirst();
                maxvarType.getMboSet('MAXVARS').deleteAll();
                maxvarType.delete();
            }
        } else {
            if (maxvarTypeSet.isEmpty()) {
                maxvarType = maxvarTypeSet.add();
                maxvarType.setValue('VARNAME', maxvar.varName);
                maxvarType.setValue('VARTYPE', maxvar.varType);
                var id = maxvarType.getUniqueIDValue();
                maxvarTypeSet.save();
                maxvarTypeSet.reset();
                maxvarType = maxvarTypeSet.getMboForUniqueId(id);
            } else {
                maxvarType = maxvarTypeSet.moveFirst();
            }

            if (
                typeof maxvar.defaultValue !== 'undefined' &&
                maxvar.defaultValue
            ) {
                maxvarType.setValue('DEFAULTVALUE', maxvar.defaultValue);
            } else {
                maxvarType.setValueNull('DEFAULTVALUE');
            }

            if (
                typeof maxvar.description !== 'undefined' &&
                maxvar.description
            ) {
                maxvarType.setValue('DESCRIPTION', maxvar.description);
            } else {
                maxvarType.setValueNull('DESCRIPTION');
            }

            var maxvarsValueSet = maxvarType.getMboSet('MAXVARS');
            var maxvarsValue;
            if (maxvarsValueSet.isEmpty()) {
                maxvarsValue = maxvarsValueSet.add();
                maxvarsValue.setValue('VARNAME', maxvar.varName);
                maxvarsValue.setValue('VARTYPE', maxvar.varType);

                if (typeof maxvar.orgId !== 'undefined' && maxvar.orgId) {
                    maxvarsValue.setValue('ORGID', maxvar.orgId);
                }

                if (typeof maxvar.siteId !== 'undefined' && maxvar.siteId) {
                    maxvarsValue.setValue('SITEID', maxvar.siteId);
                }
            } else {
                maxvarsValue = maxvarsValueSet.moveFirst();
            }

            if (typeof maxvar.varValue !== 'undefined') {
                maxvarsValue.setValue('VARVALUE', maxvar.varValue);
            } else {
                maxvarsValue.setValueNull('VARVALUE');
            }
        }

        maxvarTypeSet.save();
    } finally {
        _close(maxvarTypeSet);
    }
}

function createOrUpdateMessage(message) {
    if (
        typeof message.msgGroup === 'undefined' ||
        !message.msgGroup ||
        typeof message.msgKey === 'undefined' ||
        !message.msgKey
    ) {
        throw new ScriptError(
            'message_missing_group_or_key',
            'The message: \n' +
                JSON.stringify(message, null, 4) +
                '\nis missing either a msgKey or msgGroupp value.'
        );
    }

    if (typeof message.value === 'undefined' || !message.value) {
        throw new ScriptError(
            'message_missing_value',
            'The message: ' +
                message.msgGroup +
                ':' +
                message.msgKey +
                '\nis missing a message value.'
        );
    }

    if (typeof message.prefix === 'undefined' || !message.prefix) {
        message.prefix = 'BMXZZ';
    }

    if (typeof message.suffix === 'undefined' || !message.suffix) {
        message.suffix = 'E';
    }

    if (
        typeof message.displayMethod === 'undefined' ||
        !message.displayMethod
    ) {
        message.displayMethod = 'MSGBOX';
    }

    if (typeof message.value === 'undefined' || !message.value) {
        message.displayMethod = ' ';
    }

    var maxMessagesSet;
    try {
        maxMessagesSet = MXServer.getMXServer().getMboSet(
            'MAXMESSAGES',
            MXServer.getMXServer().getSystemUserInfo()
        );

        var sqlf = new SqlFormat('msggroup = :1 and msgkey = :2');
        sqlf.setObject(1, 'MAXMESSAGES', 'MSGGROUP', message.msgGroup);
        sqlf.setObject(2, 'MAXMESSAGES', 'MSGKEY', message.msgKey);

        maxMessagesSet.setWhere(sqlf.format());
        var maxMessage;

        if (typeof message.delete !== 'undefined' && message.delete) {
            if (!maxMessagesSet.isEmpty()) {
                maxMessagesSet.moveFirst().delete();
            }
        } else {
            if (maxMessagesSet.isEmpty()) {
                maxMessage = maxMessagesSet.add();
                maxMessage.setValue('MSGGROUP', message.msgGroup);
                maxMessage.setValue('MSGKEY', message.msgKey);
                maxMessage.setValue('MSGIDPREFIX', message.prefix);
            } else {
                maxMessage = maxMessagesSet.moveFirst();
            }
            maxMessage.setValue('MSGIDSUFFIX', message.suffix);
            maxMessage.setValue('DISPLAYMETHOD', message.displayMethod);
            if (message.value) {
                maxMessage.setValue('VALUE', message.value);
            } else {
                maxMessage.setValueNull('VALUE', ' ');
            }
        }

        maxMessagesSet.save();
    } finally {
        _close(maxMessagesSet);
    }
}

function validateScriptConfig(scriptConfig) {
    if (
        !scriptConfig.autoscript ||
        scriptConfig.autoscript.trim().length === 0
    ) {
        throw new ScriptError(
            'script_name_required',
            'The auto script name (autoscript) is required in the script configuration.'
        );
    }
}

function astToJavaScript(ast) {
    var javaScript = {};

    if (ast.type === 'ObjectExpression' && ast.properties) {
        ast.properties.map(function (property) {
            if (property.value.type == 'Literal') {
                // In some systems the property key name is returned as "name" and in others as value.
                if (typeof property.key.name !== 'undefined') {
                    javaScript[property.key.name] = property.value.value;
                } else {
                    javaScript[property.key.value] = property.value.value;
                }
            } else if (property.value.type == 'ArrayExpression') {
                var child = [];
                property.value.elements.map(function (element) {
                    child.push(astToJavaScript(element));
                });
                javaScript[property.key.value] = child;
            }
        });
    } else if (ast.type === 'Literal' && ast.value) {
        javaScript = JSON.parse(ast.value);
    } else if (ast.type === 'ArrayExpression' && ast.elements) {
        javaScript = [];

        ast.elements.forEach(function (element) {
            if (element.type === 'ObjectExpression' && element.properties) {
                var elementObject = {};
                element.properties.map(function (property) {
                    if (
                        property.value.type == 'Literal' &&
                        property.key.type == 'Identifier'
                    ) {
                        // In some systems the property key name is returned as "name" and in others as value.
                        if (typeof property.key.name !== 'undefined') {
                            javaScript[property.key.name] =
                                property.value.value;
                        } else {
                            javaScript[property.key.value] =
                                property.value.value;
                        }
                    } else if (property.value.type == 'ArrayExpression') {
                        var child = [];
                        elementObject.value.elements.map(function (element) {
                            child.push(astToJavaScript(element));
                        });
                        elementObject[property.key.value] = child;
                    }
                });
                javaScript.push(elementObject);
            }
        });
    }

    return javaScript;
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

function getScriptVersion(scriptName) {
    var mboset;
    try {
        mboset = MXServer.getMXServer().getMboSet('AUTOSCRIPT', userInfo);
        var sqlf = new SqlFormat('autoscript = :1');
        sqlf.setObject(1, 'AUTOSCRIPT', 'AUTOSCRIPT', scriptName);
        mboset.setWhere(sqlf.format());
        if (mboset.isEmpty()) {
            return 'unknown';
        } else {
            return mboset.getMbo(0).getString('VERSION');
        }
    } finally {
        _close(mboset);
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
        } catch (ignore) {
            // ignored
        }
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
