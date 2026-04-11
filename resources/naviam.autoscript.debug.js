/* eslint-disable no-undef */
/* eslint-disable no-unused-vars */
// @ts-nocheck
var Base64 = Java.type('java.util.Base64');
var File = Java.type('java.io.File');
var FileOutputStream = Java.type('java.io.FileOutputStream');
var URLClassLoader = Java.type('java.net.URLClassLoader');
var ArrayList = Java.type('java.util.ArrayList');
var Modifier = Java.type('java.lang.reflect.Modifier');
var System = Java.type('java.lang.System');
var Class = Java.type('java.lang.Class');

var ScriptDriverFactory = Java.type('com.ibm.tivoli.maximo.script.ScriptDriverFactory');
var MXServer = Java.type('psdi.server.MXServer');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');
var MboConstants = Java.type('psdi.mbo.MboConstants');
var MXException = Java.type('psdi.util.MXException');
var RuntimeException = Java.type('java.lang.RuntimeException');

var DRIVER_PROPERTY = 'mxe.script.drivers';
var DRIVER_CLASS = 'io.naviam.autoscript.DebugDriver';
var DRIVER_JAR_NAME = 'autoscript-debug.jar';

main();

/**
 * Handles the installer script HTTP entrypoint and serializes a JSON response.
 */
function main() {
    try {
        // This script is uploaded transiently and invoked through Maximo's script HTTP endpoint.
        if (typeof httpMethod === 'undefined' || typeof request === 'undefined') {
            throw new Error('The installer script must be invoked through HTTP.');
        }

        if (httpMethod === 'GET') {
            var userCanInstall = false;
            try {
                checkPermissions('NAVIAM_UTILS', 'DEBUGSCRIPT');
                userCanInstall = true;
            } catch (ignored) {
                /* empty */
            }

            var driverClassAvailable = false;
            try {
                Class.forName(DRIVER_CLASS);
                driverClassAvailable = true;
            } catch (ignored) {
                driverClassAvailable = new File(System.getProperty('java.io.tmpdir'), DRIVER_JAR_NAME).exists();
            }

            responseBody = JSON.stringify({
                status: 'success',
                version: getDriverVersion(),
                canInstall: userCanInstall,
                driverLoaded: driverLoaded(ScriptDriverFactory.getInstance()),
                driverClassAvailable: driverClassAvailable
            });
            return;
        }

        if (httpMethod !== 'POST' || typeof requestBody === 'undefined' || !requestBody) {
            throw new Error('The installer script requires a JSON request body.');
        }

        checkPermissions('NAVIAM_UTILS', 'DEBUGSCRIPT');

        var payload = JSON.parse(requestBody);
        if (typeof payload.deactivate !== 'undefined' && payload.deactivate === true) {
            responseBody = JSON.stringify(deactivateDriver());
            return;
        }
        var installResult = installDebugger(payload);
        responseBody = JSON.stringify(installResult);
    } catch (error) {
        responseBody = JSON.stringify({
            status: 'error',
            message: errorMessage(error)
        });
    }
}

/**
 * Checks whether the current user has the required permissions to run the installer and activate the debugger.
 * @param {string} app the Maximo application or object structure name
 * @param {string} optionName the security option associated with the application or object structure
 */
function checkPermissions(app, optionName) {
    if (!userInfo) {
        throw new ScriptError('no_user_info', 'The userInfo global variable has not been set, therefore the user permissions cannot be verified.');
    }

    if (!MXServer.getMXServer().lookup('SECURITY').getProfile(userInfo).hasAppOption(app, optionName) && !isInAdminGroup()) {
        throw new ScriptError(
            'no_permission',
            'The user ' +
                userInfo.getUserName() +
                ' does not have access to the ' +
                optionName +
                ' option in the ' +
                app +
                ' object structure or is not an administrator.'
        );
    }
}

