/* eslint-disable no-redeclare */
/* eslint-disable no-undef */
// @ts-nocheck
var ByteArray = Java.type('byte[]');

var BufferedReader = Java.type('java.io.BufferedReader');
var FileReader = Java.type('java.io.FileReader');
var File = Java.type('java.io.File');
var OutputStreamWriter = Java.type('java.io.OutputStreamWriter');
var RandomAccessFile = Java.type('java.io.RandomAccessFile');

var InetAddress = Java.type('java.net.InetAddress');
var URL = Java.type('java.net.URL');

var FileSystems = Java.type('java.nio.file.FileSystems');
var Paths = Java.type('java.nio.file.Paths');
var StandardWatchEventKinds = Java.type('java.nio.file.StandardWatchEventKinds');

var Thread = Java.type('java.lang.Thread');
var System = Java.type('java.lang.System');

var DatatypeConverter = Java.type('javax.xml.bind.DatatypeConverter');

var MboConstants = Java.type('psdi.mbo.MboConstants');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');

var MXServer = Java.type('psdi.server.MXServer');

var MXCipher = Java.type('psdi.util.MXCipher');

var SecurityService = Java.type('psdi.security.SecurityService');

var Version = Java.type('psdi.util.Version');
var FixedLoggers = Java.type('psdi.util.logging.FixedLoggers');

var log4ShellFix = true;

