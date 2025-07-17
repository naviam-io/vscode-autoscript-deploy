/* eslint-disable no-redeclare */
/* eslint-disable indent */
/* eslint-disable quotes */
/* eslint-disable no-undef */
// @ts-nocheck
RESTRequest = Java.type('com.ibm.tivoli.oslc.RESTRequest');
ScriptInfo = Java.type('com.ibm.tivoli.maximo.script.ScriptInfo');
ScriptCache = Java.type('com.ibm.tivoli.maximo.script.ScriptCache');
ScriptDriverFactory = Java.type(
    'com.ibm.tivoli.maximo.script.ScriptDriverFactory'
);
MessageDigest = Java.type('java.security.MessageDigest');

// eslint-disable-next-line no-global-assign
Character = Java.type('java.lang.Character');
// eslint-disable-next-line no-global-assign
String = Java.type('java.lang.String');
StringBuilder = Java.type('java.lang.StringBuilder');
System = Java.type('java.lang.System');

MessageDigest = Java.type('java.security.MessageDigest');

ZonedDateTime = Java.type('java.time.ZonedDateTime');
DateTimeFormatter = Java.type('java.time.format.DateTimeFormatter');

HashMap = Java.type('java.util.HashMap');

SqlFormat = Java.type('psdi.mbo.SqlFormat');
MXServer = Java.type('psdi.server.MXServer');

MXApplicationException = Java.type('psdi.util.MXApplicationException');
MXLoggerFactory = Java.type('psdi.util.logging.MXLoggerFactory');

var sha256 = MessageDigest.getInstance('SHA-256');

var logger = MXLoggerFactory.getLogger(
    'maximo.script.' + service.getScriptName()
);

var configScript = 'SHARPTREE.AUTOSCRIPT.DEPLOY.HISTORY';

main();

function main() {
    // initialize the configuration script if required.
    _initConfigScript();

    try {
        if (typeof httpMethod !== 'undefined' && !httpMethod) {
            var configName = _validateHttpRequestAndGetConfigName();
            switch (httpMethod) {
                case 'GET':
                    responseBody = read(configName);
                    break;
                case 'PUT':
                    var body = JSON.parse(requestBody);
                    responseBody = update(configName, body);
                    break;
                case 'POST':
                    var body = JSON.parse(requestBody);
                    if (
                        body._action &&
                        body._action.toLowerCase() == 'delete'
                    ) {
                        responseBody = remove(configName);
                        break;
                    }
                    responseBody = create(configName, body);
                    break;
                case 'DELETE':
                    responseBody = remove(configName);
                    break;
                default:
                    throw ConfigError(
                        'unhandled_method',
                        'The configuration automation script does not support the Http method ' +
                            httpMethod +
                            ', support Http methods are GET, PUT, POST and DELETE.'
                    );
            }
        }
    } catch (error) {
        var response = {};
        response.status = 'error';
        if (error instanceof Error) {
            response.message = error.message;
        } else if (error instanceof ConfigError) {
            response.message = error.message;
            response.reason = error.reason;
        } else {
            response.cause = error;
        }

        responseBody = JSON.stringify(response);
        return;
    }
}