/**
 * Validates the install request, writes the jar to disk, updates Maximo configuration,
 * and attempts to activate the driver in the current JVM.
 *
 * @param {Object} payload JSON request payload from the VS Code extension.
 * @returns {Object} Install result returned to the caller.
 */
function installDebugger(payload) {
    var activation = {};
    if (typeof payload.activateOnly && payload.activateOnly === true) {
        var jarFile = new File(System.getProperty('java.io.tmpdir'), DRIVER_JAR_NAME);

        if (!jarFile.exists()) {
            throw new Error('The driver jar file does not exist at the expected location: ' + jarFile.getAbsolutePath());
        }

        activation = activateDriver();
        return {
            status: 'success',
            version: getDriverVersion(),
            driverLoaded: activation.loaded,
            restartRequired: !activation.loaded,
            message: activation.loaded
                ? 'Automation Script debugging was activated in the current JVM.'
                : 'Automation Script debugging did not complete dynamically, use the Maximo customization archive to install.',
            activation: activation
        };
    }

    var jarBase64 = stringValue(payload.jar);

    if (!jarBase64) {
        throw new Error('jarBase64 is required.');
    }

    jarFile = writeJar(jarBase64);
    // Persist the driver class in mxe.script.drivers so Maximo will reload it on restart.
    var propertyUpdate = ensureDriverProperty();
    // Attempt a live attach into the current JVM to avoid requiring an immediate restart.
    activation = activateDriver();

    return {
        status: 'success',
        version: getDriverVersion(),
        jarPath: jarFile.getAbsolutePath(),
        driverPropertyUpdated: propertyUpdate.updated,
        driverPropertyValue: propertyUpdate.value,
        driverLoaded: activation.loaded,
        restartRequired: !activation.loaded,
        message: activation.loaded
            ? 'AutoDebug was installed and activated in the current JVM.'
            : 'AutoDebug was installed and the Maximo driver property was updated, but live activation did not complete. Restart Maximo to pick up the jar from disk.',
        activation: activation
    };
}

/**
 * Creates the target directory if needed and writes the uploaded debugger jar to disk.
 *
 * @param {string} installDirectory Maximo-side directory where the jar should be stored.
 * @param {string} jarName Jar file name to create.
 * @param {string} jarBase64 Base64-encoded jar bytes.
 * @returns {java.io.File} The written jar file.
 */
function writeJar(jarBase64) {
    var directory = new File(System.getProperty('java.io.tmpdir'));
    if (!directory.exists() && !directory.mkdirs()) {
        throw new Error('Unable to create install directory ' + System.getProperty('java.io.tmpdir'));
    }

    if (!directory.isDirectory()) {
        throw new Error(System.getProperty('java.io.tmpdir') + ' is not a directory.');
    }

    var jarFile = new File(directory, DRIVER_JAR_NAME);
    var output;
    try {
        output = new FileOutputStream(jarFile);
        output.write(Base64.getDecoder().decode(jarBase64));
        output.flush();
    } finally {
        if (output) {
            output.close();
        }
    }

    return jarFile;
}

/**
 * Ensures the AutoDebug driver class appears in mxe.script.drivers for future restarts.
 *
 * @returns {{updated: boolean, value: string}} Property update state.
 */