try {
    WriterAppender = Java.type('org.apache.logging.log4j.core.appender.WriterAppender');
    LogManager = Java.type('org.apache.logging.log4j.LogManager');
    PatternLayout = Java.type('org.apache.logging.log4j.core.layout.PatternLayout');
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

// ServerSentEvent object to represent a Server Sent Event. The sse function formats the event as a UTF-8 byte array for sending to the client
function ServerSentEvent(id, event, data) {
    var JavaString = Java.type('java.lang.String');
    this.id = id;
    this.event = event;
    this.data = data;
    this.sse = function () {
        return new JavaString('id: ' + this.id + '\n' + 'event: ' + this.event + (data ? '\n' + 'data: ' + this.data : '') + '\n\n').getBytes('UTF-8');
    };
}

// Nashorn is ES5 compliant so we need to define the prototype for the ServerSentEvent object
// create a new prototype object for the ServerSentEvent object
ServerSentEvent.prototype = Object.create(Object.prototype);
// assign the ServerSentEvent function as the constructor for the ServerSentEvent prototype
ServerSentEvent.prototype.constructor = ServerSentEvent;

main();

function main() {
    // the script only works from a web request.
    if (typeof request !== 'undefined' || !request) {
        if (request.getQueryParam('initialize')) {
            initSecurity();
            result = { status: 'success' };
            responseBody = JSON.stringify(result);
            return;
        } else if (request.getQueryParam('list')) {
            if (Version.majorVersion == '7') {
                responseBody = JSON.stringify('[]');
            } else {
                responseBody = JSON.stringify(getHosts());
            }
            return;
        } else {
            // Check for permissions to do remote log streaming.
            if (!hasAppOption(SECURITY_APP, SECURITY_OPTION) && !isAdmin()) {
                responseBody = JSON.stringify({
                    status: 'error',
                    message: 'The user ' + userInfo.getUserName() + ' does not have permission to stream the Maximo log. The security option ' + SECURITY_OPTION + ' on the ' + SECURITY_APP + ' application is required.',
                });
                return;
            }

            var timeout = request.getQueryParam('timeout');

            if (typeof timeout === 'undefined' || timeout === null || isNaN(timeout) || timeout > MAX_TIMEOUT) {
                timeout = MAX_TIMEOUT;
            }

            timeout = timeout * 1000;
            try {
                if (Version.majorVersion == '8' || Version.majorVersion == '9') {
                    _handleV8(request.getQueryParam('host'));
                } else if (Version.majorVersion == '7') {
                    _handleV7(timeout);
                } else {
                    responseBody = JSON.stringify({
                        status: 'error',
                        message: 'The major Maximo version ' + Version.majorVersion + ' is not supported.',
                    });
                }
            } finally {
                try {
                    // test if the client output stream is still available.  If not, close the session.
                    var response = request.getHttpServletResponse();
                    response.getOutputStream().print(0);
                } catch (error) {
                    MXServer.getMXServer().lookup('SECURITY').disconnectUser(userInfo.getUserName(), userInfo.getMaxSessionID(), SecurityService.BROWSER_TIMEOUT, MXServer.getMXServer().getSystemUserInfo().getUserName());

                    // if an error occurs, make sure that the user session is closed.
                    var maxSessionSet = MXServer.getMXServer().getMboSet('MAXSESSION', MXServer.getMXServer().getSystemUserInfo());
                    try {
                        var maxSession = maxSessionSet.getMboForUniqueId(userInfo.getMaxSessionID());

                        if (maxSession) {
                            FixedLoggers.MAXIMOLOGGER.error('Closing user session due to client disconnect while streaming the Maximo log for user: ' + userInfo.getUserName());
                            maxSession.setValue('logout', true, MboConstants.NOACCESSCHECK | MboConstants.NOVALIDATION);
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

function getHosts() {
    // if an error occurs, make sure that the user session is closed.
    var serverSessionSet = MXServer.getMXServer().getMboSet('SERVERSESSION', MXServer.getMXServer().getSystemUserInfo());
    try {
        var serverSession = serverSessionSet.moveFirst();
        response = [];
        while (serverSession) {
            response.push({
                serverhost: serverSession.getString('SERVERHOST'),
                servername: serverSession.getString('SERVERNAME'),
                javajvmname: serverSession.getString('JAVAJVMNAME').substring(serverSession.getString('JAVAJVMNAME').indexOf('@') + 1),
                id: serverSession.getUniqueIDValue(),
            });
            serverSession = serverSessionSet.moveNext();
        }
        return response;
    } finally {
        _close(serverSessionSet);
    }
}

function _handleV8(host) {
    if (typeof host !== 'undefined' && host != null && !host.equals(InetAddress.getLocalHost().getHostAddress())) {
        // The requested server log is not the current server.
        proxyRequest(host);
        return;
    }

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
            var response = request.getHttpServletResponse();
            var output = response.getOutputStream();
            // set the buffer to zero so messages are immediately sent to the client.
            response.setBufferSize(0);
            // set the response type as text/event-stream to indicate that an event stream is being sent.
            response.setContentType('text/event-stream');
            // indicate that the connection should be kept alive
            response.addHeader('Connection', 'keep-alive');
            // indicate to the client that the cache should not be used.
            response.addHeader('Cache-Control', 'no-cache');
            // in case NGINX is used, we need to disable buffering so that the response is sent immediately.
            response.addHeader('X-Accel-Buffering', 'no');
            // stop the server from buffering the response for compression.
            response.setHeader('Content-Encoding', 'none');
            response.flushBuffer();

            // read the file first.
            var reader = new BufferedReader(new FileReader(logFile));
            var line = reader.readLine();

            var initialContent = [];
            while (line != null) {
                if (line.indexOf('SystemOut                                                    O') > 0) {
                    line = line.substring(line.indexOf('SystemOut                                                    O') + 63);
                }
                initialContent.push(line);
                if (initialContent.length > 1000) {
                    initialContent.shift();
                }
                line = reader.readLine();
            }

            // Last known position, starting with the length of the file.
            var lkp = logFile.length();
            var count = 0;
            if (MXServer.getMXServer().getName().equals('MXServer')) {
                output.write(new ServerSentEvent(count++, 'name', InetAddress.getLocalHost().getHostName()).sse());
            } else {
                output.write(new ServerSentEvent(count++, 'name', MXServer.getMXServer().getName()).sse());
            }

            output.flush();

            output.write(new ServerSentEvent(count++, 'log', JSON.stringify(initialContent)).sse());
            output.flush();

            // Set up file watcher to monitor the log file for changes.
            var watchService = FileSystems.getDefault().newWatchService();
            try {
                // Open a random access file to read the log file and seek to the end of the file.
                var raf = new RandomAccessFile(logFile, 'r');
                raf.seek(lkp);
                var dir = Paths.get(logFolder);

                dir.register(watchService, StandardWatchEventKinds.ENTRY_MODIFY);

                // eslint-disable-next-line no-constant-condition
                while (true) {
                    var key;
                    try {
                        // This is a blocking call, waiting for events
                        key = watchService.take();
                    } catch (error) {
                        FixedLoggers.MAXIMOLOGGER.error('Closing user session due to thread interruption while streaming the Maximo log for user: ' + userInfo.getUserName());
                        return;
                    }

                    var events = key.pollEvents().iterator();

                    while (events.hasNext()) {
                        var event = events.next();
                        var kind = event.kind();
                        var changed = event.context();

                        if (changed.getFileName().toString().equals('messages.log') && kind == StandardWatchEventKinds.ENTRY_MODIFY) {
                            var newLkp = raf.length();

                            if (newLkp > lkp) {
                                // New lines have been added
                                raf.seek(lkp);
                                var line;
                                var content = [];
                                while ((line = raf.readLine()) != null) {
                                    if (line.indexOf('SystemOut                                                    O') > 0) {
                                        line = line.substring(line.indexOf('SystemOut                                                    O') + 63);
                                    }
                                    content.push(line);
                                }

                                output.write(new ServerSentEvent(count++, 'log', JSON.stringify(content)).sse());
                                output.flush();

                                lkp = raf.length();
                            } else if (newLkp < lkp) {
                                // The file was likely truncated, restarting
                                lkp = raf.length();
                                raf.seek(lkp);
                            }
                        }
                    }

                    // IMPORTANT: Reset the key to continue receiving future events
                    if (!key.reset()) {
                        System.err.println('WatchKey is no longer valid. Exiting.');
                        break; // Exit the loop if the directory is no longer accessible
                    }
                }
            } catch (error) {
                if (error instanceof Java.type('java.io.IOException')) {
                    FixedLoggers.MAXIMOLOGGER.error('Closing user session due to client disconnect while streaming the Maximo log for user: ' + userInfo.getUserName());
                } else {
                    FixedLoggers.MAXIMOLOGGER.error('Closing user session due to an unexpected error while streaming the Maximo log for user: ' + userInfo.getUserName(), error);
                }

                return;
            } finally {
                if (watchService) {
                    watchService.close();
                }
            }
        } else {
            responseBody = JSON.stringify({
                status: 'error',
                message: 'The log file ' + logFile.getPath() + ' could not be opened.',
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

        if (factory instanceof Java.type('org.apache.logging.log4j.core.impl.Log4jContextFactory')) {
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
                    maxLogAppenderSet = MXServer.getMXServer().getMboSet('MAXLOGAPPENDER', userInfo);

                    var sqlf = new SqlFormat('appender = :1');
                    sqlf.setObject(1, 'MAXLOGAPPENDER', 'APPENDER', 'Console');
                    maxLogAppenderSet.setWhere(sqlf.format());

                    var pattern = '%d{dd MMM yyyy HH:mm:ss:SSS} [%-2p] [%s] [%q] %m%n';

                    if (!maxLogAppenderSet.isEmpty()) {
                        pattern = maxLogAppenderSet.moveFirst().getString('CONVPATTERN');
                    }

                    var layout = PatternLayout.newBuilder().withPattern(pattern).build();
                    var root = context.getLogger('maximo');
                    var writer = WriterAppender.createAppender(layout, null, new OutputStreamWriter(output), false, appenderName, true);
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
                    message: 'A logging context with the maximo root logger could not be found.',
                });
            }
        } else {
            responseBody = JSON.stringify({
                status: 'error',
                message: 'Only the default org.apache.logging.log4j.core.impl.Log4jContextFactory context factory is supported.',
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
                    message: 'The standard Console log appender is not configured for the root maximo logger.',
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

function proxyRequest(host) {
    var apiKey = null;
    var response = request.getHttpServletResponse();
    try {
        if (typeof host !== 'undefined' && host !== null) {
            apiKey = getAPIKey(userInfo.getUserName());

            var SERVICE_URL = 'http://' + host + ':9080/maximo/api/script/NAVIAM.AUTOSCRIPT.LOGGING?apikey=' + apiKey.apiKey;

            var backendConnection = null;
            var clientOutputStream = null;

            try {
                // set the buffer to zero so messages are immediately sent to the client.
                response.setBufferSize(0);
                // set the response type as text/event-stream to indicate that an event stream is being sent.
                response.setContentType('text/event-stream');
                // indicate that the connection should be kept alive
                response.addHeader('Connection', 'keep-alive');
                // indicate to the client that the cache should not be used.
                response.addHeader('Cache-Control', 'no-cache');
                // in case NGINX is used, we need to disable buffering so that the response is sent immediately.
                response.addHeader('X-Accel-Buffering', 'no');
                // stop the server from buffering the response for compression.
                response.setHeader('Content-Encoding', 'none');
                response.flushBuffer();

                // 1. Create a connection to the backend service.
                var backendUrl = new URL(SERVICE_URL);
                backendConnection = backendUrl.openConnection();
                backendConnection.setRequestMethod('GET');

                // It's good practice to set timeouts.
                backendConnection.setConnectTimeout(5000); // 5 seconds
                backendConnection.setReadTimeout(0); // No timeout for reading the stream

                // 3. Get the input stream from the backend and the output stream for the client.
                // Using try-with-resources ensures the streams are closed automatically.
                backendInputStream = backendConnection.getInputStream();
                clientOutputStream = response.getOutputStream();

                // 4. Read from the backend and write to the client in a loop.
                // This is the core of the streaming mechanism.
                var buffer = new ByteArray(4096);
                var bytesRead = 0;

                // The loop continues as long as the backend is sending data.
                // read() will return -1 when the stream is closed by the backend.
                while ((bytesRead = backendInputStream.read(buffer)) != -1) {
                    clientOutputStream.write(buffer, 0, bytesRead);
                    // Flush the output stream to ensure the client receives the data immediately.
                    clientOutputStream.flush();
                }
            } finally {
                // 5. Ensure the backend connection is disconnected to free up
                //  resources.
                if (backendConnection != null) {
                    backendConnection.disconnect();
                }
                if (clientOutputStream != null) {
                    clientOutputStream.close();
                }
            }
        }
    } catch (error) {
        FixedLoggers.MAXIMOLOGGER.error('Closing user session due to an unexpected error while streaming the Maximo log for user: ' + userInfo.getUserName());
        Java.type('java.lang.System').out.println('Error occurred: ' + error);
    } finally {
        if (apiKey != null && apiKey.deleteAfterUse) {
            deleteAPIKeyForUser(userInfo.getUserName());
        }
    }
}

function deleteAPIKeyForUser(userName) {
    var apiKeyTokenSet = MXServer.getMXServer().getMboSet('APIKEYTOKEN', MXServer.getMXServer().getSystemUserInfo());
    try {
        var sqlf = new SqlFormat('userid = :1');
        sqlf.setObject(1, 'APIKEYTOKEN', 'USERID', userName);

        apiKeyTokenSet.setWhere(sqlf.format());
        var apiKeyToken = apiKeyTokenSet.moveFirst();
        if (apiKeyToken != null) {
            apiKeyToken.delete();
            apiKeyTokenSet.save();
        }
    } finally {
        apiKeyTokenSet.close();
    }
}

function getAPIKey(userName) {
    var response = {
        deleteAfterUse: false,
    };
    var apiKeyTokenSet = MXServer.getMXServer().getMboSet('APIKEYTOKEN', MXServer.getMXServer().getSystemUserInfo());
    try {
        var sqlf = new SqlFormat('userid = :1');
        sqlf.setObject(1, 'APIKEYTOKEN', 'USERID', userName);

        apiKeyTokenSet.setWhere(sqlf.format());
        var apiKeyToken = apiKeyTokenSet.moveFirst();
        if (apiKeyToken == null) {
            apiKeyToken = apiKeyTokenSet.add();

            // Create a token for 24 hours.
            apiKeyToken.setValue('EXPIRATION', 24 * 60);
            apiKeyToken.setValue('USERID', userName);
            apiKeyTokenSet.save();

            response.deleteAfterUse = true;
        }

        var cipher = new MXCipher(MXServer.getMXServer());

        response.apiKey = cipher.decData(DatatypeConverter.parseBase64Binary(apiKeyToken.getString('APIKEY')));
        return response;
    } finally {
        apiKeyTokenSet.close();
    }
}

function initSecurity() {
    var sigOptionSet;
    var appAuthSet;
    try {
        sigOptionSet = MXServer.getMXServer().getMboSet('SIGOPTION', MXServer.getMXServer().getSystemUserInfo());

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

            var adminGroup = MXServer.getMXServer().lookup('MAXVARS').getString('ADMINGROUP', null);

            appAuthSet = MXServer.getMXServer().getMboSet('APPLICATIONAUTH', MXServer.getMXServer().getSystemUserInfo());
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
    return MXServer.getMXServer().lookup('SECURITY').getProfile(userInfo).hasAppOption(app, optionName);
}

function isAdmin() {
    var user = userInfo.getUserName();
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
    autoscript: 'NAVIAM.AUTOSCRIPT.LOGGING',
    description: 'Naviam Script to Stream Log Files.',
    version: '1.0.0',
    active: true,
    logLevel: 'ERROR',
};