function _validateHttpRequestAndGetConfigName() {
    if (typeof httpMethod == 'undefined') {
        throw new ConfigError(
            'missing_http_method',
            'The configuration automation script must be invoked from an Http request and the httpMethod must be available.'
        );
    }

    if (typeof request == 'undefined') {
        throw new ConfigError(
            'missing_oslc_request',
            'The configuration automation script must be invoked from an Http request and the OSLC request object must be available.'
        );
    }

    if (httpMethod == 'PUT' || httpMethod == 'POST') {
        if (typeof requestBody == 'undefined') {
            throw new ConfigError(
                'missing_request_body',
                'The configuration automation script request body cannot be empty for POST and PUT actions.'
            );
        }
    }

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

    if (
        !resourceReq.startsWith('/oslc/script/' + service.scriptName) &&
        !resourceReq.startsWith('/api/script/' + service.scriptName)
    ) {
        throw new ConfigError(
            'invalid_script_invocation',
            'The configuration automation script must be invoked as an Http OSLC script request in the form of /oslc/script/' +
                scriptName +
                ' or /api/script/' +
                scriptName +
                ' .'
        );
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

    var name = resourceReq.substring(baseReqPath.length);
    if (name.startsWith('/')) {
        name = name.substring(1);
    }

    if (!name || name.trim() === '') {
        throw new ConfigError(
            'missing_configuration_name',
            'The configuration automation script request must be in the form of ' +
                baseReqPath +
                '/{configuration-name}.'
        );
    }

    return name;
}

function _initConfigScript() {
    var autoScriptSet;
    try {
        autoScriptSet = MXServer.getMXServer().getMboSet(
            'AUTOSCRIPT',
            MXServer.getMXServer().getSystemUserInfo()
        );
        var sqlf = new SqlFormat('autoscript = :1');
        sqlf.setObject(1, 'AUTOSCRIPT', 'AUTOSCRIPT', configScript);
        autoScriptSet.setWhere(sqlf.format());

        if (autoScriptSet.isEmpty()) {
            var autoscript = autoScriptSet.add();
            autoscript.setValue('AUTOSCRIPT', configScript);
            autoscript.setValue(
                'DESCRIPTION',
                'Automation Script Deploy History'
            );
            autoscript.setValue('SCRIPTLANGUAGE', 'javascript');
            autoscript.setValue('SOURCE', 'config={};');
            autoScriptSet.save();
        }
    } finally {
        _close(autoScriptSet);
    }
}

function _saveConfigScript(config) {
    log_info('Saving the config');
    var autoScriptSet;
    try {
        autoScriptSet = MXServer.getMXServer().getMboSet(
            'AUTOSCRIPT',
            MXServer.getMXServer().getSystemUserInfo()
        );
        var sqlf = new SqlFormat('autoscript = :1');
        sqlf.setObject(1, 'AUTOSCRIPT', 'AUTOSCRIPT', configScript);
        autoScriptSet.setWhere(sqlf.format());

        if (autoScriptSet.isEmpty()) {
            throw ConfigError(
                'missing_config',
                'The configuration automation script ' +
                    configScript +
                    ' does not exist.'
            );
        } else {
            var autoscript = autoScriptSet.getMbo(0);

            var orderedConfig = Object.keys(config)
                .sort()
                .reduce(function (obj, key) {
                    obj[key] = config[key];
                    return obj;
                }, {});

            autoscript.setValue(
                'SOURCE',
                'config=' + JSON.stringify(orderedConfig, null, 4) + ';'
            );

            autoScriptSet.save();
        }
    } finally {
        _close(autoScriptSet);
    }
}

// eslint-disable-next-line no-unused-vars
function createOrUpdateScript(scriptName, script, userName) {
    var scriptInfo;
    var toBeCreated = false;
    try {
        scriptInfo = JSON.parse(read(scriptName));
    } catch (error) {
        if (
            typeof error.reason !== 'undefined' &&
            error.reason === 'missing_config'
        ) {
            scriptInfo = {};
            toBeCreated = true;
        } else {
            throw error;
        }
    }

    try {
        scriptInfo.deployed = System.currentTimeMillis();
        scriptInfo.deployedBy = userName;
        scriptInfo.deployedAsDate =
            DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(ZonedDateTime.now());
        scriptInfo.hash = sha256Hex(script);

        if (toBeCreated) {
            create(scriptName, scriptInfo);
        } else {
            update(scriptName, scriptInfo);
        }
    } catch (error) {
        log_error('An error happened ' + error);
        log_error(JSON.stringify(error));
    }
}

function create(name, config) {
    var serverConfig = invokeScript(configScript).config;

    if (serverConfig[name]) {
        throw new ConfigError(
            'config_exists',
            'The ' + name + ' configuration already exists and must be unique.'
        );
    }

    serverConfig[name] = config;

    try {
        _saveConfigScript(serverConfig);
    } catch (error) {
        if (error instanceof Java.type('psdi.util.MXException')) {
            // if the error is that a record has been updated by another user then try again because we are inserting a new block.
            if (
                error.getErrorGroup() == 'system' &&
                error.getErrorKey() == 'rowupdateexception'
            ) {
                create(name, config);
            }
        }
    }

    var result = { status: 'success' };
    return JSON.stringify(result, null, 4);
}

function read(name) {
    var serverConfig = invokeScript(configScript).config;
    var result = serverConfig[name];

    if (typeof result === 'undefined') {
        throw new ConfigError(
            'missing_config',
            'The key name ' + name + ' does not exists in the configuration.'
        );
    }
    return JSON.stringify(result, null, 4);
}

function update(name, config) {
    var serverConfig = invokeScript(configScript).config;
    var result = serverConfig[name];

    if (typeof result === 'undefined') {
        throw new ConfigError(
            'missing_config',
            'The key name ' + name + ' does not exists in the configuration.'
        );
    }

    var preSignature = _calculateSignature(result);

    delete serverConfig[name];

    serverConfig[name] = config;

    try {
        _saveConfigScript(serverConfig);
    } catch (error) {
        if (error instanceof Java.type('psdi.util.MXException')) {
            // if the error is that a record has been updated by another user then try again if the block we're saving wasn't modified.
            if (
                error.getErrorGroup() == 'system' &&
                error.getErrorKey() == 'rowupdateexception'
            ) {
                var checkServerConfig = invokeScript(configScript).config;
                var checkResult = checkServerConfig[name];

                if (typeof checkResult === 'undefined') {
                    throw new ConfigError(
                        'missing_config',
                        'The key name ' +
                            name +
                            ' does not exists in the configuration.'
                    );
                }

                //if the part that we are updating hasn't changed then go ahead and try again.
                if (_calculateSignature(checkResult) === preSignature) {
                    update(name, config);
                }
            } else {
                throw error;
            }
        } else {
            throw error;
        }
    }
    var result = { status: 'success' };
    return JSON.stringify(result, null, 4);
}

// used remove function name because delete is a reserved word.
function remove(name) {
    var serverConfig = invokeScript(configScript).config;
    var result = serverConfig[name];

    if (typeof result === 'undefined') {
        throw new ConfigError(
            'missing_config',
            'The key name ' + name + ' does not exists in the configuration.'
        );
    }

    delete serverConfig[name];
    try {
        _saveConfigScript(serverConfig);
    } catch (error) {
        if (error instanceof Java.type('psdi.util.MXException')) {
            // if the error is that a record has been updated by another user then try again because we are removing the block
            if (
                error.getErrorGroup() == 'system' &&
                error.getErrorKey() == 'rowupdateexception'
            ) {
                remove(name);
            }
        }
    }
    var result = { status: 'success' };
    return JSON.stringify(result, null, 4);
}

function _calculateSignature(config) {
    // This is the ES5 version of Object.assign since Nashorn is not ES6 compatible.
    var evalConfig = JSON.parse(JSON.stringify(config));

    // remove an existing signature so it isn't included in the hash
    delete evalConfig.signature;
    return sha256Hex(JSON.stringify(evalConfig, null, 4));
}

function ConfigError(reason, message) {
    Error.call(this, message);
    this.reason = reason;
    this.message = message;
}

function invokeScript(scriptName) {
    scriptInfo = ScriptCache.getInstance().getScriptInfo(scriptName);
    if (typeof scriptInfo === 'undefined' || !scriptInfo) {
        throw new MXApplicationException(
            'script',
            'nosuchscript',
            Java.to([scriptName], 'java.lang.String[]')
        );
    }
    var context = new HashMap();
    ScriptDriverFactory.getInstance()
        .getScriptDriver(scriptName)
        .runScript(scriptName, context);
    return context;
}

// ConfigurationError derives from Error
ConfigError.prototype = Object.create(Error.prototype);
ConfigError.prototype.constructor = ConfigError;

// Cleans up the MboSet connections and closes the set.
function _close(set) {
    if (set) {
        set.cleanup();
        set.close();
    }
}

// Logging functions provided for compatibility with older versions where service.log_xxxx is not available.
// eslint-disable-next-line no-unused-vars
function log_debug(msg) {
    logger.debug(msg);
}

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

function sha256Hex(value) {
    try {
        return toHex(sha256.digest(value.getBytes('utf8')));
    } catch (error) {
        logger.error(error);
    }
}

function toHex(value) {
    var result = new StringBuilder();
    for (var j = 0; j < value.length; j++) {
        result.append(String.format('%02x', value[j]));
    }
    return result.toString();
}