function ensureDriverProperty() {
    var maxPropSet;
    try {
        maxPropSet = MXServer.getMXServer().getMboSet('MAXPROPVALUE', MXServer.getMXServer().getSystemUserInfo());

        var sqlFormat = new SqlFormat('propname = :1');
        sqlFormat.setObject(1, 'MAXPROPVALUE', 'PROPNAME', DRIVER_PROPERTY);
        maxPropSet.setWhere(sqlFormat.format());

        var property = maxPropSet.isEmpty() ? maxPropSet.add() : maxPropSet.getMbo(0);
        var currentValue = property.isNull('PROPVALUE') ? '' : property.getString('PROPVALUE');
        var normalizedValue = appendDriverClass(currentValue);
        var updated = normalizedValue !== currentValue;

        // DISPPROPVALUE exists in some environments and needs to stay aligned with PROPVALUE.
        property.setValue('PROPVALUE', normalizedValue, MboConstants.NOVALIDATION + MboConstants.NOACCESSCHECK);
        if (hasField(property, 'DISPPROPVALUE')) {
            property.setValue('DISPPROPVALUE', normalizedValue, MboConstants.NOVALIDATION + MboConstants.NOACCESSCHECK);
        }

        if (updated) {
            maxPropSet.save();
            MXServer.getMXServer().reloadMaximoCache('MAXPROP', true);
        }

        return {
            updated: updated,
            value: normalizedValue
        };
    } finally {
        closeSet(maxPropSet);
    }
}

function getDriverVersion() {
    var jarFile = new File(System.getProperty('java.io.tmpdir'), DRIVER_JAR_NAME);
    if (jarFile.exists()) {
        var parentLoader = ScriptDriverFactory.class.getClassLoader();
        var urlArray = Java.to([new File(System.getProperty('java.io.tmpdir'), DRIVER_JAR_NAME).toURI().toURL()], 'java.net.URL[]');
        // Load the jar in an isolated URLClassLoader so the current JVM can see the new driver immediately.
        var loader = new URLClassLoader(urlArray, parentLoader);
        var driverClass = Class.forName(DRIVER_CLASS, true, loader);
        return driverClass.getMethod('getVersion').invoke(null);
    } else {
        try {
            var clazz = Class.forName(DRIVER_CLASS);
            return clazz.getMethod('getVersion').invoke(null);
        } catch (ignore) {
            return 'missing';
        }
    }
}

/**
 * Tries to load and register the debugger driver into the live ScriptDriverFactory state.
 *
 * @returns {Object} Activation details for the current JVM.
 */
function deactivateDriver() {
    var driverFactory = ScriptDriverFactory.getInstance();

    if (!driverLoaded(driverFactory)) {
        return {
            deactivated: true,
            status: 'success',
            message: 'Driver was not loaded; nothing to remove.'
        };
    }

    var parentLoader = ScriptDriverFactory.class.getClassLoader();
    var urlArray = Java.to([new File(System.getProperty('java.io.tmpdir'), DRIVER_JAR_NAME).toURI().toURL()], 'java.net.URL[]');
    // Load the jar in an isolated URLClassLoader so the current JVM can see the new driver immediately.
    var loader = new URLClassLoader(urlArray, parentLoader);
    var driverClass = java.lang.Class.forName(DRIVER_CLASS, true, loader);
    var driver = driverClass.getDeclaredConstructor().newInstance();

    // ScriptDriverFactory does not expose a supported live-registration API, so this updates its internals directly.
    var driversField = ScriptDriverFactory.class.getDeclaredField('scriptDriversList');
    driversField.setAccessible(true);
    var enginesField = ScriptDriverFactory.class.getDeclaredField('allsupportedScrEngineMap');
    enginesField.setAccessible(true);

    var drivers = driversField.get(driverFactory);
    removeDriver(drivers);

    var engines = enginesField.get(driverFactory);
    engines.putAll(driver.getSupportedEngines());

    var propertyResult = revertDriverProperty(DRIVER_CLASS);

    MXServer.getMXServer().reloadMaximoCache('SCRIPT', true);

    return {
        deactivated: true,
        status: 'success',
        propertyReverted: propertyResult.updated,
        propertyValue: propertyResult.value
    };
}

/**
 * Tries to load and register the debugger driver into the live ScriptDriverFactory state.
 *
 * @returns {Object} Activation details for the current JVM.
 */
