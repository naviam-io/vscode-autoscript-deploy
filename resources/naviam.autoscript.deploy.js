/* eslint-disable no-redeclare */
/* eslint-disable no-undef */
// @ts-nocheck
load('nashorn:parser.js');

var NoSuchMethodException = Java.type('java.lang.NoSuchMethodException');
var Runnable = Java.type('java.lang.Runnable');
var RuntimeException = Java.type('java.lang.RuntimeException');
var Thread = Java.type('java.lang.Thread');

var Calendar = Java.type('java.util.Calendar');
var HashMap = Java.type('java.util.HashMap');

var ScriptContext = Java.type('javax.script.ScriptContext');
var ScriptEngineManager = Java.type('javax.script.ScriptEngineManager');
var ScriptException = Java.type('javax.script.ScriptException');

var ScriptBinding = Java.type('com.ibm.tivoli.maximo.script.ScriptBinding');
var ScriptCache = Java.type('com.ibm.tivoli.maximo.script.ScriptCache');
var ScriptDriverFactory = Java.type('com.ibm.tivoli.maximo.script.ScriptDriverFactory');

var MboConstants = Java.type('psdi.mbo.MboConstants');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');

var MXServer = Java.type('psdi.server.MXServer');

var MXException = Java.type('psdi.util.MXException');

var MXLoggerFactory = Java.type('psdi.util.logging.MXLoggerFactory');

// Global input variables
scriptSource = '';

var LIBRARY_SCRIPT = 'NAVIAM.AUTOSCRIPT.LIBRARY';
var libraryExports = null;

var logger = MXLoggerFactory.getLogger('maximo.naviam.devtools');

if (typeof httpMethod !== 'undefined') {
    main();
}

/** Runs the library script with the given context, which it reads its input from and writes its output to. */
function runLibrary(context) {
    if (!ScriptCache.getInstance().getScriptInfo(LIBRARY_SCRIPT)) {
        throw new ScriptError('no_library_script', 'The ' + LIBRARY_SCRIPT + ' script is not installed. Deploy the Maximo Development Tools scripts, then try again.');
    }
    ScriptDriverFactory.getInstance().getScriptDriver(LIBRARY_SCRIPT).runScript(LIBRARY_SCRIPT, context);
    return context;
}

/** The functions the library script shares through its NaviamAutoscriptLibrary global. */
function library() {
    if (!libraryExports) {
        libraryExports = runLibrary(new HashMap()).get('NaviamAutoscriptLibrary');
    }
    return libraryExports;
}

