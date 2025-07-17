/* eslint-disable no-redeclare */
/* eslint-disable indent */
/* eslint-disable quotes */
/* eslint-disable no-undef */
// @ts-nocheck

var Thread = Java.type('java.lang.Thread');

var System = Java.type('java.lang.System');

// eslint-disable-next-line no-global-assign
var File = Java.type('java.io.File');
var RandomAccessFile = Java.type('java.io.RandomAccessFile');

var OutputStreamWriter = Java.type('java.io.OutputStreamWriter');

var FixedLoggers = Java.type('psdi.util.logging.FixedLoggers');

var MboConstants = Java.type('psdi.mbo.MboConstants');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');
var SecurityService = Java.type('psdi.security.SecurityService');
var MXServer = Java.type('psdi.server.MXServer');
var Version = Java.type('psdi.util.Version');

var log4ShellFix = true;
try {
    WriterAppender = Java.type(
        'org.apache.logging.log4j.core.appender.WriterAppender'
    );
    LogManager = Java.type('org.apache.logging.log4j.LogManager');
    PatternLayout = Java.type(
        'org.apache.logging.log4j.core.layout.PatternLayout'
    );
    Level = Java.type('org.apache.logging.log4j.Level');
} catch (error) {
    WriterAppender = Java.type('org.apache.log4j.WriterAppender');
    LogManager = Java.type('org.apache.log4j.LogManager');
    PatternLayout = Java.type('org.apache.log4j.PatternLayout');
    log4ShellFix = false;
}

var APPENDER_NAME = 'logstream';
var PARENT_APPENDER = 'Console';

var SECURITY_APP = 'LOGGING';
var SECURITY_OPTION = 'STREAMLOG';

// The maximum number of seconds that the request will remain open.
var MAX_TIMEOUT = 30;

var SLEEP_INTERVAL = 100;

main();

function main() {
    // the script only works from a web request.
    if (typeof request !== 'undefined' || !request) {
        if (request.getQueryParam('initialize')) {
            initSecurity();
            result = { status: 'success' };
            responseBody = JSON.stringify(result);
            return;
        } else {
            // Check for permissions to do remote log streaming.
            if (!hasAppOption(SECURITY_APP, SECURITY_OPTION) && !isAdmin()) {
                responseBody = JSON.stringify({
                    status: 'error',
                    message:
                        'The user ' +
                        userInfo.getUserName() +
                        ' does not have permission to stream the Maximo log. The security option ' +
                        SECURITY_OPTION +
                        ' on the ' +
                        SECURITY_APP +
                        ' application is required.',
                });
                return;
            }

            var timeout = request.getQueryParam('timeout');

            //TODO check that timeout is a number
            if (
                typeof timeout === 'undefined' ||
                timeout === null ||
                isNaN(timeout) ||
                timeout > MAX_TIMEOUT
            ) {
                timeout = MAX_TIMEOUT;
            }

            timeout = timeout * 1000;
            try {
                if (
                    Version.majorVersion == '8' ||
                    Version.majorVersion == '9'
                ) {
                    _handleV8(timeout);
                } else if (Version.majorVersion == '7') {
                    _handleV7(timeout);
                } else {
                    responseBody = JSON.stringify({
                        status: 'error',
                        message:
                            'The major Maximo version ' +
                            Version.majorVersion +
                            ' is not supported.',
                    });
                }
            } finally {
                try {
                    // test if the client output stream is still available.  If not, close the session.
                    var response = request.getHttpServletResponse();
                    response.getOutputStream().print(0);
                } catch (error) {
                    MXServer.getMXServer()
                        .lookup('SECURITY')
                        .disconnectUser(
                            userInfo.getUserName(),
                            userInfo.getMaxSessionID(),
                            SecurityService.BROWSER_TIMEOUT,
                            MXServer.getMXServer()
                                .getSystemUserInfo()
                                .getUserName()
                        );

                    // if an error occurs, make sure that the user session is closed.
                    var maxSessionSet = MXServer.getMXServer().getMboSet(
                        'MAXSESSION',
                        MXServer.getMXServer().getSystemUserInfo()
                    );
                    try {
                        var maxSession = maxSessionSet.getMboForUniqueId(
                            userInfo.getMaxSessionID()
                        );

                        if (maxSession) {
                            FixedLoggers.MAXIMOLOGGER.error(
                                'Closing user session due to client disconnect while streaming the Maximo log for user: ' +
                                    userInfo.getUserName()
                            );
                            maxSession.setValue(
                                'logout',
                                true,
                                MboConstants.NOACCESSCHECK |
                                    MboConstants.NOVALIDATION
                            );
                        }
                        maxSessionSet.save();
                    } finally {
                        _close(maxSessionSet);
                    }
                }
            }
        }
    }
}