function activateDriver() {
    var driverFactory = ScriptDriverFactory.getInstance();
    if (driverLoaded(driverFactory)) {
        return {
            loaded: true,
            alreadyPresent: true,
            loaderClass: existingDriverLoader(driverFactory)
        };
    }

    var parentLoader = ScriptDriverFactory.class.getClassLoader();
    var urlArray = Java.to([new File(System.getProperty('java.io.tmpdir'), DRIVER_JAR_NAME).toURI().toURL()], 'java.net.URL[]');
    // Load the jar in an isolated URLClassLoader so the current JVM can see the new driver immediately.
    var loader = new URLClassLoader(urlArray, parentLoader);
    var driverClass = java.lang.Class.forName(DRIVER_CLASS, true, loader);
    var driver = driverClass.getDeclaredConstructor().newInstance();

    // ScriptDriverFactory does not expose a supported live-registration API, so this updates its internals directly.
    var driversField = ScriptDriverFactory.class.getDeclaredField('scriptDriversList');
    driversField.setAccessible(true);
    var enginesField = ScriptDriverFactory.class.getDeclaredField('allsupportedScrEngineMap');
    enginesField.setAccessible(true);

    var drivers = driversField.get(driverFactory);
    removeDriver(drivers);
    drivers.add(0, driver);

    var engines = enginesField.get(driverFactory);
    engines.putAll(driver.getSupportedEngines());

    return {
        loaded: true,
        loaderClass: loader.getClass().getName()
    };
}

/**
 * Checks whether ScriptDriverFactory already has an instance of the requested driver class.
 *
 * @param {Object} driverFactory ScriptDriverFactory singleton.
 *
 * @returns {boolean} True when the driver is already present.
 */
function driverLoaded(driverFactory) {
    var driversField = ScriptDriverFactory.class.getDeclaredField('scriptDriversList');
    driversField.setAccessible(true);
    var drivers = driversField.get(driverFactory);
    for (var i = 0; i < drivers.size(); i++) {
        if (drivers.get(i).getClass().getName() === DRIVER_CLASS) {
            return true;
        }
    }
    return false;
}

/**
 * Returns the class loader type for an already registered driver instance.
 *
 * @param {Object} driverFactory ScriptDriverFactory singleton.

 * @returns {string} Driver class loader name, or an empty string when not present.
 */
function existingDriverLoader(driverFactory) {
    var driversField = ScriptDriverFactory.class.getDeclaredField('scriptDriversList');
    driversField.setAccessible(true);
    var drivers = driversField.get(driverFactory);
    for (var i = 0; i < drivers.size(); i++) {
        var driver = drivers.get(i);
        if (driver.getClass().getName() === DRIVER_CLASS) {
            return driver.getClass().getClassLoader().getClass().getName();
        }
    }
    return '';
}

/**
 * Removes matching driver instances from the live driver list and releases their resources.
 *
 * @param {java.util.List} drivers ScriptDriverFactory driver list.
 */
function removeDriver(drivers) {
    var driverFactory = ScriptDriverFactory.getInstance();
    for (var i = drivers.size() - 1; i >= 0; i--) {
        var driver = drivers.get(i);
        if (driver.getClass().getName() === DRIVER_CLASS) {
            // Remove engine mappings before releasing the instance so stale entries do not point at a closed loader.
            removeDriverEngines(driverFactory, driver);
            releaseDriver(driver);
            shutdownDriver(driver);
            closeLoader(driver.getClass().getClassLoader());
            drivers.remove(i);
        }
    }
    rebuildEngineMap(driverFactory, drivers);
    driverFactory.releaseDriverResources();
}

/**
 * Removes engine registrations that still point at the driver being replaced.
 *
 * @param {Object} driverFactory ScriptDriverFactory singleton.
 * @param {Object} driver Driver instance being removed.
 */
function removeDriverEngines(driverFactory, driver) {
    if (!driver) {
        return;
    }
    var enginesField = ScriptDriverFactory.class.getDeclaredField('allsupportedScrEngineMap');
    enginesField.setAccessible(true);
    var engines = enginesField.get(driverFactory);
    var supportedEngines = driver.getSupportedEngines();
    var iterator = supportedEngines.entrySet().iterator();
    while (iterator.hasNext()) {
        var entry = iterator.next();
        var engineName = entry.getKey();
        if (engines.get(engineName) === driver) {
            engines.remove(engineName);
        }
    }
}