function main() {
    var response = {};
    try {
        checkPermissions('NAVIAM_UTILS', 'DEPLOYSCRIPT');

        var action;

        if (typeof requestBody !== 'undefined') {
            action = getRequestAction();

            if (httpMethod != 'POST') {
                throw new ScriptError('only_post_supported', 'Only the HTTP POST method is supported when deploying automation scripts.');
            }
            scriptSource = requestBody;
            if (!scriptSource) {
                throw new ScriptError('no_script_source', 'A script source must be the request body.');
            }

            if (action && action.startsWith('source')) {
                scriptSource = requestBody;
                if (!scriptSource) {
                    throw new ScriptError('no_script_source', 'A script source must be the request body.');
                }

                var scriptConfig = getConfigFromScript(scriptSource, action.split('/')[1]);

                var autoScriptSet;
                try {
                    autoScriptSet = autoScriptSetFor(scriptConfig.autoscript, userInfo);
                    response = {};
                    response.source = autoScriptSet.isEmpty() ? '' : autoScriptSet.getMbo(0).getString('SOURCE');
                    responseBody = JSON.stringify(response);
                    return;
                } finally {
                    _close(autoScriptSet);
                }
            } else if (action && action.startsWith('snapshots/')) {
                responseBody = JSON.stringify(runSnapshotRequest(action.substring('snapshots/'.length), requestBody));
                return;
            } else if (action && action == 'config') {
                var configContext = new HashMap();
                configContext.put('requestBody', requestBody);
                configContext.put('request', request);
                configContext.put('userInfo', userInfo);
                configContext.put('service', service);
                runLibrary(configContext);
                return;
            } else if (action && action.startsWith('deployscript')) {
                responseBody = JSON.stringify(runDeployScript(scriptSource, action.split('/')[1]));
                return;
            }
        } else if (typeof request !== 'undefined' && typeof httpMethod !== 'undefined') {
            if (httpMethod === 'GET') {
                if (request.getQueryParam('deployId')) {
                    responseBody = JSON.stringify(getDeploymentResult(request.getQueryParam('deployId')));
                    return;
                } else {
                    action = getRequestAction();
                    if (action) {
                        if (action.startsWith('version')) {
                            var response = {
                                version: getScriptVersion('NAVIAM.AUTOSCRIPT.DEPLOY')
                            };
                            responseBody = JSON.stringify(response);
                            return;
                        }
                    }
                }
            } else if (httpMethod == 'PUT') {
                if (request.getQueryParam('deployId') && request.getQueryParam('cancel') == 'true') {
                    var bulletinBoardSet = MXServer.getMXServer().getMboSet('BULLETINBOARD', userInfo);
                    try {
                        var bulletinBoard = bulletinBoardSet.getMboForUniqueId(request.getQueryParam('deployId'));
                        if (bulletinBoard) {
                            bulletinBoard.delete();
                            bulletinBoardSet.save();
                        }
                        responseBody = JSON.stringify({
                            deploying: false,
                            status: 'success'
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
                response.reason = error.getCause().getErrorGroup() + '_' + error.getCause().getErrorKey();
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

/**
 * Asks the library about retained values snapshots that an earlier deployment left behind: "list"
 * is read only, "discard" deletes the DOCINFO rows the user chose not to keep. This is the
 * pre-flight the client makes before a deployment starts, because the deployment itself cannot ask
 * anything. See docs/modules/nashorn-library.md.
 *
 * @param {string} snapshotAction either 'list' or 'discard'
 * @param {string} body the deployment payload for 'list', or {"keys": [...]} for 'discard'
 * @returns {object} the library's answer
 */
function runSnapshotRequest(snapshotAction, body) {
    if (snapshotAction !== 'list' && snapshotAction !== 'discard') {
        throw new ScriptError('unsupported_snapshot_action', 'Unsupported retained values snapshot action "' + snapshotAction + '".');
    }

    var payload = body && String(body).trim().length > 0 ? JSON.parse(body) : {};
    var libraryRequest =
        snapshotAction === 'list' ? { action: 'list', payload: payload } : { action: 'discard', keys: payload.keys };

    return JSON.parse(String(library().handleSnapshotRequest(JSON.stringify(libraryRequest))));
}

/**
 * Deploys a script, runs it once and then removes it again.
 *
 * This is the "deployScript" entry kind of a deployment manifest: a one-off script that performs
 * work against Maximo and is not meant to remain installed. It runs synchronously so the caller
 * learns whether it succeeded, and it is removed whether it succeeded or failed.
 *
 * @param {string} scriptSource the source of the script to run
 * @param {string} [language] the script language; javascript when not given
 * @returns {object} the result of the run
 */
function runDeployScript(scriptSource, language) {
    var scriptConfig = getConfigFromScript(scriptSource, language);
    validateScriptConfig(scriptConfig);

    // Maximo stores and keys automation scripts by their upper-cased name, so the name declared in
    // the script has to be normalised before it is used to look the script up or to delete it.
    var scriptName = String(scriptConfig.autoscript).toUpperCase();

    if (scriptConfig._delete === true) {
        throw new ScriptError(
            'invalid_deploy_script',
            'The deploy script ' + scriptName + ' declares "_delete". A deploy script is removed once it has run, so it cannot also delete itself.'
        );
    }

    // A companion deploy script makes the deployment asynchronous, which would leave this function
    // running and then deleting the script while the background deployment is still using it.
    if (ScriptCache.getInstance().getScriptInfo(scriptName + '.DEPLOY')) {
        throw new ScriptError(
            'invalid_deploy_script',
            'The deploy script ' + scriptName + ' has a companion deploy script, which is not supported: a deploy script is itself run once and removed.'
        );
    }

    var result = { scriptName: scriptName, executed: false };

    try {
        var deployResult = deployParsedScript(scriptConfig, scriptSource, language);

        if (deployResult && deployResult.status === 'error') {
            return deployResult;
        }

        var scriptInfo = ScriptCache.getInstance().getScriptInfo(scriptName);

        if (!scriptInfo) {
            throw new ScriptError('deploy_script_not_found', 'The deploy script ' + scriptName + ' was not found after it was installed.');
        }

        runAutoScript(scriptInfo.getName(), deployContext());

        result.executed = true;
        result.status = 'success';
    } finally {
        // The script is temporary, so it is removed however it ended; leaving a half-working one-off
        // script installed is worse than not having run it.
        deleteAutoScript(scriptName, userInfo);
    }

    return result;
}

/**
 * Deletes an automation script by name, if it exists.
 *
 * @param {string} scriptName the name of the script to delete
 * @param {object} withUserInfo the user info to delete it with
 */
function deleteAutoScript(scriptName, withUserInfo) {
    var autoScriptSet;
    try {
        autoScriptSet = autoScriptSetFor(scriptName, withUserInfo);
        var autoScript = autoScriptSet.moveFirst();
        if (autoScript) {
            autoScript.delete();
            autoScriptSet.save();
        }
    } finally {
        _close(autoScriptSet);
    }
}

/**
 * An AUTOSCRIPT set narrowed to a single script by name.
 *
 * @param {string} scriptName the name of the script
 * @param {object} withUserInfo the user info to read it with
 * @returns {object} the set, which the caller closes
 */
function autoScriptSetFor(scriptName, withUserInfo) {
    var autoScriptSet = MXServer.getMXServer().getMboSet('AUTOSCRIPT', withUserInfo);
    var sqlf = new SqlFormat('autoscript = :1');
    sqlf.setObject(1, 'AUTOSCRIPT', 'AUTOSCRIPT', scriptName);
    autoScriptSet.setWhere(sqlf.format());
    return autoScriptSet;
}

/**
 * The context a script invoked as part of a deployment is given.
 *
 * @returns {object} a new context
 */
function deployContext() {
    var ctx = new HashMap();
    ctx.put('service', service);
    ctx.put('request', request);
    ctx.put('userInfo', userInfo);
    ctx.put('onDeploy', true);
    return ctx;
}

/**
 * Runs an installed automation script by name.
 *
 * @param {string} scriptName the name of the script to run
 * @param {object} ctx the context to run it with
 */
function runAutoScript(scriptName, ctx) {
    ScriptDriverFactory.getInstance().getScriptDriver(scriptName).runScript(scriptName, ctx);
}

/**
 * Deploys a script from its source.
 *
 * @param {string} scriptSource the source of the script to deploy
 * @param {string} [language] the script language; javascript when not given
 * @returns {object} the result of the deployment
 */
function deployScript(scriptSource, language) {
    var scriptConfig = getConfigFromScript(scriptSource, language);
    validateScriptConfig(scriptConfig);

    return deployParsedScript(scriptConfig, scriptSource, language);
}

/**
 * Deploys a script whose configuration has already been read and validated.
 *
 * Kept apart from deployScript so that a caller which has the configuration in hand, as
 * runDeployScript does, does not have to parse the source a second time.
 *
 * @param {object} scriptConfig the configuration declared by the script
 * @param {string} scriptSource the source of the script to deploy
 * @param {string} [language] the script language; javascript when not given
 * @returns {object} the result of the deployment
 */
function deployParsedScript(scriptConfig, scriptSource, language) {
    var result = { scriptName: scriptConfig.autoscript };
    var autoScriptSet;

    try {
        autoScriptSet = autoScriptSetFor(scriptConfig.autoscript, userInfo);

        // Deleting is checked before the script is looked up, because a request to delete a script
        // that is not there has to do nothing. Taking the branch below would add the script and
        // then deploy the deletion request itself as the source of the very script it asks to
        // remove.
        if (scriptConfig._delete === true) {
            if (!autoScriptSet.isEmpty()) {
                autoScriptSet.getMbo(0).delete();
                autoScriptSet.save();
            }

            result.deploying = false;
            result.deleted = true;
            result.status = 'success';
            return result;
        }

        var autoscript;
        var warnings = [];

        if (autoScriptSet.isEmpty()) {
            autoscript = autoScriptSet.add();
            autoscript.setValue('AUTOSCRIPT', scriptConfig.autoscript);
            autoscript.setValue('SCRIPTLANGUAGE', language ? language : 'javascript');
            autoscript.setValue('ACTIVE', true);
        } else {
            autoscript = autoScriptSet.getMbo(0);
        }

        autoscript.setValue('SOURCE', scriptSource);

        var children = resetScriptChildren(autoScriptSet, autoscript);

        applyScriptAttributes(children.autoscript, scriptConfig);
        applyScriptVariables(children.autoScriptVarsSet, scriptConfig, warnings);
        applyLaunchPoints(children.scriptLaunchPointSet, scriptConfig);

        autoScriptSet.save();

        saveScriptHistory(scriptConfig, scriptSource);
        applyLegacyConfiguration(scriptConfig);

        var backgroundResult = runPostDeploy(scriptConfig, scriptSource, language);

        if (backgroundResult) {
            backgroundResult.warnings = warnings;
            return backgroundResult;
        }
        result.warnings = warnings;
    } finally {
        _close(autoScriptSet);
    }

    return result;
}

/**
 * Removes the launch points and variables of a script so that they are recreated from the
 * configuration rather than merged into what was there before.
 *
 * The launch points go first because a launch point variable refers to a script variable, and each
 * removal is saved and the script refetched, as the sets are stale once their parent is saved.
 *
 * @param {object} autoScriptSet the set holding the script
 * @param {object} autoscript the script being deployed
 * @returns {object} the refetched script and its two empty child sets
 */
function resetScriptChildren(autoScriptSet, autoscript) {
    var autoScriptId = autoscript.getUniqueIDValue();

    autoscript.getMboSet('SCRIPTLAUNCHPOINT').deleteAll();
    autoScriptSet.save();

    autoScriptSet.reset();
    autoscript = autoScriptSet.getMboForUniqueId(autoScriptId);

    autoscript.getMboSet('AUTOSCRIPTVARS').deleteAll();
    autoScriptSet.save();

    autoScriptSet.reset();
    autoscript = autoScriptSet.getMboForUniqueId(autoScriptId);

    return {
        autoscript: autoscript,
        scriptLaunchPointSet: autoscript.getMboSet('SCRIPTLAUNCHPOINT'),
        autoScriptVarsSet: autoscript.getMboSet('AUTOSCRIPTVARS')
    };
}

/**
 * Applies the configuration to the script record itself.
 *
 * @param {object} autoscript the script being deployed
 * @param {object} scriptConfig the configuration declared by the script
 */
function applyScriptAttributes(autoscript, scriptConfig) {
    setValueIfAvailable(autoscript, 'DESCRIPTION', scriptConfig.description);
    setValueIfAvailable(autoscript, 'VERSION', scriptConfig.version);
    setValueIfAvailable(autoscript, 'ACTIVE', scriptConfig.active);
    setValueIfAvailable(autoscript, 'LOGLEVEL', scriptConfig.logLevel);

    if (typeof scriptConfig.allowInvokingScriptFunctions === 'undefined' || scriptConfig.allowInvokingScriptFunctions === null) {
        // A bean script is called by name from a screen, which only works when the script is
        // marked as an interface, so the naming convention stands in for the unset flag.
        if (scriptConfig.autoscript.toUpperCase().startsWith('APPBEAN') || scriptConfig.autoscript.toUpperCase().startsWith('DATABEAN')) {
            setValueIfAvailable(autoscript, 'INTERFACE', true);
        }
    } else {
        setValueIfAvailable(autoscript, 'INTERFACE', scriptConfig.allowInvokingScriptFunctions);
    }
}

/**
 * Creates the script variables declared by the configuration.
 *
 * @param {object} autoScriptVarsSet the empty variable set of the script
 * @param {object} scriptConfig the configuration declared by the script
 * @param {Array} warnings collects the warnings returned to the client
 */
function applyScriptVariables(autoScriptVarsSet, scriptConfig, warnings) {
    if (typeof scriptConfig.autoScriptVars === 'undefined') {
        return;
    }

    scriptConfig.autoScriptVars.forEach(function (element) {
        var varName = element.varName || element.varname;

        if (element.varname) {
            var warning = 'The script variable ' + element.varname + ' uses the deprecated property "varname", rename it to "varName".';
            warnings.push(warning);
        }

        if (!varName) {
            throw new ScriptError('missing_attribute', 'A varName is required when defining a script variable.');
        }

        var varBindingType = element.varBindingType || 'LITERAL';
        var varType = element.varType || 'IN';

        var autoScriptVar = autoScriptVarsSet.add();
        autoScriptVar.setValue('VARNAME', varName);
        setValueIfAvailable(autoScriptVar, 'DESCRIPTION', element.description);
        setValueIfAvailable(autoScriptVar, 'VARBINDINGTYPE', varBindingType);
        setValueIfAvailable(autoScriptVar, 'VARTYPE', varType);
        setValueIfAvailable(autoScriptVar, 'ALLOWOVERRIDE', element.allowOverride);

        if (varBindingType.toUpperCase() !== 'LITERAL' && varType.toUpperCase() !== 'IN') {
            setValueIfAvailable(autoScriptVar, 'NOVALIDATION', element.noValidation);
            setValueIfAvailable(autoScriptVar, 'NOACCESSCHECK', element.noAccessCheck);
            setValueIfAvailable(autoScriptVar, 'NOACTION', element.noAction);
        }

        setValueIfAvailable(autoScriptVar, 'LITERALDATATYPE', element.literalDataType);
        setValueIfAvailable(autoScriptVar, 'VARBINDINGVALUE', element.varBindingValue, MboConstants.NOACCESSCHECK);
    });
}

/**
 * Creates the launch points declared by the configuration.
 *
 * @param {object} scriptLaunchPointSet the empty launch point set of the script
 * @param {object} scriptConfig the configuration declared by the script
 */
function applyLaunchPoints(scriptLaunchPointSet, scriptConfig) {
    if (!scriptConfig.scriptLaunchPoints) {
        return;
    }

    scriptConfig.scriptLaunchPoints.forEach(function (element) {
        if (typeof element.launchPointName === 'undefined' || typeof element.launchPointType === 'undefined') {
            throw new ScriptError(
                'missing_attribute',
                'The launchPointName and launchPointType are required attributes when defining a script launch point.'
            );
        }

        var scriptLaunchPoint = scriptLaunchPointSet.add();
        scriptLaunchPoint.setValue('LAUNCHPOINTNAME', element.launchPointName);
        scriptLaunchPoint.setValue('LAUNCHPOINTTYPE', element.launchPointType, MboConstants.NOACCESSCHECK);

        if (typeof element.active !== 'undefined') {
            scriptLaunchPoint.setValue('ACTIVE', element.active);
        } else {
            scriptLaunchPoint.setValue('ACTIVE', true);
        }

        setValueIfAvailable(scriptLaunchPoint, 'DESCRIPTION', element.description);

        var launchPointType = element.launchPointType.toUpperCase();

        if (launchPointType === 'OBJECT') {
            applyObjectLaunchPoint(scriptLaunchPoint, element);
        } else if (launchPointType === 'ATTRIBUTE') {
            applyAttributeLaunchPoint(scriptLaunchPoint, element);
        } else if (launchPointType === 'ACTION') {
            applyActionLaunchPoint(scriptLaunchPoint, element);
        } else if (launchPointType === 'CUSTOMCONDITION') {
            setValueIfAvailable(scriptLaunchPoint, 'OBJECTNAME', element.objectName);
        } else {
            throw new ScriptError('unknown_launchpoint_type', 'The launch point type ' + element.launchPointType + ' is not supported.');
        }

        applyLaunchPointVars(scriptLaunchPoint, element);
    });
}

/**
 * Applies an object launch point definition.
 *
 * @param {object} scriptLaunchPoint the launch point being created
 * @param {object} element the launch point definition
 */
function applyObjectLaunchPoint(scriptLaunchPoint, element) {
    if (typeof element.objectName === 'undefined') {
        throw new ScriptError('missing_attribute', 'The objectName is a required attribute when defining an Object launch point.');
    }

    scriptLaunchPoint.setValue('OBJECTNAME', element.objectName);
    setValueIfAvailable(scriptLaunchPoint, 'CONDITION', element.condition);

    var eventType = objectLaunchPointEventType(element);
    scriptLaunchPoint.setValue('EVENTTYPE', eventType);

    if (eventType !== '4') {
        return;
    }

    objectSaveActions(element).forEach(function (attribute) {
        scriptLaunchPoint.setValue(attribute, true);
    });

    scriptLaunchPoint.setValue('EVCONTEXT', objectSaveEventContext(element));
}

/**
 * Applies an attribute launch point definition.
 *
 * @param {object} scriptLaunchPoint the launch point being created
 * @param {object} element the launch point definition
 */
function applyAttributeLaunchPoint(scriptLaunchPoint, element) {
    if (typeof element.objectName === 'undefined') {
        throw new ScriptError('missing_attribute', 'The objectName is a required attribute when defining an Attribute launch point.');
    }

    if (typeof element.attributeName === 'undefined') {
        throw new ScriptError('missing_attribute', 'The attributeName is a required attribute when defining an Attribute launch point.');
    }

    scriptLaunchPoint.setValue('OBJECTNAME', element.objectName);
    scriptLaunchPoint.setValue('ATTRIBUTENAME', element.attributeName);
    scriptLaunchPoint.setValue('ATTRIBUTEEVENT', attributeLaunchPointEvent(element));
}

/**
 * Applies an action launch point definition.
 *
 * @param {object} scriptLaunchPoint the launch point being created
 * @param {object} element the launch point definition
 */
function applyActionLaunchPoint(scriptLaunchPoint, element) {
    if (typeof element.actionName === 'undefined') {
        throw new ScriptError('missing_attribute', 'The actionName is required when defining an Action launch point');
    }

    scriptLaunchPoint.setValue('ACTIONNAME', element.actionName);
    setValueIfAvailable(scriptLaunchPoint, 'OBJECTNAME', element.objectName);
}

/**
 * Overrides the script variables a launch point binds differently.
 *
 * @param {object} scriptLaunchPoint the launch point being created
 * @param {object} element the launch point definition
 */
function applyLaunchPointVars(scriptLaunchPoint, element) {
    if (typeof element.launchPointVars === 'undefined') {
        return;
    }

    var launchPointVarsSet = scriptLaunchPoint.getMboSet('LAUNCHPOINTVARS');

    if (launchPointVarsSet.isEmpty()) {
        throw new ScriptError('no_variable_defined', 'A launch point variable has been defined, but there are no script variables defined.');
    }

    element.launchPointVars.forEach(function (elementChild) {
        if (typeof elementChild.varName === 'undefined' || typeof elementChild.varBindingValue === 'undefined') {
            throw new ScriptError('missing_attribute', 'A varName and varBindingValue are required when defining a launch point variable.');
        }

        var launchPointVars = launchPointVarsSet.moveFirst();
        var found = false;

        while (launchPointVars && !found) {
            if (launchPointVars.getString('VARNAME').equalsIgnoreCase(elementChild.varName)) {
                launchPointVars.setValue('OVERRIDDEN', true, MboConstants.NOACCESSCHECK);
                launchPointVars.setValue('VARBINDINGVALUE', elementChild.varBindingValue, MboConstants.NOACCESSCHECK);
                found = true;
            }

            launchPointVars = launchPointVarsSet.moveNext();
        }

        if (!found) {
            throw new ScriptError(
                'no_variable_defined',
                'The launch point variable ' + elementChild.varName + ' has been defined, but there is no corresponding script variable.'
            );
        }
    });
}

/**
 * Records the deployed source in the script history, which is best effort: failing to write the
 * history is not a reason to fail a deployment that has already been saved.
 *
 * @param {object} scriptConfig the configuration declared by the script
 * @param {string} scriptSource the source that was deployed
 */
function saveScriptHistory(scriptConfig, scriptSource) {
    try {
        service.invokeScript('NAVIAM.AUTOSCRIPT.STORE').createOrUpdateScript(scriptConfig.autoscript.toUpperCase(), scriptSource, userInfo.getUserName());
    } catch (error) {
        log_error('Error saving script configuration history.' + JSON.stringify(error));
    }
}

/**
 * Applies the messages, maxvars and properties a script configuration may carry.
 *
 * These predate the declarative JSON configuration, which is where this belongs and where the same
 * resources are expressed with a richer schema. They are still honoured so that scripts written
 * against the older form keep deploying, and are kept together here so they can be deprecated as a
 * whole once the JSON configuration covers every case.
 *
 * @param {object} scriptConfig the configuration declared by the script
 */
function applyLegacyConfiguration(scriptConfig) {
    if (Array.isArray(scriptConfig.messages)) {
        scriptConfig.messages.forEach(function (message) {
            createOrUpdateMessage(message);
        });
    }

    if (Array.isArray(scriptConfig.maxvars)) {
        scriptConfig.maxvars.forEach(function (maxvar) {
            createOrUpdateMaxVar(maxvar);
        });
    }

    if (Array.isArray(scriptConfig.properties)) {
        scriptConfig.properties.forEach(function (property) {
            createOrUpdateProperty(property);
        });
    }
}

/**
 * Runs whatever the configuration asks to happen once the script is deployed.
 *
 * A script may name a function in its own source, or another script to run, or rely on the
 * convention of a companion script named after it. Only the last of those runs in the background,
 * and it is the only case that produces a result for the caller to poll.
 *
 * @param {object} scriptConfig the configuration declared by the script
 * @param {string} scriptSource the source that was deployed
 * @param {string} [language] the script language; javascript when not given
 * @returns {object|undefined} the deployment result when the work was started in the background
 */
function runPostDeploy(scriptConfig, scriptSource, language) {
    if (scriptConfig.onDeploy) {
        runOnDeployFunction(scriptConfig, scriptSource, language);
        return undefined;
    }

    if (scriptConfig.onDeployScript) {
        runOnDeployScript(scriptConfig);
        return undefined;
    }

    var companionScript = ScriptCache.getInstance().getScriptInfo(scriptConfig.autoscript + '.DEPLOY');

    if (!companionScript) {
        return undefined;
    }

    return startBackgroundDeploy(scriptConfig, companionScript);
}

/**
 * Calls a function declared in the script that has just been deployed.
 *
 * The source is evaluated in its own engine rather than run as the installed script, so that the
 * function can be called by name.
 *
 * @param {object} scriptConfig the configuration declared by the script
 * @param {string} scriptSource the source that was deployed
 * @param {string} [language] the script language; javascript when not given
 */
function runOnDeployFunction(scriptConfig, scriptSource, language) {
    var engine = new ScriptEngineManager().getEngineByName(language ? language : 'javascript');
    var bindings = engine.createBindings();

    if (!bindings.put) {
        bindings = new ScriptBinding(deployContext());
    } else {
        bindings.put('service', service);
        bindings.put('request', request);
        bindings.put('userInfo', userInfo);
        bindings.put('onDeploy', true);
    }

    engine.getContext().setBindings(bindings, ScriptContext.GLOBAL_SCOPE);
    engine.eval(scriptSource);

    try {
        engine.invokeFunction(scriptConfig.onDeploy);
    } catch (error) {
        if (error instanceof NoSuchMethodException) {
            throw new ScriptError('ondeploy_function_notfound', 'The onDeploy function "' + scriptConfig.onDeploy + '" was not found.');
        } else if (error instanceof ScriptException) {
            throw new ScriptError('error_ondeploy', 'Error calling onDeploy function "' + scriptConfig.onDeploy + '" :' + error.message);
        }
    }
}

/**
 * Runs the separate script the configuration names, and removes it afterwards unless asked not to.
 *
 * @param {object} scriptConfig the configuration declared by the script
 */
function runOnDeployScript(scriptConfig) {
    var companionScript = ScriptCache.getInstance().getScriptInfo(scriptConfig.onDeployScript);

    if (!companionScript) {
        return;
    }

    runAutoScript(companionScript.getName(), deployContext());

    if (shouldDeleteDeployScript(scriptConfig)) {
        deleteAutoScript(companionScript.getName(), userInfo);
    }
}

/**
 * Starts the companion deploy script on a background thread, tracking its progress on a bulletin
 * board entry that the caller polls with the returned deployment id.
 *
 * It runs in the background because a deployment may take longer than the request will wait for,
 * and it reports through the bulletin board because that is readable both by this script and by
 * the extension.
 *
 * @param {object} scriptConfig the configuration declared by the script
 * @param {object} companionScript the script info of the companion deploy script
 * @returns {object} the deployment result, carrying the id to poll
 */
function startBackgroundDeploy(scriptConfig, companionScript) {
    var deployId = createDeploymentTracker(scriptConfig);

    var updateProgress = function (progress) {
        var bulletinBoardSet;

        try {
            bulletinBoardSet = MXServer.getMXServer().getMboSet('BULLETINBOARD', MXServer.getMXServer().getSystemUserInfo());

            var bulletinBoard = bulletinBoardSet.getMboForUniqueId(deployId);

            if (!bulletinBoard) {
                throw Error('The script deployment bulletin board record with id ' + deployId + ' was not found. Cancelling deployment.');
            }

            var message = JSON.parse(bulletinBoard.getString('COMMLOG.MESSAGE'));
            message.progress.push({
                message: progress,
                timestamp: Java.type('psdi.util.MXFormat').dateTimeToString(MXServer.getMXServer().getDate())
            });

            bulletinBoard.setValue('COMMLOG.MESSAGE', JSON.stringify(message, null, 4));
            bulletinBoardSet.save();
        } catch (error) {
            Java.type('java.lang.System').out.println('Error updating progress: ' + error);
            throw error;
        } finally {
            _close(bulletinBoardSet);
        }
    };

    var ctx = deployContext();
    ctx.put('updateProgress', updateProgress);

    var backgroundUserInfo = userInfo;
    var ScriptDeployRunner = Java.extend(Runnable, {
        run: function () {
            var bulletinBoardSet = MXServer.getMXServer().getMboSet('BULLETINBOARD', backgroundUserInfo);

            try {
                runAutoScript(companionScript.getName(), ctx);

                var bulletinBoard = bulletinBoardSet.getMboForUniqueId(deployId);
                if (bulletinBoard) {
                    bulletinBoard.delete();
                    bulletinBoardSet.save();
                }
            } catch (error) {
                recordDeploymentFailure(bulletinBoardSet, deployId, error);
            } finally {
                _close(bulletinBoardSet);

                // remove the deploy script.
                if (shouldDeleteDeployScript(scriptConfig)) {
                    deleteAutoScript(companionScript.getName(), MXServer.getMXServer().getSystemUserInfo());
                }
            }
        }
    });

    new Thread(new ScriptDeployRunner()).start();

    var result = getDeploymentResult(deployId);

    if (result.deploying) {
        result.deployid = deployId;
    }

    result.scriptName = scriptConfig.autoscript;
    return result;
}

/**
 * Creates the bulletin board entry a background deployment reports its progress on.
 *
 * @param {object} scriptConfig the configuration declared by the script
 * @returns {number} the id of the entry
 */
function createDeploymentTracker(scriptConfig) {
    var bulletinBoardSet = MXServer.getMXServer().getMboSet('BULLETINBOARD', userInfo);

    try {
        var bulletinBoard = bulletinBoardSet.add();
        bulletinBoard.setValue('SUBJECT', 'Deploy script configuration ' + scriptConfig.autoscript);
        bulletinBoard.setValue('MESSAGE', 'Deployment progress is being tracked in the associated Communication Log.');

        var progress = {
            description: 'Deploying script configuration ' + scriptConfig.autoscript,
            progress: []
        };

        var commlog = bulletinBoard.getMboSet('COMMLOG').add();
        commlog.setValue('SENDFROM', service.getProperty('mxe.adminEmail'));
        commlog.setValue('MESSAGE', JSON.stringify(progress, null, 4));

        var calendar = Calendar.getInstance();
        calendar.setTime(bulletinBoard.getDate('POSTDATE'));
        calendar.add(Calendar.MINUTE, 30);
        bulletinBoard.setValue('EXPIREDATE', calendar.getTime());

        bulletinBoardSet.save();
        return bulletinBoard.getUniqueIDValue();
    } finally {
        _close(bulletinBoardSet);
    }
}

/**
 * Records why a background deployment failed on its bulletin board entry, so the extension can
 * report it rather than simply stop seeing progress.
 *
 * @param {object} bulletinBoardSet the set holding the entry
 * @param {number} deployId the id of the entry
 * @param {object} error the failure
 */
function recordDeploymentFailure(bulletinBoardSet, deployId, error) {
    var bulletinBoard = bulletinBoardSet.getMboForUniqueId(deployId);

    if (bulletinBoard) {
        var progress = JSON.parse(bulletinBoard.getString('COMMLOG.MESSAGE'));

        if (typeof error.getErrorGroup !== 'undefined' && error.getErrorGroup() == 'script' && error.getErrorKey() == 'errorrunningscript') {
            progress.error =
                Java.type('psdi.util.MXExceptionMediator').getMessage(error.getDetail(), MXServer.getMXServer().getBaseLang()) +
                ' of script ' +
                error.getParameters()[0];
        } else {
            if (typeof error.printStackTrace === 'function') {
                error.printStackTrace();
            }
            progress.error = error.getMessage();
        }

        bulletinBoard.setValue('STATUS', 'REJECTED');
        bulletinBoard.setValue('COMMLOG.MESSAGE', JSON.stringify(progress, null, 4));
        bulletinBoardSet.save();
    }

    Java.type('java.lang.System').out.println(error);
    if (typeof service !== 'undefined') {
        service.log_error('Script Deployment Error', error);
    }
}
function getDeploymentResult(deployId) {
    try {
        var bulletinBoardSet = MXServer.getMXServer().getMboSet('BULLETINBOARD', userInfo);
        var entry = bulletinBoardSet.getMboForUniqueId(deployId);

        if (entry) {
            var message = JSON.parse(entry.getString('COMMLOG.MESSAGE'));
            if (entry.getString('STATUS') == 'REJECTED') {
                message.status = 'error';
                message.error = JSON.parse(entry.getString('COMMLOG.MESSAGE')).error;
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
    if (typeof value !== 'undefined' && mbo.getMboValue(attribute).isFlagSet(MboConstants.READONLY) == false) {
        mbo.setValue(attribute, value);
    }
}

/**
 * The value the first flag that is set maps to, or null when none of them is.
 *
 * @param {object} element the launch point definition
 * @param {Array} flags the candidate flags, in the order they take precedence
 * @returns {string|null} the mapped value
 */
function firstFlagSet(element, flags) {
    for (var index = 0; index < flags.length; index++) {
        if (element[flags[index].flag]) {
            return flags[index].value;
        }
    }

    return null;
}

/**
 * The EVENTTYPE an object launch point fires on.
 *
 * The flags are checked in order and the first one that is set wins, so the order below is part of
 * the contract rather than a detail of how it is written.
 *
 * @param {object} element the launch point definition
 * @returns {string} the Maximo event type code
 */
function objectLaunchPointEventType(element) {
    var eventType = firstFlagSet(element, [
        { flag: 'initializeValue', value: '0' },
        { flag: 'validateApplication', value: '1' },
        { flag: 'allowObjectCreation', value: '2' },
        { flag: 'allowObjectDeletion', value: '3' },
        { flag: 'save', value: '4' }
    ]);

    if (eventType === null) {
        throw new ScriptError(
            'missing_attribute',
            'One of the following attributes is required when defining an Object launch point: initializeValue, validateApplication, allowObjectCreation, allowObjectDeletion, or save.'
        );
    }

    return eventType;
}

/**
 * The attributes of the save actions an object save launch point fires on.
 *
 * Unlike the event flags these are not exclusive, so every one that is set is returned.
 *
 * @param {object} element the launch point definition
 * @returns {Array} the names of the attributes to set
 */
function objectSaveActions(element) {
    var candidates = [
        { flag: 'add', attribute: 'ADD' },
        { flag: 'update', attribute: 'UPDATE' },
        { flag: 'delete', attribute: 'DELETE' }
    ];

    var actions = [];

    for (var index = 0; index < candidates.length; index++) {
        if (element[candidates[index].flag]) {
            actions.push(candidates[index].attribute);
        }
    }

    if (actions.length === 0) {
        throw new ScriptError('missing_save_action', 'At least one object save action of either add, update, or delete must be provided.');
    }

    return actions;
}

/**
 * The EVCONTEXT that says when in the save an object save launch point fires.
 *
 * @param {object} element the launch point definition
 * @returns {string} the Maximo event context code
 */
function objectSaveEventContext(element) {
    var eventContext = firstFlagSet(element, [
        { flag: 'beforeSave', value: '0' },
        { flag: 'afterSave', value: '1' },
        { flag: 'afterCommit', value: '2' }
    ]);

    if (eventContext === null) {
        throw new ScriptError('missing_action_type', 'A save action type of beforeSave, afterSave, or afterCommit must be provided.');
    }

    return eventContext;
}

/**
 * The ATTRIBUTEEVENT an attribute launch point fires on.
 *
 * initializeAccessRestriction is checked before initializeValue, so a launch point that sets both
 * is an access restriction.
 *
 * @param {object} element the launch point definition
 * @returns {string} the Maximo attribute event code
 */
function attributeLaunchPointEvent(element) {
    var attributeEvent = firstFlagSet(element, [
        { flag: 'initializeAccessRestriction', value: '1' },
        { flag: 'initializeValue', value: '0' },
        { flag: 'validate', value: '2' },
        { flag: 'retrieveList', value: '3' },
        { flag: 'runAction', value: '4' }
    ]);

    if (attributeEvent === null) {
        throw new ScriptError(
            'missing_attribute',
            'One of the following attributes is required when defining an Attribute launch point: initializeAccessRestriction, initializeValue, validate, retrieveList or runAction.'
        );
    }

    return attributeEvent;
}

/**
 * Whether a companion deploy script is removed once it has run, which it is unless the
 * configuration says otherwise.
 *
 * @param {object} scriptConfig the script configuration
 * @returns {boolean} true when the companion script is to be deleted
 */
function shouldDeleteDeployScript(scriptConfig) {
    if (typeof scriptConfig.deleteDeployScript === 'undefined' || scriptConfig.deleteDeployScript === null) {
        return true;
    }

    return Boolean(scriptConfig.deleteDeployScript);
}

function checkPermissions(app, optionName) {
    if (!userInfo) {
        throw new ScriptError('no_user_info', 'The userInfo global variable has not been set, therefore the user permissions cannot be verified.');
    }

    if (!MXServer.getMXServer().lookup('SECURITY').getProfile(userInfo).hasAppOption(app, optionName) && !isInAdminGroup()) {
        throw new ScriptError(
            'no_permission',
            'The user ' + userInfo.getUserName() + ' does not have access to the ' + optionName + ' option in the ' + app + ' object structure.'
        );
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

function getConfigFromScript(scriptSource, languageHint) {
    if (!scriptSource) {
        throw new ScriptError('no_script_source', 'The script source is required to deploy the script.');
    }

    if (languageHint === 'python' || languageHint === 'jython') {
        return getConfigFromPythonScript(scriptSource);
    }

    var ast;
    try {
        ast = parse(scriptSource);
    } catch (parsingError) {
        // The language hint is not always right, so a script that is not JavaScript is worth
        // one attempt as Python before the parse is reported as a failure.
        try {
            return getConfigFromPythonScript(scriptSource);
        } catch (ignored) {
            log_error(JSON.stringify(parsingError));
            throw new ScriptError('parsing_error', 'Error parsing script, please see log for details.');
        }
    }

    if (ast.type !== 'Program' || !ast.body) {
        throw new ScriptError('script_wrong_type', 'The script must be of type Program and have a body to be deployed.');
    }

    var configNode = findScriptConfigNode(ast);

    if (!configNode) {
        throw new ScriptError('config_not_found', 'Configuration variable scriptConfig was not found in the script.');
    }

    return astToJavaScript(configNode);
}

function findScriptConfigNode(node) {
    // The configuration is normally a top level declaration, but the generated library script
    // carries it inside a webpack module, so the whole tree is searched in source order.
    if (!node || typeof node !== 'object') {
        return null;
    }

    var configNode = scriptConfigObjectOf(node);

    if (configNode) {
        return configNode;
    }

    var keys = Object.keys(node);

    for (var i = 0; i < keys.length; i++) {
        var child = node[keys[i]];
        var children = Array.isArray(child) ? child : [child];

        for (var j = 0; j < children.length; j++) {
            configNode = findScriptConfigNode(children[j]);

            if (configNode) {
                return configNode;
            }
        }
    }

    return null;
}

function scriptConfigObjectOf(node) {
    var value = null;

    if (node.type === 'VariableDeclarator' && isScriptConfigName(node.id)) {
        value = node.init;
    } else if (node.type === 'AssignmentExpression' && isScriptConfigName(node.left)) {
        value = node.right;
    }

    // Only a non empty object literal is a configuration. A script binds the name scriptConfig for
    // its own purposes too - this script holds the result of a function call in it, the extract
    // script builds one up from an empty object - and those bindings must not be mistaken for one.
    return value && value.type === 'ObjectExpression' && value.properties && value.properties.length > 0 ? value : null;
}

function isScriptConfigName(node) {
    // scriptConfig, obj.scriptConfig and obj['scriptConfig'] all name the configuration.
    if (!node) {
        return false;
    }

    if (node.type === 'Identifier') {
        return node.name === 'scriptConfig';
    }

    if (node.type === 'MemberExpression' && node.property) {
        return (node.computed ? node.property.value : node.property.name) === 'scriptConfig';
    }

    return false;
}

function getConfigFromPythonScript(scriptSource) {
    var regex = /^(?!#).*scriptConfig.*"""(.|\n|\r)*?"""/gm;
    var found = scriptSource.match(regex);
    if (found && found.length == 1) {
        var config = found[0];
        config = config.trim().substring(config.indexOf('{'), config.length - 3);
        return JSON.parse(config);
    } else {
        throw new ScriptError('config_not_found', 'Configuration variable scriptConfig was not found in the script.');
    }
}

/** The value to set on a synonym domain field, see docs/modules/nashorn-library.md. */
function toExternalSynonymValue(domainId, value, mbo) {
    var helpers = library();
    try {
        return helpers.toExternalSynonymValue(domainId, value, mbo);
    } catch (error) {
        var message = error && error.message ? String(error.message) : String(error);
        throw new ScriptError('invalid_synonym_value', message.replace(/^Error: /, ''));
    }
}

function createOrUpdateProperty(property) {
    if (typeof property.propName === 'undefined' || !property.propName) {
        throw new ScriptError('message_missing_varname', 'The property record is missing the required property "propName"');
    }

    var maxPropSet;
    try {
        maxPropSet = MXServer.getMXServer().getMboSet('MAXPROP', MXServer.getMXServer().getSystemUserInfo());
        var sqlf = new SqlFormat('propname = :1');
        sqlf.setObject(1, 'MAXPROP', 'PROPNAME', property.propName);
        maxPropSet.setWhere(sqlf.format());

        if (property.delete) {
            if (!maxPropSet.isEmpty()) {
                maxPropSet.moveFirst().delete();
            }
        } else {
            var maxProp;
            var isNewProperty = maxPropSet.isEmpty();

            if (isNewProperty) {
                maxProp = maxPropSet.add();
                maxProp.setValue('PROPNAME', property.propName);
            } else {
                maxProp = maxPropSet.moveFirst();
            }

            if (typeof property.secureLevel !== 'undefined') {
                maxProp.setValue('SECURELEVEL', toExternalSynonymValue('PROPSECURELEVEL', property.secureLevel, maxProp));
            }

            if (typeof property.maxType !== 'undefined') {
                maxProp.setValue('MAXTYPE', property.maxType);
            }

            if (typeof property.description !== 'undefined' && property.description) {
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

            var propertyValue = null;

            if (typeof property.propValue !== 'undefined' && property.propValue) {
                propertyValue = property.propValue;
            } else if (isNewProperty && typeof property.initialPropValue !== 'undefined' && property.initialPropValue) {
                propertyValue = property.initialPropValue;
            }

            if (propertyValue !== null) {
                maxProp.setValue('DISPPROPVALUE', propertyValue, MboConstants.NOACCESSCHECK);
            }
        }

        maxPropSet.save();

        MXServer.getMXServer().reloadMaximoCache('MAXPROP', property.propName, true);
    } finally {
        _close(maxPropSet);
    }
}

function createOrUpdateMaxVar(maxvar) {
    if (typeof maxvar.varName === 'undefined' || !maxvar.varName) {
        throw new ScriptError('message_missing_varname', 'The maxvar record is missing the required property "varName"');
    } else {
        maxvar.varName = maxvar.varName.toUpperCase();
    }

    if (typeof maxvar.varType === 'undefined' || !maxvar.varType) {
        throw new ScriptError('message_missing_vartype', 'The maxvar record is missing the required property "varType"');
    } else {
        maxvar.varType = maxvar.varType.toUpperCase();
    }

    var maxvarTypeSet;
    try {
        maxvarTypeSet = MXServer.getMXServer().getMboSet('MAXVARTYPE', MXServer.getMXServer().getSystemUserInfo());

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

            if (typeof maxvar.defaultValue !== 'undefined' && maxvar.defaultValue) {
                maxvarType.setValue('DEFAULTVALUE', maxvar.defaultValue);
            } else {
                maxvarType.setValueNull('DEFAULTVALUE');
            }

            if (typeof maxvar.description !== 'undefined' && maxvar.description) {
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
    if (typeof message.msgGroup === 'undefined' || !message.msgGroup || typeof message.msgKey === 'undefined' || !message.msgKey) {
        throw new ScriptError(
            'message_missing_group_or_key',
            'The message: \n' + JSON.stringify(message, null, 4) + '\nis missing either a msgKey or msgGroupp value.'
        );
    }

    if (typeof message.value === 'undefined' || !message.value) {
        throw new ScriptError('message_missing_value', 'The message: ' + message.msgGroup + ':' + message.msgKey + '\nis missing a message value.');
    }

    if (typeof message.prefix === 'undefined' || !message.prefix) {
        message.prefix = 'BMXZZ';
    }

    if (typeof message.suffix === 'undefined' || !message.suffix) {
        message.suffix = 'E';
    }

    if (typeof message.displayMethod === 'undefined' || !message.displayMethod) {
        message.displayMethod = 'MSGBOX';
    }

    if (typeof message.value === 'undefined' || !message.value) {
        message.displayMethod = ' ';
    }

    var maxMessagesSet;
    try {
        maxMessagesSet = MXServer.getMXServer().getMboSet('MAXMESSAGES', MXServer.getMXServer().getSystemUserInfo());

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
    if (!scriptConfig.autoscript || scriptConfig.autoscript.trim().length === 0) {
        throw new ScriptError('script_name_required', 'The auto script name (autoscript) is required in the script configuration.');
    }
}

function astToJavaScript(node) {
    if (!node) {
        return undefined;
    }

    if (node.type === 'ObjectExpression') {
        return (node.properties || []).reduce(function (object, property) {
            var key = astPropertyKeyName(property);

            if (key !== null) {
                object[key] = astToJavaScript(property.value);
            }

            return object;
        }, {});
    }

    if (node.type === 'ArrayExpression') {
        return (node.elements || []).map(astToJavaScript);
    }

    if (node.type === 'Literal') {
        return node.value;
    }

    return undefined;
}

function astPropertyKeyName(property) {
    // Nashorn's parser does not set a type on property nodes, so a missing type is accepted.
    if (!property || (property.type && property.type !== 'Property') || !property.key || !property.value) {
        return null;
    }

    // An unquoted key is parsed as an identifier carrying "name", a quoted key as a literal carrying "value".
    var key = typeof property.key.name !== 'undefined' ? property.key.name : property.key.value;

    return typeof key === 'undefined' || key === null ? null : key;
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

    if (!resourceReq.toLowerCase().startsWith('/oslc/script/' + service.scriptName.toLowerCase())) {
        if (!resourceReq.toLowerCase().startsWith('/api/script/' + service.scriptName.toLowerCase())) {
            return null;
        } else {
            isOSLC = false;
        }
    }

    var baseReqPath = isOSLC ? '/oslc/script/' + service.scriptName : '/api/script/' + service.scriptName;

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

// eslint-disable-next-line no-unused-vars
var scriptConfig = {
    autoscript: 'NAVIAM.AUTOSCRIPT.DEPLOY',
    description: 'Naviam Automation Script Deploy Script',
    version: '1.54.0',
    active: true,
    logLevel: 'INFO'
};