function _handleV8(timeout) {
    var logFolder = System.getenv('LOG_DIR');

    if (!logFolder) {
        logFolder = System.getProperty('com.ibm.ws.logging.log.directory');
    }

    if (!logFolder) {
        logFolder = '/logs';
    }

    if (!logFolder.trim().endsWith(File.separator)) {
        logFolder = logFolder + File.separator;
    }

    if (logFolder) {
        logFile = new File(logFolder + 'messages.log');
        if (logFile.exists()) {
            // Last known position, starting with the length of the file.
            var lkp = logFile.length();

            var response = request.getHttpServletResponse();
            var output = response.getOutputStream();
            response.setBufferSize(0);
            response.setContentType('text/event-stream');
            response.flushBuffer();

            lkpHeader = request.getHeader('log-lkp');

            if (lkpHeader && !isNaN(lkpHeader) && lkpHeader < lkp) {
                lkp = lkpHeader;
            }

            var line = undefined;

            var start = System.currentTimeMillis();
            var end = start + timeout;

            while (System.currentTimeMillis() < end) {
                // Read file access
                rfa = new RandomAccessFile(logFile, 'r');
                rfa.seek(lkp);

                while (
                    (line = rfa.readLine()) &&
                    System.currentTimeMillis() < end
                ) {
                    output.println(line);
                }

                lkp = rfa.getFilePointer();
                rfa.close();

                Thread.sleep(SLEEP_INTERVAL);
            }
            output.println('log-lkp=' + lkp);
        } else {
            responseBody = JSON.stringify({
                status: 'error',
                message:
                    'The log file ' +
                    logFile.getPath() +
                    ' could not be opened.',
            });
            return;
        }
    } else {
        responseBody = JSON.stringify({
            status: 'error',
            message: 'Could not determine the log folder.',
        });
        return;
    }
}