/**
 * Rebuilds the supported engine map from the remaining registered drivers.
 *
 * @param {Object} driverFactory ScriptDriverFactory singleton.
 * @param {java.util.List} drivers Remaining driver instances.
 */
function rebuildEngineMap(driverFactory, drivers) {
    var enginesField = ScriptDriverFactory.class.getDeclaredField('allsupportedScrEngineMap');
    enginesField.setAccessible(true);
    var engines = enginesField.get(driverFactory);
    engines.clear();
    for (var i = drivers.size() - 1; i >= 0; i--) {
        var driver = drivers.get(i);
        var supportedEngines = driver.getSupportedEngines();
        if (supportedEngines) {
            engines.putAll(supportedEngines);
        }
    }
}

/**
 * Invokes an optional shutdown hook on the driver when one is available.
 *
 * @param {Object} driver Driver instance being removed.
 */
function shutdownDriver(driver) {
    if (!driver) {
        return;
    }
    try {
        var shutdownMethod = driver.getClass().getMethod('shutdown');
        shutdownMethod.invoke(driver);
    } catch (error) {
        if (!isMissingMethod(error)) {
            throw error;
        }
    }
}

/**
 * Calls the driver's resource cleanup hook and ignores best-effort cleanup failures.
 *
 * @param {Object} driver Driver instance being removed.
 */
function releaseDriver(driver) {
    if (!driver) {
        return;
    }
    try {
        driver.releaseResources();
    } catch (ignored) {
        /* empty */
    }
}

/**
 * Closes the driver class loader when it supports close().
 *
 * @param {Object} loader Class loader backing the driver jar.
 */
function closeLoader(loader) {
    if (!loader) {
        return;
    }
    try {
        loader.close();
    } catch (ignored) {
        /* empty */
    }
}

/**
 * Prepends the debugger driver class to a comma-separated Maximo property value if missing.
 *
 * @param {string} currentValue Existing mxe.script.drivers value.
 *
 * @returns {string} Normalized property value.
 */
function appendDriverClass(currentValue) {
    var values = [];
    if (currentValue) {
        currentValue.split(',').forEach(function (value) {
            var trimmed = value.trim();
            if (trimmed) {
                values.push(trimmed);
            }
        });
    }

    if (values.indexOf(DRIVER_CLASS) === -1) {
        values.unshift(DRIVER_CLASS);
    }
    return values.join(',');
}

/**
 * Verifies that the invoking user belongs to Maximo's configured administrator group.
 *
 * @returns {boolean} True when the user is allowed to run the installer.
 */
function isInAdminGroup() {
    var groupUserSet;
    try {
        groupUserSet = MXServer.getMXServer().getMboSet('GROUPUSER', MXServer.getMXServer().getSystemUserInfo());

        var adminGroup = MXServer.getMXServer().lookup('MAXVARS').getString('ADMINGROUP', null);

        var sqlFormat = new SqlFormat('userid = :1 and groupname = :2');
        sqlFormat.setObject(1, 'GROUPUSER', 'USERID', userInfo.getUserName());
        sqlFormat.setObject(2, 'GROUPUSER', 'GROUPNAME', adminGroup);
        groupUserSet.setWhere(sqlFormat.format());
        return !groupUserSet.isEmpty();
    } finally {
        closeSet(groupUserSet);
    }
}

/**
 * Checks whether an mbo exposes a field before attempting to set it.
 *
 * @param {Object} mbo Maximo mbo instance.
 * @param {string} fieldName Field to probe.
 * @returns {boolean} True when the field exists.
 */