function _handleV7(timeout) {
    var appenderName = APPENDER_NAME + '_' + userInfo.getUserName();

    var response = request.getHttpServletResponse();
    var output = response.getOutputStream();

    if (log4ShellFix) {
        var factory = LogManager.getFactory();

        if (
            factory instanceof
            Java.type('org.apache.logging.log4j.core.impl.Log4jContextFactory')
        ) {
            var context;
            factory
                .getSelector()
                .getLoggerContexts()
                .forEach(function (ctx) {
                    if (ctx.hasLogger('maximo')) {
                        context = ctx;
                        return;
                    }
                });

            if (context) {
                var maxLogAppenderSet;

                try {
                    maxLogAppenderSet = MXServer.getMXServer().getMboSet(
                        'MAXLOGAPPENDER',
                        userInfo
                    );

                    var sqlf = new SqlFormat('appender = :1');
                    sqlf.setObject(1, 'MAXLOGAPPENDER', 'APPENDER', 'Console');
                    maxLogAppenderSet.setWhere(sqlf.format());

                    var pattern =
                        '%d{dd MMM yyyy HH:mm:ss:SSS} [%-2p] [%s] [%q] %m%n';

                    if (!maxLogAppenderSet.isEmpty()) {
                        pattern = maxLogAppenderSet
                            .moveFirst()
                            .getString('CONVPATTERN');
                    }

                    var layout = PatternLayout.newBuilder()
                        .withPattern(pattern)
                        .build();
                    var root = context.getLogger('maximo');
                    var writer = WriterAppender.createAppender(
                        layout,
                        null,
                        new OutputStreamWriter(output),
                        false,
                        appenderName,
                        true
                    );
                    writer.start();

                    response.setBufferSize(0);
                    response.setContentType('text/event-stream');
                    response.flushBuffer();

                    try {
                        root.addAppender(writer);
                        var start = System.currentTimeMillis();
                        var end = start + timeout;
                        while (System.currentTimeMillis() < end) {
                            Thread.sleep(SLEEP_INTERVAL);
                        }
                    } finally {
                        root.removeAppender(writer);
                    }
                } finally {
                    _close(maxLogAppenderSet);
                }
            } else {
                responseBody = JSON.stringify({
                    status: 'error',
                    message:
                        'A logging context with the maximo root logger could not be found.',
                });
            }
        } else {
            responseBody = JSON.stringify({
                status: 'error',
                message:
                    'Only the default org.apache.logging.log4j.core.impl.Log4jContextFactory context factory is supported.',
            });
        }
    } else {
        var root = LogManager.getLogger('maximo');
        if (root) {
            var console = root.getAppender(PARENT_APPENDER);
            if (console) {
                var layout = console.getLayout();
                var writer = new WriterAppender(layout, output);

                writer.setName(appenderName);

                response.setBufferSize(0);
                response.setContentType('text/event-stream');
                response.flushBuffer();

                try {
                    root.addAppender(writer);

                    var start = System.currentTimeMillis();
                    var end = start + timeout;
                    while (System.currentTimeMillis() < end) {
                        Thread.sleep(SLEEP_INTERVAL);
                    }
                } finally {
                    root.removeAppender(appenderName);
                }
            } else {
                responseBody = JSON.stringify({
                    status: 'error',
                    message:
                        'The standard Console log appender is not configured for the root maximo logger.',
                });
            }
        } else {
            responseBody = JSON.stringify({
                status: 'error',
                message: 'Cannot get the root maximo logger.',
            });
        }
    }
}

function initSecurity() {
    var sigOptionSet;
    var appAuthSet;
    try {
        sigOptionSet = MXServer.getMXServer().getMboSet(
            'SIGOPTION',
            MXServer.getMXServer().getSystemUserInfo()
        );

        var sqlFormat = new SqlFormat('app = :1 and optionname = :2');
        sqlFormat.setObject(1, 'SIGOPTION', 'APP', SECURITY_APP);
        sqlFormat.setObject(2, 'SIGOPTION', 'OPTIONNAME', SECURITY_OPTION);
        sigOptionSet.setWhere(sqlFormat.format());

        if (sigOptionSet.isEmpty()) {
            sigoption = sigOptionSet.add();
            sigoption.setValue('APP', SECURITY_APP);
            sigoption.setValue('OPTIONNAME', SECURITY_OPTION);
            sigoption.setValue('DESCRIPTION', 'Stream Log');
            sigoption.setValue('ESIGENABLED', false);
            sigOptionSet.save();

            var adminGroup = MXServer.getMXServer()
                .lookup('MAXVARS')
                .getString('ADMINGROUP', null);

            appAuthSet = MXServer.getMXServer().getMboSet(
                'APPLICATIONAUTH',
                MXServer.getMXServer().getSystemUserInfo()
            );
            appAuth = appAuthSet.add();
            appAuth.setValue('GROUPNAME', adminGroup);
            appAuth.setValue('APP', SECURITY_APP);
            appAuth.setValue('OPTIONNAME', SECURITY_OPTION);

            appAuthSet.save();
        }
    } finally {
        _close(sigOptionSet);
        _close(appAuthSet);
    }
}

function hasAppOption(app, optionName) {
    return MXServer.getMXServer()
        .lookup('SECURITY')
        .getProfile(userInfo)
        .hasAppOption(app, optionName);
}

function isAdmin() {
    var user = userInfo.getUserName();
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

        return !groupUserSet.isEmpty();
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
        } catch (ignored) {
            // Ignore the exception.
        }
    }
}

// eslint-disable-next-line no-unused-vars
var scriptConfig = {
    autoscript: 'SHARPTREE.AUTOSCRIPT.LOGGING',
    description: 'Stream the log file.',
    version: '1.0.0',
    active: true,
    logLevel: 'ERROR',
};