function hasField(mbo, fieldName) {
    try {
        mbo.getMboValue(fieldName);
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Closes and cleans up an mbo set, ignoring cleanup errors.
 *
 * @param {Object} set Maximo mbo set to release.
 */
function closeSet(set) {
    if (!set) {
        return;
    }
    try {
        set.close();
        set.cleanup();
    } catch (ignored) {
        /* empty */
    }
}

/**
 * Converts a nullable value to a string for script payload handling.
 *
 * @param {*} value Value to normalize.
 * @returns {string} Empty string for nullish values, otherwise String(value).
 */
function stringValue(value) {
    return value == null ? '' : String(value);
}

/**
 * Extracts a user-facing error message from Maximo and Java wrapper exceptions.
 *
 * @param {*} error Thrown script error.
 * @returns {string} Message suitable for the HTTP response body.
 */
function errorMessage(error) {
    if (error instanceof MXException) {
        return error.getMessage();
    }
    if (error instanceof RuntimeException && error.getCause() instanceof MXException) {
        return error.getCause().getMessage();
    }
    if (error && error.message) {
        return error.message;
    }
    return String(error);
}

/**
 * Detects whether a reflective call failed because the target method does not exist.
 *
 * @param {*} error Error thrown from reflective invocation.
 * @returns {boolean} True when the error indicates NoSuchMethodException.
 */
function isMissingMethod(error) {
    if (!error) {
        return false;
    }
    if (String(error).indexOf('NoSuchMethodException') >= 0) {
        return true;
    }
    if (error.javaException) {
        return String(error.javaException).indexOf('NoSuchMethodException') >= 0;
    }
    return false;
}

/**
 * Removes the debugger driver class from mxe.script.drivers for future restarts.
 *
 * @returns {{updated: boolean, value: string}} Property update state.
 */
function revertDriverProperty() {
    var maxPropSet;
    try {
        maxPropSet = MXServer.getMXServer().getMboSet('MAXPROPVALUE', MXServer.getMXServer().getSystemUserInfo());
        var sqlFormat = new SqlFormat('propname = :1');
        sqlFormat.setObject(1, 'MAXPROPVALUE', 'PROPNAME', DRIVER_PROPERTY);
        maxPropSet.setWhere(sqlFormat.format());

        if (maxPropSet.isEmpty()) {
            return { updated: false, value: '' };
        }

        var property = maxPropSet.getMbo(0);
        var currentValue = property.isNull('PROPVALUE') ? '' : property.getString('PROPVALUE');
        var normalizedValue = removeDriverClass(currentValue);
        var updated = normalizedValue !== currentValue;

        if (updated) {
            property.setValue('PROPVALUE', normalizedValue, MboConstants.NOVALIDATION + MboConstants.NOACCESSCHECK);
            if (hasField(property, 'DISPPROPVALUE')) {
                property.setValue('DISPPROPVALUE', normalizedValue, MboConstants.NOVALIDATION + MboConstants.NOACCESSCHECK);
            }
            maxPropSet.save();
            MXServer.getMXServer().reloadMaximoCache('MAXPROP', true);
        }

        return { updated: updated, value: normalizedValue };
    } finally {
        closeSet(maxPropSet);
    }
}

/**
 * Removes the debugger driver class from a comma-separated Maximo property value.
 *
 * @param {string} currentValue Existing mxe.script.drivers value.
 
 * @returns {string} Normalized property value.
 */
function removeDriverClass(currentValue) {
    if (!currentValue) {
        return '';
    }
    var values = [];
    currentValue.split(',').forEach(function (value) {
        var trimmed = value.trim();
        if (trimmed && trimmed !== DRIVER_CLASS) {
            values.push(trimmed);
        }
    });
    return values.join(',');
}

// eslint-disable-next-line no-unused-vars
var scriptConfig = {
    autoscript: 'NAVIAM.AUTOSCRIPT.DEBUG',
    description: 'Naviam Script to enable remote debugging.',
    version: '1.0.0',
    active: true,
    logLevel: 'ERROR'
};
