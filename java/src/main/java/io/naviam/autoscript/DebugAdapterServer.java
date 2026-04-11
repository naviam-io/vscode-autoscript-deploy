package io.naviam.autoscript;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ibm.tivoli.maximo.script.ScriptInfo;
import com.ibm.tivoli.maximo.script.ScriptService;
import psdi.mbo.MboRemote;
import psdi.mbo.MboSetRemote;
import psdi.security.UserInfo;
import psdi.server.MXServer;
import psdi.util.logging.MXLogger;
import psdi.util.logging.MXLoggerFactory;

import org.python.core.Py;
import org.python.core.PyFrame;
import org.python.core.PyObject;
import org.python.core.PyStringMap;
import org.python.util.PythonInterpreter;

import java.beans.BeanInfo;
import java.beans.Introspector;
import java.beans.PropertyDescriptor;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Modifier;
import java.lang.reflect.Method;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.rmi.RemoteException;
import java.util.ArrayList;
import java.util.ArrayDeque;
import java.util.Collection;
import java.util.Deque;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import javax.script.ScriptContext;
import javax.script.ScriptEngine;
import javax.script.ScriptEngineManager;
import javax.script.ScriptException;
import javax.script.SimpleBindings;
import javax.script.SimpleScriptContext;

/**
 * Minimal Debug Adapter Protocol server used to attach VS Code to Maximo automation scripts.
 */
public final class DebugAdapterServer {
    private static final MXLogger LOGGER = MXLoggerFactory.getLogger("maximo.naviam.debug");
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {
    };
    private static final DebugAdapterServer INSTANCE = new DebugAdapterServer();
    private static final int MAX_VARIABLE_DEPTH = 4;
    private static final int MAX_BEAN_PROPERTIES = 100;
    private static final int MAX_FIELDS = 200;
    private static final int MAX_COLLECTION_ITEMS = 100;
    private static final int MAX_METHODS = 150;
    private static final String CLIENT_IDLE_TIMEOUT_PROPERTY = "naviam.autoscript.debug.client.idleTimeout";
    private static final String CLIENT_LIVENESS_POLL_PROPERTY = "naviam.autoscript.debug.client.poll";
    private static final int DEFAULT_CLIENT_IDLE_TIMEOUT_MS = 0;
    private static final int DEFAULT_CLIENT_LIVENESS_POLL_MS = 1000;
    private static final ScriptEngineManager SCRIPT_ENGINE_MANAGER = new ScriptEngineManager();

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final AtomicBoolean started = new AtomicBoolean(false);
    private final AtomicInteger outgoingSeq = new AtomicInteger(1);
    private final AtomicInteger variableRefSeq = new AtomicInteger(1000);
    private final Object pauseMonitor = new Object();
    private final Map<Integer, Object> variableReferences = new ConcurrentHashMap<>();
    private final Map<String, Map<Integer, BreakpointDefinition>> breakpointsByScript = new ConcurrentHashMap<>();
    private final ThreadLocal<Integer> javaScriptFunctionDepth = ThreadLocal.withInitial(() -> 0);
    private final ThreadLocal<JavaScriptTraceState> javaScriptTraceState = ThreadLocal.withInitial(JavaScriptTraceState::new);

    private volatile ServerSocket serverSocket;
    private volatile Socket clientSocket;
    private volatile BufferedInputStream clientInput;
    private volatile BufferedOutputStream clientOutput;
    private volatile PauseState pauseState;
    private volatile Map<String, String> scriptPathIndex = Map.of();
    private volatile StepState stepState;
    private volatile long lastClientActivityMillis;

    private DebugAdapterServer() {
    }

    /**
     * Returns the singleton adapter instance shared by the custom script driver.
     *
     * @return singleton server instance
     */
    public static DebugAdapterServer getInstance() {
        return INSTANCE;
    }

    /**
     * Indicates whether debugging is enabled through Maximo or JVM properties.
     *
     * @return {@code true} when the server should accept debugger traffic
     */
    public boolean isEnabled() {
        return readBooleanProperty("naviam.autoscript.debug.enabled", false);
    }

    /**
     * Starts the socket listener once for the current JVM if debugging is enabled.
     */
    public void ensureStarted() {
        if (!isEnabled() || started.get()) {
            return;
        }
        synchronized (this) {
            if (!isEnabled() || started.get()) {
                return;
            }
            try {
                int port = readIntProperty("naviam.autoscript.debug.port", 4711);
                String host = readProperty("naviam.autoscript.debug.host");
                if (host == null || host.isBlank()) {
                    host = "0.0.0.0";
                }
                serverSocket = new ServerSocket(port, 1, InetAddress.getByName(host));
                Thread acceptThread = new Thread(this::acceptLoop, "autoscript-debug-adapter");
                acceptThread.setDaemon(true);
                acceptThread.start();
                started.set(true);
                LOGGER.info("Started automation script debug adapter on " + host + ":" + port);
            } catch (IOException e) {
                LOGGER.error("Failed to start automation script debug adapter", e);
            }
        }
    }

    /**
     * Stops the listener and releases any attached client so a hot-reloaded driver can restart cleanly.
     */
    public synchronized void shutdown() {
        PauseState state = pauseState;
        clearStepState();
        if (state != null) {
            state.resume();
        }
        closeClient();
        closeQuietly(serverSocket);
        serverSocket = null;
        started.set(false);
        scriptPathIndex = Map.of();
        breakpointsByScript.clear();
        variableReferences.clear();
        pauseState = null;
    }

    /**
     * Creates the bridge object injected into the script execution context.
     *
     * @param scriptInfo active script metadata
     * @param context    current Maximo script bindings
     * @return bridge exposed to the script as {@code debugger}
     */
    public DebugBridge createBridge(ScriptInfo scriptInfo, Map<String, Object> context) {
        return new DebugBridge(this, scriptInfo, context);
    }

    /**
     * Suspends the current script and reports a breakpoint-style stop.
     *
     * @param scriptInfo active script metadata
     * @param context    current script bindings
     * @param reason     text shown to the debugger user
     * @param lineNumber 1-based line to report, or {@code null} when unknown
     */
    @SuppressWarnings("unused")
    public void pause(ScriptInfo scriptInfo, Map<String, Object> context, String reason, Integer lineNumber) {
        pause(scriptInfo, context, reason, lineNumber, "breakpoint");
    }

    /**
     * Suspends the current script with an explicit Debug Adapter Protocol stop reason.
     *
     * @param scriptInfo active script metadata
     * @param context    current script bindings
     * @param reason     text shown to the debugger user
     * @param lineNumber 1-based line to report, or {@code null} when unknown
     * @param stopReason DAP stop reason such as {@code breakpoint} or {@code step}
     */
    public void pause(ScriptInfo scriptInfo, Map<String, Object> context, String reason, Integer lineNumber, String stopReason) {
        pause(scriptInfo, context, reason, lineNumber, stopReason, null);
    }

    /**
     * Suspends execution, snapshots visible variables, and blocks until the client resumes the script.
     *
     * @param scriptInfo active script metadata
     * @param context    current script bindings
     * @param reason     text shown to the debugger user
     * @param lineNumber 1-based line to report, or {@code null} when unknown
     * @param stopReason DAP stop reason such as {@code breakpoint} or {@code step}
     * @param frame      current live Jython frame when available
     */
    public void pause(
            ScriptInfo scriptInfo,
            Map<String, Object> context,
            String reason,
            Integer lineNumber,
            String stopReason,
            PyFrame frame
    ) {
        if (!isClientConnected()) {
            LOGGER.debug("Skipping debugger pause because no client is attached");
            return;
        }

        synchronized (pauseMonitor) {
            if (pauseState != null) {
                LOGGER.warn("Skipping debugger pause because another script is already suspended");
                return;
            }

            variableReferences.clear();
            PauseState state = PauseState.from(scriptInfo, context, reason, lineNumber, frame);
            pauseState = state;
            registerPauseVariables(state);
            if (LOGGER.isDebugEnabled()) {
                LOGGER.debug("Pausing script " + state.scriptName
                        + " at line " + state.lineNumber
                        + " on thread " + state.threadId
                        + " with stopReason=" + stopReason);
            }

            sendEvent("stopped", Map.of(
                    "reason", stopReason,
                    "threadId", state.threadId,
                    "allThreadsStopped", true,
                    "description", state.reason,
                    "text", state.reason
            ));

            try {
                awaitResumeOrTerminate(state);
            } finally {
                if (LOGGER.isDebugEnabled()) {
                    LOGGER.debug("Pause completed for script " + state.scriptName + " on thread " + state.threadId);
                }
                pauseState = null;
                variableReferences.clear();
            }
        }
    }

    /**
     * Evaluates line-level breakpoint and step state for a traced Jython frame.
     *
     * @param scriptInfo active script metadata
     * @param context    current script bindings
     * @param lineNumber 1-based line currently being executed
     * @param frame      current Jython frame
     */
    public void traceLine(ScriptInfo scriptInfo, Map<String, Object> context, int lineNumber, PyFrame frame) {
        int frameDepth = pythonFrameDepth(frame);
        boolean breakpoint = shouldStopForPythonBreakpoint(scriptInfo.getName(), lineNumber, context, frame);
        boolean stepping = shouldStopForStep(scriptInfo.getName(), lineNumber, frameDepth);
        if (!breakpoint && !stepping) {
            return;
        }
        if (LOGGER.isDebugEnabled()) {
            LOGGER.debug("Python stop for script " + scriptInfo.getName()
                    + " line=" + lineNumber
                    + " breakpoint=" + breakpoint
                    + " stepping=" + stepping);
        }

        if (stepping) {
            clearStepState();
        }
        pause(scriptInfo, context, stepping ? "Step" : "Breakpoint", lineNumber, stepping ? "step" : "breakpoint", frame);
    }

    /**
     * Evaluates breakpoint and step state for instrumented Nashorn line events.
     *
     * @param scriptInfo active script metadata
     * @param context    current script bindings
     * @param lineNumber 1-based line currently being executed
     * @param locals     instrumented snapshot of visible JavaScript bindings
     */
    public void traceJavaScriptLine(ScriptInfo scriptInfo, Map<String, Object> context, int lineNumber, Object locals) {
        updateJavaScriptCurrentLine(lineNumber);
        int frameDepth = currentJavaScriptDepth();
        boolean breakpoint = shouldStopForJavaScriptBreakpoint(scriptInfo.getName(), lineNumber, context, locals);
        boolean stepping = shouldStopForStep(scriptInfo.getName(), lineNumber, frameDepth);
        if (!breakpoint && !stepping) {
            return;
        }
        if (LOGGER.isDebugEnabled()) {
            LOGGER.debug("JavaScript stop for script " + scriptInfo.getName()
                    + " line=" + lineNumber
                    + " breakpoint=" + breakpoint
                    + " stepping=" + stepping);
        }

        if (stepping) {
            clearStepState();
        }
        pauseJavaScript(scriptInfo, context, stepping ? "Step" : "Breakpoint", lineNumber, stepping ? "step" : "breakpoint", locals);
    }

    /**
     * Marks entry into an instrumented JavaScript function for step semantics.
     *
     * @param functionName reported function name, or a placeholder when anonymous
     * @param lineNumber   1-based line where the function was entered
     */
    public void enterJavaScriptFunction(String functionName, int lineNumber) {
        javaScriptFunctionDepth.set(javaScriptFunctionDepth.get() + 1);
        javaScriptTraceState.get().frames.addLast(new JavaScriptFrameMarker(
                functionName == null || functionName.isBlank() ? "<anonymous>" : functionName,
                lineNumber
        ));
    }

    /**
     * Marks exit from an instrumented JavaScript function for step semantics.
     */
    public void exitJavaScriptFunction() {
        int depth = javaScriptFunctionDepth.get();
        Deque<JavaScriptFrameMarker> frames = javaScriptTraceState.get().frames;
        if (!frames.isEmpty()) {
            frames.removeLast();
        }
        if (depth <= 1) {
            javaScriptFunctionDepth.remove();
            javaScriptTraceState.remove();
            return;
        }
        javaScriptFunctionDepth.set(depth - 1);
    }

    /**
     * Suspends execution for an instrumented JavaScript line event.
     *
     * @param scriptInfo active script metadata
     * @param context    current script bindings
     * @param reason     text shown to the debugger user
     * @param lineNumber 1-based line to report, or {@code null} when unknown
     * @param stopReason DAP stop reason such as {@code breakpoint} or {@code step}
     * @param locals     instrumented snapshot of visible JavaScript bindings
     */
    public void pauseJavaScript(
            ScriptInfo scriptInfo,
            Map<String, Object> context,
            String reason,
            Integer lineNumber,
            String stopReason,
            Object locals
    ) {
        if (!isClientConnected()) {
            LOGGER.debug("Skipping debugger pause because no client is attached");
            return;
        }

        synchronized (pauseMonitor) {
            if (pauseState != null) {
                LOGGER.warn("Skipping debugger pause because another script is already suspended");
                return;
            }

            variableReferences.clear();
            PauseState state = PauseState.fromJavaScript(
                    scriptInfo,
                    context,
                    reason,
                    lineNumber,
                    locals
            );
            pauseState = state;
            registerPauseVariables(state);
            if (LOGGER.isDebugEnabled()) {
                LOGGER.debug("Pausing JavaScript script " + state.scriptName
                        + " at line " + state.lineNumber
                        + " on thread " + state.threadId
                        + " with stopReason=" + stopReason);
            }

            sendEvent("stopped", Map.of(
                    "reason", stopReason,
                    "threadId", state.threadId,
                    "allThreadsStopped", true,
                    "description", state.reason,
                    "text", state.reason
            ));

            try {
                awaitResumeOrTerminate(state);
            } finally {
                if (LOGGER.isDebugEnabled()) {
                    LOGGER.debug("JavaScript pause completed for script " + state.scriptName + " on thread " + state.threadId);
                }
                pauseState = null;
                variableReferences.clear();
            }
        }
    }

    /**
     * Checks whether any line breakpoints are registered for the named script.
     *
     * @param scriptName Maximo automation script name
     * @return {@code true} when at least one breakpoint is registered
     */
    public boolean hasBreakpoints(String scriptName) {
        Map<Integer, BreakpointDefinition> breakpoints = breakpointsByScript.get(scriptName.toUpperCase());
        return breakpoints != null && !breakpoints.isEmpty();
    }

    /**
     * Emits stdout or stderr text to the connected debugger console.
     *
     * @param text     output text to forward
     * @param category DAP output category such as {@code stdout} or {@code stderr}
     */
    public void emitOutput(String text, String category) {
        if (text == null || text.isEmpty() || !isClientConnected()) {
            return;
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("category", category == null || category.isBlank() ? "stdout" : category);
        body.put("output", text);
        sendEvent("output", body);
    }

    /**
     * Indicates whether a debugger client is currently attached to the in-process adapter.
     *
     * @return {@code true} when a client socket is currently connected
     */
    public boolean isClientAttached() {
        return isClientConnected();
    }

    private void acceptLoop() {
        while (true) {
            try {
                ServerSocket socket = serverSocket;
                if (socket == null || socket.isClosed()) {
                    return;
                }
                Socket accepted = socket.accept();
                attachClient(accepted);
            } catch (IOException e) {
                ServerSocket socket = serverSocket;
                if (socket == null || socket.isClosed()) {
                    LOGGER.info("Debug adapter accept loop stopped");
                } else {
                    LOGGER.error("Debug adapter accept loop stopped", e);
                }
                closeClient();
                return;
            }
        }
    }

    /**
     * Attaches a newly accepted debugger client socket and starts a reader loop.
     *
     * @param socket accepted debugger socket
     * @throws IOException when socket streams cannot be initialized
     */
    private void attachClient(Socket socket) throws IOException {
        closeClient();
        socket.setKeepAlive(true);
        clientSocket = socket;
        clientInput = new BufferedInputStream(socket.getInputStream());
        clientOutput = new BufferedOutputStream(socket.getOutputStream());
        markClientActivity();
        Thread readerThread = new Thread(this::readLoop, "autoscript-debug-client");
        readerThread.setDaemon(true);
        readerThread.start();
        LOGGER.info("VS Code debug client connected from " + socket.getRemoteSocketAddress());
    }

    /**
     * Processes incoming DAP client messages until the socket closes or an I/O error occurs.
     */
    private void readLoop() {
        try {
            while (true) {
                Map<String, Object> message = readMessage();
                if (message == null) {
                    return;
                }
                handleRequest(message);
            }
        } catch (IOException e) {
            LOGGER.error("Debug adapter client connection dropped", e);
        } finally {
            terminateClientSession("reader loop ended");
        }
    }

    /**
     * Reads one framed DAP message from the connected client.
     *
     * @return parsed request/response map, or {@code null} when the stream ends cleanly
     * @throws IOException when framing or payload decoding fails
     */
    private Map<String, Object> readMessage() throws IOException {
        BufferedInputStream input = clientInput;
        if (input == null) {
            return null;
        }

        int contentLength = -1;
        String line;
        // DAP frames each JSON message with RFC-822-style headers followed by a blank line.
        while (!(line = readHeaderLine(input)).isEmpty()) {
            if (line.startsWith("Content-Length:")) {
                contentLength = Integer.parseInt(line.substring("Content-Length:".length()).trim());
            }
        }

        if (contentLength < 0) {
            return null;
        }

        byte[] payload = input.readNBytes(contentLength);
        if (payload.length != contentLength) {
            return null;
        }
        return objectMapper.readValue(payload, MAP_TYPE);
    }

    /**
     * Reads a single CRLF-terminated DAP header line.
     *
     * @param input client input stream
     * @return header line text without the trailing CRLF
     * @throws IOException when the stream ends unexpectedly or framing is malformed
     */
    private String readHeaderLine(BufferedInputStream input) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        while (true) {
            int next = input.read();
            if (next < 0) {
                throw new IOException("Unexpected end of stream while reading DAP header");
            }
            if (next == '\r') {
                int lineFeed = input.read();
                if (lineFeed != '\n') {
                    throw new IOException("Malformed DAP header");
                }
                return buffer.toString(StandardCharsets.US_ASCII);
            }
            buffer.write(next);
        }
    }

    private void handleRequest(Map<String, Object> message) {
        String type = stringValue(message.get("type"));
        if (!"request".equals(type)) {
            return;
        }
        markClientActivity();

        int requestSeq = intValue(message.get("seq"), 0);
        String command = stringValue(message.get("command"));
        Map<String, Object> arguments = mapValue(message.get("arguments"));
        if (LOGGER.isDebugEnabled()) {
            LOGGER.debug("DAP request seq=" + requestSeq + " command=" + command);
        }

        switch (command) {
            case "initialize" -> {
                sendResponse(requestSeq, command, true, null, Map.of(
                        "supportsConfigurationDoneRequest", true,
                        "supportsStepBack", false,
                        "supportsSetVariable", false,
                        "supportsStepInTargetsRequest", false,
                        "supportsConditionalBreakpoints", true
                ));
                sendEvent("initialized", Map.of());
            }
            case "attach" -> {
                scriptPathIndex = parseStringMap(arguments.get("scriptIndex"));
                LOGGER.info("Registered " + scriptPathIndex.size() + " local script mappings for VS Code session");
                sendResponse(requestSeq, command, true, null, Map.of());
            }
            case "setBreakpoints" -> sendResponse(requestSeq, command, true, null, handleSetBreakpoints(arguments));
            case "configurationDone", "setExceptionBreakpoints" -> sendResponse(requestSeq, command, true, null, Map.of(
                    "breakpoints", List.of()
            ));
            case "threads" -> sendResponse(requestSeq, command, true, null, Map.of(
                    "threads", List.of(Map.of("id", currentThreadId(), "name", currentThreadName()))
            ));
            case "stackTrace" -> sendResponse(requestSeq, command, true, null, buildStackTraceBody());
            case "scopes" -> sendResponse(requestSeq, command, true, null, buildScopesBody(arguments));
            case "variables" -> sendResponse(requestSeq, command, true, null, buildVariablesBody(arguments));
            case "source" -> sendResponse(requestSeq, command, true, null, buildSourceBody(arguments));
            case "evaluate" -> sendResponse(requestSeq, command, true, null, buildEvaluateBody(arguments));
            case "autoscript/ping" -> sendResponse(requestSeq, command, true, null, Map.of());
            case "continue" -> {
                PauseState state = pauseState;
                clearStepState();
                if (state != null) {
                    sendEvent("continued", Map.of(
                            "threadId", state.threadId,
                            "allThreadsContinued", true
                    ));
                    state.resume();
                }
                sendResponse(requestSeq, command, true, null, Map.of("allThreadsContinued", true));
            }
            case "next" -> {
                PauseState state = pauseState;
                if (state != null) {
                    stepState = StepState.stepOver(state);
                    sendEvent("continued", Map.of(
                            "threadId", state.threadId,
                            "allThreadsContinued", true
                    ));
                    state.resume();
                }
                sendResponse(requestSeq, command, true, null, Map.of());
            }
            case "stepIn" -> {
                PauseState state = pauseState;
                if (state != null) {
                    stepState = StepState.stepIn(state);
                    sendEvent("continued", Map.of(
                            "threadId", state.threadId,
                            "allThreadsContinued", true
                    ));
                    state.resume();
                }
                sendResponse(requestSeq, command, true, null, Map.of());
            }
            case "stepOut" -> {
                PauseState state = pauseState;
                if (state != null) {
                    stepState = StepState.stepOut(state);
                    sendEvent("continued", Map.of(
                            "threadId", state.threadId,
                            "allThreadsContinued", true
                    ));
                    state.resume();
                }
                sendResponse(requestSeq, command, true, null, Map.of());
            }
            case "disconnect" -> {
                sendResponse(requestSeq, command, true, null, Map.of());
                terminateClientSession("client requested disconnect");
            }
            default -> sendResponse(requestSeq, command, false, "Unsupported command: " + command, Map.of());
        }
    }

    private Map<String, Object> buildStackTraceBody() {
        PauseState state = pauseState;
        if (state == null) {
            return Map.of("stackFrames", List.of(), "totalFrames", 0);
        }

        List<Map<String, Object>> stackFrames = new ArrayList<>();
        for (StackFrameState frameState : state.frames) {
            Map<String, Object> frame = new LinkedHashMap<>();
            frame.put("id", frameState.frameId);
            frame.put("name", frameState.frameName);
            frame.put("line", frameState.lineNumber);
            frame.put("column", 1);
            frame.put("source", buildSourceDescriptor(state, frameState.sourceReference));
            stackFrames.add(frame);
        }

        return Map.of("stackFrames", stackFrames, "totalFrames", stackFrames.size());
    }

    private Map<String, Object> buildScopesBody(Map<String, Object> arguments) {
        PauseState state = pauseState;
        if (state == null) {
            return Map.of("scopes", List.of());
        }

        StackFrameState frame = resolveFrame(state, intValue(arguments.get("frameId"), -1));
        if (frame == null) {
            return Map.of("scopes", List.of());
        }

        return Map.of("scopes", List.of(Map.of(
                "name", "Locals",
                "presentationHint", "locals",
                "variablesReference", frame.localsReference,
                "expensive", false
        )));
    }

    private Map<String, Object> buildVariablesBody(Map<String, Object> arguments) {
        int reference = intValue(arguments.get("variablesReference"), -1);
        List<Map<String, Object>> variables = resolveVariables(reference);
        return Map.of("variables", variables);
    }

    @SuppressWarnings("ExtractMethodRecommender")
    private Map<String, Object> handleSetBreakpoints(Map<String, Object> arguments) {
        Map<String, Object> source = mapValue(arguments.get("source"));
        String scriptName = resolveScriptName(source);
        if (scriptName == null) {
            if (LOGGER.isDebugEnabled()) {
                LOGGER.debug("Skipping setBreakpoints because script name could not be resolved from source=" + source);
            }
            return Map.of("breakpoints", List.of());
        }

        Map<Integer, BreakpointDefinition> requestedBreakpoints = new LinkedHashMap<>();
        Object breakpointsValue = arguments.get("breakpoints");
        if (breakpointsValue instanceof List<?> breakpoints) {
            for (Object breakpoint : breakpoints) {
                Map<String, Object> breakpointMap = mapValue(breakpoint);
                int line = intValue(breakpointMap.get("line"), -1);
                if (line > 0) {
                    requestedBreakpoints.put(line, new BreakpointDefinition(line, stringValue(breakpointMap.get("condition"))));
                }
            }
        }

        if (requestedBreakpoints.isEmpty()) {
            Object linesValue = arguments.get("lines");
            if (linesValue instanceof List<?> lines) {
                for (Object lineObject : lines) {
                    int line = intValue(lineObject, -1);
                    if (line > 0) {
                        requestedBreakpoints.put(line, new BreakpointDefinition(line, ""));
                    }
                }
            }
        }

        if (requestedBreakpoints.isEmpty()) {
            breakpointsByScript.remove(scriptName);
        } else {
            breakpointsByScript.put(scriptName, requestedBreakpoints);
        }
        if (LOGGER.isDebugEnabled()) {
            LOGGER.debug("Registered breakpoint lines for script " + scriptName + ": " + requestedBreakpoints.keySet());
        }

        List<Map<String, Object>> verifiedBreakpoints = new ArrayList<>();
        for (BreakpointDefinition breakpoint : requestedBreakpoints.values()) {
            Map<String, Object> verified = new LinkedHashMap<>();
            verified.put("verified", true);
            verified.put("line", breakpoint.lineNumber);
            if (!breakpoint.condition.isBlank()) {
                verified.put("message", "Conditional breakpoint");
            }
            verifiedBreakpoints.add(verified);
        }

        LOGGER.info("Registered " + requestedBreakpoints.size() + " breakpoints for script " + scriptName);
        return Map.of("breakpoints", verifiedBreakpoints);
    }

    private Map<String, Object> buildSourceBody(Map<String, Object> arguments) {
        PauseState state = pauseState;
        if (state == null) {
            return Map.of("content", "");
        }

        int sourceReference = intValue(arguments.get("sourceReference"), -1);
        if (!state.hasSourceReference(sourceReference)) {
            return Map.of("content", "");
        }

        return Map.of(
                "content", state.scriptSource == null ? "" : state.scriptSource,
                "mimeType", state.mimeType
        );
    }

    private Map<String, Object> buildEvaluateBody(Map<String, Object> arguments) {
        PauseState state = pauseState;
        if (state == null) {
            return Map.of("result", "<no paused frame>", "variablesReference", 0);
        }

        String expression = stringValue(arguments.get("expression"));
        if (expression.isBlank()) {
            return Map.of("result", "", "variablesReference", 0);
        }

        StackFrameState frame = resolveFrame(state, intValue(arguments.get("frameId"), -1));
        if (frame == null) {
            return Map.of("result", "<no paused frame>", "variablesReference", 0);
        }

        if (frame.jsBindings != null) {
            return evaluateJavaScriptExpression(expression, frame.jsBindings);
        }

        try {
            PyObject globals = frame.frameGlobals == null ? Py.newStringMap() : frame.frameGlobals;
            PyObject locals = frame.frameLocals == null ? globals : frame.frameLocals;
            try (PythonInterpreter interpreter = new PythonInterpreter(globals, Py.getSystemState())) {
                interpreter.setLocals(locals);
                Object evaluated = pyToJava(interpreter.eval(expression));

                Map<String, Object> variable = createVariable("result", evaluated, 0, new IdentityHashMap<>());
                int variablesReference = intValue(variable.get("variablesReference"), 0);

                return Map.of(
                        "result", stringValue(variable.get("value")),
                        "type", stringValue(variable.get("type")),
                        "variablesReference", variablesReference
                );
            }
        } catch (Exception e) {
            return Map.of(
                    "result", "<error: " + e.getClass().getSimpleName() + ": " + stringValue(e.getMessage()) + ">",
                    "variablesReference", 0
            );
        }
    }

    private Map<String, Object> evaluateJavaScriptExpression(String expression, Map<String, Object> jsBindings) {
        ScriptEngine engine = SCRIPT_ENGINE_MANAGER.getEngineByName("nashorn");
        if (engine == null) {
            return Map.of("result", "<nashorn engine unavailable>", "variablesReference", 0);
        }

        try {
            SimpleScriptContext scriptContext = new SimpleScriptContext();
            scriptContext.setBindings(new SimpleBindings(new LinkedHashMap<>(jsBindings)), ScriptContext.ENGINE_SCOPE);
            Object evaluated = engine.eval(expression, scriptContext);
            Map<String, Object> variable = createVariable("result", evaluated, 0, new IdentityHashMap<>());
            int variablesReference = intValue(variable.get("variablesReference"), 0);
            return Map.of(
                    "result", stringValue(variable.get("value")),
                    "type", stringValue(variable.get("type")),
                    "variablesReference", variablesReference
            );
        } catch (ScriptException e) {
            return Map.of(
                    "result", "<error: " + e.getClass().getSimpleName() + ": " + stringValue(e.getMessage()) + ">",
                    "variablesReference", 0
            );
        }
    }

    private boolean evaluatePythonCondition(String expression, Map<String, Object> context, PyFrame frame) {
        try {
            Map<String, Object> mergedContext = mergeVisibleContext(context, frame);
            PyObject globals = frame == null || frame.f_globals == null ? Py.newStringMap() : frame.f_globals;
            try (PythonInterpreter interpreter = new PythonInterpreter(globals, Py.getSystemState())) {
                PyStringMap locals = new PyStringMap();
                for (Map.Entry<String, Object> entry : mergedContext.entrySet()) {
                    if (entry.getKey() != null) {
                        locals.__setitem__(entry.getKey(), Py.java2py(entry.getValue()));
                    }
                }
                interpreter.setLocals(locals);
                return isTruthy(pyToJava(interpreter.eval(expression)));
            }
        } catch (Exception e) {
            LOGGER.warn("Failed to evaluate Python breakpoint condition: " + expression, e);
            return false;
        }
    }

    private boolean evaluateJavaScriptCondition(String expression, Map<String, Object> jsBindings) {
        ScriptEngine engine = SCRIPT_ENGINE_MANAGER.getEngineByName("nashorn");
        if (engine == null) {
            return false;
        }

        try {
            SimpleScriptContext scriptContext = new SimpleScriptContext();
            scriptContext.setBindings(new SimpleBindings(new LinkedHashMap<>(jsBindings)), ScriptContext.ENGINE_SCOPE);
            return isTruthy(engine.eval(expression, scriptContext));
        } catch (ScriptException e) {
            LOGGER.warn("Failed to evaluate JavaScript breakpoint condition: " + expression, e);
            return false;
        }
    }

    private void sendEvent(String event, Map<String, Object> body) {
        sendMessage(new LinkedHashMap<>(Map.of(
                "seq", outgoingSeq.getAndIncrement(),
                "type", "event",
                "event", event,
                "body", body
        )));
    }

    private void sendResponse(int requestSeq, String command, boolean success, String message, Map<String, Object> body) {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("seq", outgoingSeq.getAndIncrement());
        response.put("type", "response");
        response.put("request_seq", requestSeq);
        response.put("success", success);
        response.put("command", command);
        if (message != null) {
            response.put("message", message);
        }
        response.put("body", body);
        sendMessage(response);
    }

    private void sendMessage(Map<String, Object> message) {
        BufferedOutputStream output = clientOutput;
        if (output == null) {
            return;
        }

        try {
            byte[] json = objectMapper.writeValueAsBytes(message);
            byte[] header = ("Content-Length: " + json.length + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII);
            synchronized (this) {
                output.write(header);
                output.write(json);
                output.flush();
            }
        } catch (IOException e) {
            LOGGER.error("Failed to send DAP message", e);
            terminateClientSession("write failure");
        }
    }

    /**
     * Returns whether a debugger socket is currently connected and open.
     */
    private boolean isClientConnected() {
        Socket socket = clientSocket;
        return socket != null && socket.isConnected() && !socket.isClosed();
    }

    /**
     * Closes client resources and clears socket/session references.
     */
    private void closeClient() {
        closeQuietly(clientInput);
        closeQuietly(clientOutput);
        closeQuietly(clientSocket);
        clientInput = null;
        clientOutput = null;
        clientSocket = null;
        lastClientActivityMillis = 0L;
    }

    /**
     * Tracks the last successful request activity timestamp for idle-timeout checks.
     */
    private void markClientActivity() {
        lastClientActivityMillis = System.currentTimeMillis();
    }

    /**
     * Terminates the active client session and resumes a paused script thread if needed.
     *
     * @param reason diagnostic reason written to logs
     */
    private void terminateClientSession(String reason) {
        clearStepState();
        PauseState state = pauseState;
        if (state != null) {
            state.resume();
        }
        closeClient();
        LOGGER.info("Debug adapter client terminated: " + reason);
    }

    /**
     * Waits for resume while periodically checking socket and idle-timeout liveness.
     *
     * @param state current paused execution state
     */
    private void awaitResumeOrTerminate(PauseState state) {
        int idleTimeoutMs = Math.max(0, readIntProperty(CLIENT_IDLE_TIMEOUT_PROPERTY, DEFAULT_CLIENT_IDLE_TIMEOUT_MS));
        int pollMs = Math.max(250, readIntProperty(CLIENT_LIVENESS_POLL_PROPERTY, DEFAULT_CLIENT_LIVENESS_POLL_MS));
        if (LOGGER.isDebugEnabled()) {
            LOGGER.debug("Awaiting resume for script " + state.scriptName
                    + " threadId=" + state.threadId
                    + " pollMs=" + pollMs
                    + " idleTimeoutMs=" + idleTimeoutMs);
        }
        while (true) {
            if (state.awaitResume(pollMs)) {
                return;
            }
            if (!isClientConnected()) {
                if (LOGGER.isDebugEnabled()) {
                    LOGGER.debug("Client disconnected while paused; resuming script " + state.scriptName);
                }
                state.resume();
                return;
            }
            if (idleTimeoutMs > 0 && isClientIdle(idleTimeoutMs)) {
                LOGGER.warn("Debug adapter idle timeout elapsed while paused; terminating client session");
                terminateClientSession("client idle timeout");
                return;
            }
        }
    }

    /**
     * Returns whether the current client session has exceeded the configured idle timeout.
     *
     * @param idleTimeoutMs timeout threshold in milliseconds
     * @return {@code true} when no client activity has been observed within the timeout window
     */
    private boolean isClientIdle(int idleTimeoutMs) {
        long lastActivity = lastClientActivityMillis;
        if (lastActivity <= 0L) {
            return false;
        }
        return System.currentTimeMillis() - lastActivity > idleTimeoutMs;
    }

    private void closeQuietly(AutoCloseable resource) {
        if (resource == null) {
            return;
        }
        try {
            resource.close();
        } catch (Exception e) {
            LOGGER.debug("Ignoring debug adapter close failure", e);
        }
    }


    @SuppressWarnings("SameParameterValue")
    private boolean readBooleanProperty(String name, boolean defaultValue) {
        String value = readProperty(name);
        if (value == null) {
            return defaultValue;
        }

        String normalized = value.trim();
        if (normalized.isEmpty()) {
            return defaultValue;
        }

        return "1".equals(normalized)
                || "true".equalsIgnoreCase(normalized)
                || "yes".equalsIgnoreCase(normalized)
                || "y".equalsIgnoreCase(normalized);
    }

    private int readIntProperty(String name, int defaultValue) {
        String value = readProperty(name);
        if (value == null || value.isBlank()) {
            return defaultValue;
        }
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException e) {
            LOGGER.warn("Invalid integer value for property " + name + ": " + value);
            return defaultValue;
        }
    }

    private String readProperty(String name) {
        try {
            MXServer server = MXServer.getMXServer();
            if (server != null) {
                String value = server.getProperty(name);
                if (value != null) {
                    return value;
                }
            }
        } catch (RemoteException e) {
            LOGGER.error("Failed to read Maximo property " + name, e);
        }
        return System.getProperty(name);
    }

    private int currentThreadId() {
        PauseState state = pauseState;
        return state == null ? 1 : state.threadId;
    }

    private String currentThreadName() {
        PauseState state = pauseState;
        return state == null ? "Maximo Script Thread" : state.threadName;
    }

    /**
     * Resolves a DAP variable reference to its children, expanding the object graph only when requested.
     */
    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> resolveVariables(int reference) {
        Object stored = variableReferences.get(reference);
        if (stored instanceof List<?> list) {
            return (List<Map<String, Object>>) list;
        }
        if (stored instanceof VariableExpansion expansion) {
            // Cache realized children so repeated expansions in the UI do not repeat reflection work.
            List<Map<String, Object>> resolved = expandValue(
                    expansion.value,
                    expansion.depth,
                    new IdentityHashMap<>(expansion.seen)
            );
            variableReferences.put(reference, resolved);
            return resolved;
        }
        return List.of();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> mapValue(Object value) {
        if (value instanceof Map<?, ?> map) {
            return (Map<String, Object>) map;
        }
        return Map.of();
    }

    private Map<String, String> parseStringMap(Object value) {
        if (!(value instanceof Map<?, ?> map)) {
            return Map.of();
        }

        Map<String, String> parsed = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            if (entry.getKey() != null && entry.getValue() != null) {
                parsed.put(String.valueOf(entry.getKey()), String.valueOf(entry.getValue()));
            }
        }
        return parsed;
    }

    private String stringValue(Object value) {
        return value == null ? "" : value.toString();
    }

    private String resolveScriptName(Map<String, Object> source) {
        String path = stringValue(source.get("path"));
        if (!path.isBlank()) {
            for (Map.Entry<String, String> entry : scriptPathIndex.entrySet()) {
                if (path.equals(entry.getValue())) {
                    return entry.getKey().toUpperCase();
                }
            }

            String fileName = new java.io.File(path).getName();
            int dotIndex = fileName.lastIndexOf('.');
            return (dotIndex >= 0 ? fileName.substring(0, dotIndex) : fileName).toUpperCase();
        }

        String name = stringValue(source.get("name"));
        if (name.isBlank()) {
            return null;
        }

        int dotIndex = name.lastIndexOf('.');
        return (dotIndex >= 0 ? name.substring(0, dotIndex) : name).toUpperCase();
    }

    private boolean isTruthy(Object value) {
        if (value == null) {
            return false;
        }
        if (value instanceof Boolean bool) {
            return bool;
        }
        if (value instanceof Number number) {
            return number.doubleValue() != 0d;
        }
        if (value instanceof CharSequence sequence) {
            return !sequence.isEmpty();
        }
        if (value instanceof Collection<?> collection) {
            return !collection.isEmpty();
        }
        if (value instanceof Map<?, ?> map) {
            return !map.isEmpty();
        }
        if (value.getClass().isArray()) {
            return Array.getLength(value) > 0;
        }
        return true;
    }

    private static String scriptFileExtension(String language) {
        if (isJavaScriptLanguage(language)) {
            return ".js";
        }
        return ".py";
    }

    private static String scriptMimeType(String language) {
        if (isJavaScriptLanguage(language)) {
            return "text/javascript";
        }
        return "text/x-python";
    }

    private static boolean isJavaScriptLanguage(String language) {
        if (language == null || language.isBlank()) {
            return false;
        }
        return "javascript".equalsIgnoreCase(language)
                || "js".equalsIgnoreCase(language)
                || "nashorn".equalsIgnoreCase(language)
                || "ecmascript".equalsIgnoreCase(language);
    }

    private int intValue(Object value, int defaultValue) {
        if (value instanceof Number number) {
            return number.intValue();
        }
        if (value instanceof String string) {
            try {
                return Integer.parseInt(string);
            } catch (NumberFormatException ignored) {
                return defaultValue;
            }
        }
        return defaultValue;
    }

    private boolean shouldStopForPythonBreakpoint(String scriptName, int lineNumber, Map<String, Object> context, PyFrame frame) {
        BreakpointDefinition breakpoint = breakpointFor(scriptName, lineNumber);
        if (breakpoint == null) {
            return false;
        }
        if (breakpoint.condition.isBlank()) {
            return true;
        }
        return evaluatePythonCondition(breakpoint.condition, context, frame);
    }

    private boolean shouldStopForJavaScriptBreakpoint(String scriptName, int lineNumber, Map<String, Object> context, Object locals) {
        BreakpointDefinition breakpoint = breakpointFor(scriptName, lineNumber);
        if (breakpoint == null) {
            return false;
        }
        if (breakpoint.condition.isBlank()) {
            return true;
        }
        return evaluateJavaScriptCondition(breakpoint.condition, mergeVisibleContext(context, locals));
    }

    private BreakpointDefinition breakpointFor(String scriptName, int lineNumber) {
        Map<Integer, BreakpointDefinition> breakpoints = breakpointsByScript.get(scriptName.toUpperCase());
        if (breakpoints == null) {
            return null;
        }
        return breakpoints.get(lineNumber);
    }

    private boolean shouldStopForStep(String scriptName, int lineNumber, int frameDepth) {
        StepState currentStepState = stepState;
        if (currentStepState == null) {
            return false;
        }
        if (!currentStepState.scriptName.equals(scriptName.toUpperCase())
                || currentStepState.threadId != Math.toIntExact(Thread.currentThread().getId())) {
            return false;
        }
        return currentStepState.mode.shouldStop(currentStepState, lineNumber, frameDepth);
    }

    private void clearStepState() {
        stepState = null;
    }

    private void updateJavaScriptCurrentLine(int lineNumber) {
        JavaScriptTraceState state = javaScriptTraceState.get();
        JavaScriptFrameMarker frame = state.frames.peekLast();
        if (frame != null) {
            frame.currentLine = lineNumber;
        } else {
            state.scriptLine = lineNumber;
        }
    }

    private void registerPauseVariables(PauseState state) {
        for (StackFrameState frame : state.frames) {
            variableReferences.put(frame.localsReference, frame.variables);
        }
    }

    private StackFrameState resolveFrame(PauseState state, int frameId) {
        if (state == null || state.frames.isEmpty()) {
            return null;
        }
        if (frameId <= 0) {
            return state.frames.get(0);
        }
        return state.frameById.get(frameId);
    }

    private Map<String, Object> buildSourceDescriptor(PauseState state, int sourceReference) {
        String mappedPath = scriptPathIndex.get(state.scriptName.toUpperCase());
        Map<String, Object> source = new LinkedHashMap<>();
        if (mappedPath != null && !mappedPath.isBlank()) {
            source.put("name", new java.io.File(mappedPath).getName());
            source.put("path", mappedPath);
            source.put("sourceReference", 0);
        } else {
            source.put("name", state.scriptName + state.fileExtension);
            source.put("path", state.scriptName + state.fileExtension);
            source.put("sourceReference", sourceReference);
        }
        return source;
    }

    private int currentJavaScriptDepth() {
        return javaScriptFunctionDepth.get();
    }

    private int pythonFrameDepth(PyFrame frame) {
        int depth = 0;
        PyFrame current = frame;
        while (current != null) {
            if (isScriptFrame(current)) {
                depth++;
            }
            current = current.f_back;
        }
        return depth;
    }

    private boolean isScriptFrame(PyFrame frame) {
        if (frame == null || frame.f_code == null) {
            return false;
        }
        String filename = frame.f_code.co_filename;
        return filename == null || "<script>".equals(filename);
    }

    private List<StackFrameState> capturePythonFrames(
            ScriptInfo scriptInfo,
            Map<String, Object> context,
            PyFrame frame,
            Integer topLineNumber
    ) {
        List<StackFrameState> frames = new ArrayList<>();
        PyFrame current = frame;
        boolean first = true;
        while (current != null) {
            if (isScriptFrame(current)) {
                Map<String, Object> mergedContext = mergeVisibleContext(context, current);
                List<Map<String, Object>> variables = snapshotVariables(mergedContext);
                int frameId = variableRefSeq.getAndIncrement();
                int localsReference = variableRefSeq.getAndIncrement();
                int sourceReference = variableRefSeq.getAndIncrement();
                int lineNumber = first && topLineNumber != null
                        ? topLineNumber
                        : current.f_lineno > 0 ? current.f_lineno : 1;
                String frameName = current.f_code == null || current.f_code.co_name == null || "<module>".equals(current.f_code.co_name)
                        ? scriptInfo.getName()
                        : current.f_code.co_name;
                frames.add(new StackFrameState(
                        frameId,
                        frameName,
                        lineNumber,
                        localsReference,
                        sourceReference,
                        current.f_globals,
                        current.getLocals(),
                        null,
                        variables
                ));
                first = false;
            }
            current = current.f_back;
        }
        if (frames.isEmpty()) {
            Map<String, Object> mergedContext = mergeVisibleContext(context, frame);
            frames.add(new StackFrameState(
                    variableRefSeq.getAndIncrement(),
                    scriptInfo.getName(),
                    topLineNumber == null ? 1 : topLineNumber,
                    variableRefSeq.getAndIncrement(),
                    variableRefSeq.getAndIncrement(),
                    frame == null ? null : frame.f_globals,
                    frame == null ? null : frame.getLocals(),
                    null,
                    snapshotVariables(mergedContext)
            ));
        }
        return frames;
    }

    private List<StackFrameState> captureJavaScriptFrames(
            ScriptInfo scriptInfo,
            Map<String, Object> context,
            Object locals,
            Integer topLineNumber
    ) {
        List<StackFrameState> frames = new ArrayList<>();
        Map<String, Object> mergedContext = mergeVisibleContext(context, locals);
        int currentLine = topLineNumber == null ? 1 : topLineNumber;
        frames.add(new StackFrameState(
                variableRefSeq.getAndIncrement(),
                currentJavaScriptFrameName(scriptInfo),
                currentLine,
                variableRefSeq.getAndIncrement(),
                variableRefSeq.getAndIncrement(),
                null,
                null,
                mergedContext,
                snapshotVariables(mergedContext)
        ));

        JavaScriptTraceState traceState = javaScriptTraceState.get();
        List<JavaScriptFrameMarker> markers = new ArrayList<>(traceState.frames);
        for (int index = markers.size() - 2; index >= 0; index--) {
            JavaScriptFrameMarker marker = markers.get(index);
            frames.add(new StackFrameState(
                    variableRefSeq.getAndIncrement(),
                    marker.functionName,
                    marker.currentLine,
                    variableRefSeq.getAndIncrement(),
                    variableRefSeq.getAndIncrement(),
                    null,
                    null,
                    Map.of(),
                    List.of()
            ));
        }
        if (!markers.isEmpty()) {
            frames.add(new StackFrameState(
                    variableRefSeq.getAndIncrement(),
                    scriptInfo.getName(),
                    traceState.scriptLine,
                    variableRefSeq.getAndIncrement(),
                    variableRefSeq.getAndIncrement(),
                    null,
                    null,
                    Map.of(),
                    List.of()
            ));
        }
        return frames;
    }

    private String currentJavaScriptFrameName(ScriptInfo scriptInfo) {
        Deque<JavaScriptFrameMarker> frames = javaScriptTraceState.get().frames;
        JavaScriptFrameMarker current = frames.peekLast();
        if (current == null) {
            return scriptInfo.getName();
        }
        return current.functionName;
    }

    /**
     * Captures the debugger-visible state for a single suspended automation script execution.
     */
    private static final class PauseState {
        private final String scriptName;
        private final String reason;
        private final int lineNumber;
        private final int threadId;
        private final String threadName;
        private final String scriptSource;
        private final String fileExtension;
        private final String mimeType;
        private final int frameDepth;
        private final List<StackFrameState> frames;
        private final Map<Integer, StackFrameState> frameById;
        private final Set<Integer> sourceReferences;
        private final CountDownLatch resumeLatch = new CountDownLatch(1);

        private PauseState(
                String scriptName,
                String reason,
                int lineNumber,
                int threadId,
                String threadName,
                String scriptSource,
                String fileExtension,
                String mimeType,
                int frameDepth,
                List<StackFrameState> frames
        ) {
            this.scriptName = scriptName;
            this.reason = reason;
            this.lineNumber = lineNumber;
            this.threadId = threadId;
            this.threadName = threadName;
            this.scriptSource = scriptSource;
            this.fileExtension = fileExtension;
            this.mimeType = mimeType;
            this.frameDepth = frameDepth;
            this.frames = List.copyOf(frames);
            Map<Integer, StackFrameState> byId = new LinkedHashMap<>();
            Set<Integer> refs = new LinkedHashSet<>();
            for (StackFrameState frame : frames) {
                byId.put(frame.frameId, frame);
                refs.add(frame.sourceReference);
            }
            this.frameById = byId;
            this.sourceReferences = refs;
        }

        private static PauseState from(
                ScriptInfo scriptInfo,
                Map<String, Object> context,
                String reason,
                Integer lineNumber,
                PyFrame frame
        ) {
            Thread thread = Thread.currentThread();
            int threadId = Math.toIntExact(thread.getId());
            String language = scriptInfo.getScriptLanguge();
            List<StackFrameState> frames = INSTANCE.capturePythonFrames(scriptInfo, context, frame, lineNumber);
            return new PauseState(
                    scriptInfo.getName(),
                    reason == null || reason.isBlank() ? "Breakpoint" : reason,
                    lineNumber == null ? 1 : lineNumber,
                    threadId,
                    thread.getName(),
                    scriptInfo.getScriptSource(),
                    scriptFileExtension(language),
                    scriptMimeType(language),
                    INSTANCE.pythonFrameDepth(frame),
                    frames
            );
        }

        private static PauseState fromJavaScript(
                ScriptInfo scriptInfo,
                Map<String, Object> context,
                String reason,
                Integer lineNumber,
                Object locals
        ) {
            Thread thread = Thread.currentThread();
            int threadId = Math.toIntExact(thread.getId());
            String language = scriptInfo.getScriptLanguge();
            List<StackFrameState> frames = INSTANCE.captureJavaScriptFrames(scriptInfo, context, locals, lineNumber);
            return new PauseState(
                    scriptInfo.getName(),
                    reason == null || reason.isBlank() ? "Breakpoint" : reason,
                    lineNumber == null ? 1 : lineNumber,
                    threadId,
                    thread.getName(),
                    scriptInfo.getScriptSource(),
                    scriptFileExtension(language),
                    scriptMimeType(language),
                    INSTANCE.currentJavaScriptDepth(),
                    frames
            );
        }

        private boolean hasSourceReference(int sourceReference) {
            return sourceReferences.contains(sourceReference);
        }

        private static String safeValue(Object value) {
            if (value == null) {
                return "null";
            }
            try {
                return String.valueOf(value);
            } catch (Exception e) {
                return value.getClass().getName();
            }
        }

        private boolean awaitResume(long timeoutMs) {
            try {
                return resumeLatch.await(timeoutMs, TimeUnit.MILLISECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return true;
            }
        }

        private void resume() {
            resumeLatch.countDown();
        }
    }

    /**
     * Builds the top-level Locals list without eagerly traversing child object graphs.
     */
    private List<Map<String, Object>> snapshotVariables(Map<String, Object> context) {
        List<Map<String, Object>> variables = new ArrayList<>();
        for (Map.Entry<String, Object> entry : context.entrySet()) {
            if (entry.getValue() instanceof DebugBridge) {
                continue;
            }
            variables.add(createVariable(entry.getKey(), entry.getValue(), 0, new IdentityHashMap<>()));
        }
        return variables;
    }

    /**
     * Merges globals, injected Maximo bindings, and frame locals into the Locals scope.
     */
    private Map<String, Object> mergeVisibleContext(Map<String, Object> context, PyFrame frame) {
        Map<String, Object> mergedContext = new LinkedHashMap<>();
        if (frame != null && frame.f_globals != null) {
            mergedContext.putAll(extractFrameLocals(frame.f_globals));
        }
        if (context != null) {
            mergedContext.putAll(context);
        }
        if (frame != null) {
            // Apply frame locals last so live local values override globals and injected bindings.
            mergedContext.putAll(extractFrameLocals(frame.getLocals()));
        }
        return mergedContext;
    }

    /**
     * Merges injected Maximo bindings with an instrumented JavaScript locals snapshot.
     */
    private Map<String, Object> mergeVisibleContext(Map<String, Object> context, Object locals) {
        Map<String, Object> mergedContext = new LinkedHashMap<>();
        if (context != null) {
            mergedContext.putAll(context);
        }
        mergedContext.putAll(extractFrameLocals(locals));
        return mergedContext;
    }

    /**
     * Converts the Jython mapping variants used for frame state into a Java map.
     */
    private Map<String, Object> extractFrameLocals(Object frameLocals) {
        Map<String, Object> locals = new LinkedHashMap<>();

        if (frameLocals instanceof PyStringMap pyStringMap) {
            for (Map.Entry<Object, PyObject> entry : pyStringMap.getMap().entrySet()) {
                if (entry.getKey() != null) {
                    locals.put(String.valueOf(entry.getKey()), pyToJava(entry.getValue()));
                }
            }
            return locals;
        }

        if (frameLocals instanceof Map<?, ?> map) {
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (entry.getKey() != null) {
                    locals.put(String.valueOf(entry.getKey()), entry.getValue());
                }
            }
            return locals;
        }

        if (frameLocals instanceof PyObject pyObject && pyObject.isMappingType()) {
            try {
                PyObject keys = pyObject.invoke("keys");
                for (PyObject key : keys.asIterable()) {
                    Object javaKey = pyToJava(key);
                    if (javaKey != null) {
                        locals.put(String.valueOf(javaKey), pyToJava(pyObject.__finditem__(key)));
                    }
                }
            } catch (Exception e) {
                LOGGER.debug("Failed to extract generic Jython frame locals", e);
            }
            return locals;
        }

        return locals;
    }

    private Object pyToJava(Object value) {
        // Jython returns PyObject wrappers for many values; convert when possible so variable rendering
        // uses the underlying Java types and summaries.
        if (value instanceof PyObject pyObject) {
            Object javaValue = pyObject.__tojava__(Object.class);
            return javaValue == Py.NoConversion ? pyObject : javaValue;
        }
        return value;
    }

    /**
     * Creates a DAP variable entry and attaches a lazy child reference for expandable values.
     */
    private Map<String, Object> createVariable(
            String name,
            Object value,
            int depth,
            IdentityHashMap<Object, Boolean> seen
    ) {
        Map<String, Object> variable = new LinkedHashMap<>();
        variable.put("name", name);
        variable.put("value", summarizeValue(value));
        variable.put("type", value == null ? "null" : value.getClass().getSimpleName());
        variable.put("variablesReference", createVariableReference(value, depth, seen));
        if (variable.get("variablesReference").equals(0) && value != null && !isSimpleValue(value)) {
            variable.put("presentationHint", Map.of("kind", "data"));
        }
        return variable;
    }

    /**
     * Allocates a child reference without expanding it until the debugger opens that node.
     */
    private int createVariableReference(
            Object value,
            int depth,
            IdentityHashMap<Object, Boolean> seen
    ) {
        if (value == null || isSimpleValue(value) || depth >= MAX_VARIABLE_DEPTH || seen.containsKey(value)) {
            return 0;
        }

        IdentityHashMap<Object, Boolean> childSeen = new IdentityHashMap<>(seen);
        childSeen.put(value, Boolean.TRUE);

        int reference = variableRefSeq.getAndIncrement();
        variableReferences.put(reference, new VariableExpansion(value, depth + 1, childSeen));
        return reference;
    }

    /**
     * Expands one variable node into child entries for collections, arrays, and rich object types.
     */
    private List<Map<String, Object>> expandValue(
            Object value,
            int depth,
            IdentityHashMap<Object, Boolean> seen
    ) {
        List<Map<String, Object>> children = new ArrayList<>();

        if (value instanceof Map<?, ?> map) {
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                children.add(createVariable(String.valueOf(entry.getKey()), entry.getValue(), depth, seen));
            }
            return children;
        }

        if (value instanceof Collection<?> collection) {
            int index = 0;
            for (Object entry : collection) {
                if (index >= MAX_COLLECTION_ITEMS) {
                    children.add(simpleVariable("...", "Additional items omitted", "String"));
                    break;
                }
                children.add(createVariable("[" + index + "]", entry, depth, seen));
                index++;
            }
            return children;
        }

        if (value.getClass().isArray()) {
            int length = Array.getLength(value);
            for (int index = 0; index < length && index < MAX_COLLECTION_ITEMS; index++) {
                children.add(createVariable("[" + index + "]", Array.get(value, index), depth, seen));
            }
            if (length > MAX_COLLECTION_ITEMS) {
                children.add(simpleVariable("...", "Additional items omitted", "String"));
            }
            return children;
        }

        // Prefer tailored summaries for Maximo-heavy types, but still expose a Java-like inspector view.
        List<Map<String, Object>> customChildren = expandCustomValue(value, depth, seen);
        if (!customChildren.isEmpty()) {
            List<Map<String, Object>> childrenWithInspector = new ArrayList<>(customChildren);
            appendJavaInspectorChildren(childrenWithInspector, value, depth, seen);
            return childrenWithInspector;
        }

        return expandBeanProperties(value, depth, seen);
    }

    /**
     * Provides higher-signal children for common Maximo runtime types before generic reflection.
     */
    private List<Map<String, Object>> expandCustomValue(
            Object value,
            int depth,
            IdentityHashMap<Object, Boolean> seen
    ) {
        if (value instanceof ScriptService service) {
            return expandScriptService(service, depth, seen);
        }
        if (value instanceof MboRemote mbo) {
            return expandMbo(mbo, depth, seen);
        }
        if (value instanceof MboSetRemote mboSet) {
            return expandMboSet(mboSet, depth, seen);
        }
        if (value instanceof UserInfo userInfo) {
            return expandUserInfo(userInfo);
        }
        return List.of();
    }

    private List<Map<String, Object>> expandScriptService(
            ScriptService service,
            int depth,
            IdentityHashMap<Object, Boolean> seen
    ) {
        List<Map<String, Object>> children = new ArrayList<>();
        children.add(simpleVariable("scriptName", safeValue(service::getScriptName), "String"));
        children.add(simpleVariable("mboName", safeValue(service::getMboName), "String"));
        children.add(createVariable("mbo", safeValueObject(service::getMbo), depth, seen));
        return children;
    }

    private List<Map<String, Object>> expandMbo(
            MboRemote mbo,
            int depth,
            IdentityHashMap<Object, Boolean> seen
    ) {
        List<Map<String, Object>> children = new ArrayList<>();
        children.add(simpleVariable("name", safeValue(mbo::getName), "String"));
        children.add(simpleVariable("userName", safeValue(mbo::getUserName), "String"));
        children.add(simpleVariable("uniqueIdName", safeValue(mbo::getUniqueIDName), "String"));
        children.add(simpleVariable("uniqueIdValue", safeValue(mbo::getUniqueIDValue), "long"));
        children.add(simpleVariable("isNew", safeValue(mbo::isNew), "boolean"));
        children.add(simpleVariable("isModified", safeValue(mbo::isModified), "boolean"));
        children.add(simpleVariable("toBeAdded", safeValue(mbo::toBeAdded), "boolean"));
        children.add(simpleVariable("toBeUpdated", safeValue(mbo::toBeUpdated), "boolean"));
        children.add(simpleVariable("toBeDeleted", safeValue(mbo::toBeDeleted), "boolean"));
        children.add(createVariable("owner", safeValueObject(mbo::getOwner), depth, seen));
        children.add(createVariable("thisMboSet", safeValueObject(mbo::getThisMboSet), depth, seen));
        children.add(createVariable("userInfo", safeValueObject(mbo::getUserInfo), depth, seen));
        children.add(createVariable("attributes", buildMboAttributeView(mbo), depth, seen));
        return children;
    }

    private List<Map<String, Object>> expandMboSet(
            MboSetRemote mboSet,
            int depth,
            IdentityHashMap<Object, Boolean> seen
    ) {
        List<Map<String, Object>> children = new ArrayList<>();
        children.add(simpleVariable("name", safeValue(mboSet::getName), "String"));
        children.add(simpleVariable("app", safeValue(mboSet::getApp), "String"));
        children.add(simpleVariable("userName", safeValue(mboSet::getUserName), "String"));
        children.add(simpleVariable("size", safeValue(mboSet::getSize), "int"));
        children.add(simpleVariable("currentPosition", safeValue(mboSet::getCurrentPosition), "int"));
        children.add(simpleVariable("where", safeValue(mboSet::getWhere), "String"));
        children.add(simpleVariable("userWhere", safeValue(mboSet::getUserWhere), "String"));
        children.add(simpleVariable("completeWhere", safeValue(mboSet::getCompleteWhere), "String"));
        children.add(simpleVariable("relationship", safeValue(mboSet::getRelationship), "String"));
        children.add(simpleVariable("relationName", safeValue(mboSet::getRelationName), "String"));
        children.add(createVariable("owner", safeValueObject(mboSet::getOwner), depth, seen));
        children.add(createVariable("currentMbo", safeValueObject(mboSet::getMbo), depth, seen));
        children.add(createVariable("userInfo", safeValueObject(mboSet::getUserInfo), depth, seen));
        return children;
    }

    private List<Map<String, Object>> expandUserInfo(UserInfo userInfo) {
        List<Map<String, Object>> children = new ArrayList<>();
        children.add(simpleVariable("userName", userInfo.getUserName(), "String"));
        children.add(simpleVariable("displayName", userInfo.getDisplayName(), "String"));
        children.add(simpleVariable("loginID", userInfo.getLoginID(), "String"));
        children.add(simpleVariable("email", userInfo.getEmail(), "String"));
        children.add(simpleVariable("maxSessionID", userInfo.getMaxSessionID(), "long"));
        children.add(simpleVariable("interactive", userInfo.isInteractive(), "boolean"));
        children.add(simpleVariable("clientHost", userInfo.getClientHost(), "String"));
        children.add(simpleVariable("clientAddr", userInfo.getClientAddr(), "String"));
        children.add(simpleVariable("locale", userInfo.getLocale(), "Locale"));
        children.add(simpleVariable("timeZone", userInfo.getTimeZone(), "TimeZone"));
        children.add(simpleVariable("insertSite", userInfo.getInsertSite(), "String"));
        children.add(simpleVariable("insertOrg", userInfo.getInsertOrg(), "String"));
        return children;
    }

    private Map<String, Object> buildMboAttributeView(MboRemote mbo) {
        Map<String, Object> attributes = new LinkedHashMap<>();

        try {
            MboSetRemote mboSet = mbo.getThisMboSet();
            if (mboSet != null) {
                String[] keyAttributes = mboSet.getKeyAttributes();
                if (keyAttributes != null) {
                    for (String attribute : keyAttributes) {
                        attributes.put(attribute, safeMboAttribute(mbo, attribute));
                    }
                }
            }
        } catch (Exception e) {
            attributes.put("keys", "<error: " + e.getClass().getSimpleName() + ">");
        }

        for (String attribute : List.of("description", "status", "siteid", "orgid")) {
            if (!attributes.containsKey(attribute)) {
                Object value = safeMboAttribute(mbo, attribute);
                if (value != null) {
                    attributes.put(attribute, value);
                }
            }
        }

        return attributes;
    }

    private Object safeMboAttribute(MboRemote mbo, String attribute) {
        try {
            if (mbo.isNull(attribute)) {
                return null;
            }
            return mbo.getString(attribute);
        } catch (Exception e) {
            return null;
        }
    }

    private void appendJavaInspectorChildren(
            List<Map<String, Object>> children,
            Object value,
            int depth,
            IdentityHashMap<Object, Boolean> seen
    ) {
        Set<String> existingNames = collectVariableNames(children);
        // Keep curated Maximo nodes first and only append reflective entries that do not collide by name.
        appendEntries(children, existingNames, inspectFields(value), depth, seen);
        appendEntries(children, existingNames, inspectBeanProperties(value), depth, seen);
        children.add(createVariable("__meta__", buildInspectorMetadata(value), depth, seen));
        children.add(createVariable("__methods__", inspectMethods(value), depth, seen));
    }

    private List<Map<String, Object>> expandBeanProperties(
            Object value,
            int depth,
            IdentityHashMap<Object, Boolean> seen
    ) {
        List<Map<String, Object>> children = new ArrayList<>();
        appendJavaInspectorChildren(children, value, depth, seen);
        return children;
    }

    private Set<String> collectVariableNames(List<Map<String, Object>> children) {
        Set<String> names = new LinkedHashSet<>();
        for (Map<String, Object> child : children) {
            Object name = child.get("name");
            if (name != null) {
                names.add(String.valueOf(name));
            }
        }
        return names;
    }

    private void appendEntries(
            List<Map<String, Object>> children,
            Set<String> existingNames,
            Map<String, Object> entries,
            int depth,
            IdentityHashMap<Object, Boolean> seen
    ) {
        for (Map.Entry<String, Object> entry : entries.entrySet()) {
            if (existingNames.add(entry.getKey())) {
                children.add(createVariable(entry.getKey(), entry.getValue(), depth, seen));
            }
        }
    }

    private Map<String, Object> buildInspectorMetadata(Object value) {
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("class", value.getClass().getName());
        metadata.put("simpleName", value.getClass().getSimpleName());
        metadata.put("identityHash", Integer.toHexString(System.identityHashCode(value)));
        Package valuePackage = value.getClass().getPackage();
        metadata.put("package", valuePackage == null ? "" : valuePackage.getName());
        Class<?> superClass = value.getClass().getSuperclass();
        metadata.put("superClass", superClass == null ? "null" : superClass.getName());
        return metadata;
    }

    private Map<String, Object> inspectBeanProperties(Object value) {
        Map<String, Object> properties = new LinkedHashMap<>();

        try {
            BeanInfo beanInfo = Introspector.getBeanInfo(value.getClass(), Object.class);
            int propertyCount = 0;
            for (PropertyDescriptor descriptor : beanInfo.getPropertyDescriptors()) {
                if (propertyCount >= MAX_BEAN_PROPERTIES) {
                    properties.put("...", "Additional properties omitted");
                    break;
                }

                Method readMethod = descriptor.getReadMethod();
                if (readMethod == null || readMethod.getParameterCount() != 0) {
                    continue;
                }
                if (isDangerousGetter(readMethod)) {
                    // Some Maximo getters mutate state or trigger persistence, so keep generic inspection read-safe.
                    properties.put(descriptor.getName(), "<skipped: dangerous getter>");
                    propertyCount++;
                    continue;
                }

                try {
                    properties.put(descriptor.getName(), readMethod.invoke(value));
                } catch (Exception e) {
                    properties.put(descriptor.getName(), formatInvocationError(e));
                }
                propertyCount++;
            }
        } catch (Exception e) {
            LOGGER.debug("Failed to inspect bean properties for " + value.getClass().getName(), e);
            properties.put("__error__", "<error: " + e.getClass().getSimpleName() + ">");
        }

        return properties;
    }

    private Map<String, Object> inspectFields(Object value) {
        Map<String, Object> fields = new LinkedHashMap<>();
        Class<?> current = value.getClass();
        int fieldCount = 0;

        while (current != null && current != Object.class) {
            for (Field field : current.getDeclaredFields()) {
                if (fieldCount >= MAX_FIELDS) {
                    fields.put("...", "Additional fields omitted");
                    return fields;
                }
                if (Modifier.isStatic(field.getModifiers())) {
                    continue;
                }

                String fieldName = current == value.getClass()
                        ? field.getName()
                        : current.getSimpleName() + "." + field.getName();
                try {
                    field.setAccessible(true);
                    fields.put(fieldName, field.get(value));
                } catch (Exception e) {
                    fields.put(fieldName, "<error: " + e.getClass().getSimpleName() + ">");
                }
                fieldCount++;
            }
            current = current.getSuperclass();
        }

        return fields;
    }

    private Map<String, Object> inspectMethods(Object value) {
        Map<String, Object> methods = new LinkedHashMap<>();
        List<Method> visibleMethods = new ArrayList<>();

        for (Method method : value.getClass().getMethods()) {
            if (method.getDeclaringClass() == Object.class
                    || method.isBridge()
                    || method.isSynthetic()
                    || Modifier.isStatic(method.getModifiers())) {
                continue;
            }
            visibleMethods.add(method);
        }

        visibleMethods.sort((left, right) -> {
            int nameCompare = left.getName().compareTo(right.getName());
            if (nameCompare != 0) {
                return nameCompare;
            }
            return methodSignature(left).compareTo(methodSignature(right));
        });

        int count = 0;
        for (Method method : visibleMethods) {
            if (count >= MAX_METHODS) {
                methods.put("...", "Additional methods omitted");
                break;
            }
            methods.put(methodSignature(method), method.getDeclaringClass().getSimpleName());
            count++;
        }

        return methods;
    }

    private Map<String, Object> simpleVariable(String name, String value, String type) {
        Map<String, Object> variable = new LinkedHashMap<>();
        variable.put("name", name);
        variable.put("value", value);
        variable.put("type", type);
        variable.put("variablesReference", 0);
        return variable;
    }

    private Map<String, Object> simpleVariable(String name, Object value, String type) {
        return simpleVariable(name, value == null ? "null" : String.valueOf(value), type);
    }

    private String summarizeValue(Object value) {
        if (value == null) {
            return "null";
        }
        if (value instanceof ScriptService service) {
            return "ScriptService[" + safeValue(service::getScriptName) + "]";
        }
        if (value instanceof MboRemote mbo) {
            return "Mbo[" + safeValue(mbo::getName) + "]";
        }
        if (value instanceof MboSetRemote mboSet) {
            return "MboSet[" + safeValue(mboSet::getName) + "]";
        }
        if (value instanceof UserInfo userInfo) {
            return "UserInfo[" + userInfo.getUserName() + "]";
        }
        if (value instanceof Collection<?> collection) {
            return value.getClass().getSimpleName() + "[" + collection.size() + "]";
        }
        if (value instanceof Map<?, ?> map) {
            return value.getClass().getSimpleName() + "[" + map.size() + "]";
        }
        if (value.getClass().isArray()) {
            return value.getClass().getComponentType().getSimpleName() + "[" + Array.getLength(value) + "]";
        }
        return PauseState.safeValue(value);
    }

    private boolean isSimpleValue(Object value) {
        if (value == null) {
            return true;
        }
        Class<?> type = value.getClass();
        Package valuePackage = type.getPackage();
        String packageName = valuePackage == null ? "" : valuePackage.getName();

        return type.isPrimitive()
                || value instanceof String
                || value instanceof Number
                || value instanceof Boolean
                || value instanceof Character
                || type.isEnum()
                || packageName.startsWith("java.time")
                || packageName.startsWith("java.math");
    }

    private String safeValue(ThrowingSupplier<?> supplier) {
        Object value = safeValueObject(supplier);
        return value == null ? "null" : String.valueOf(value);
    }

    private Object safeValueObject(ThrowingSupplier<?> supplier) {
        try {
            return supplier.get();
        } catch (Exception e) {
            return formatInvocationError(e);
        }
    }

    private boolean isDangerousGetter(Method method) {
        String name = method.getName();
        return name.equals("wait")
                || name.equals("notify")
                || name.equals("notifyAll")
                || name.startsWith("save")
                || name.startsWith("delete")
                || name.startsWith("remove")
                || name.startsWith("close")
                || name.startsWith("cleanup")
                || name.startsWith("commit")
                || name.startsWith("rollback")
                || name.startsWith("reset")
                || name.startsWith("clear");
    }

    private String methodSignature(Method method) {
        StringBuilder signature = new StringBuilder();
        signature.append(Modifier.toString(method.getModifiers()));
        if (!signature.isEmpty()) {
            signature.append(' ');
        }
        signature.append(method.getReturnType().getSimpleName());
        signature.append(' ');
        signature.append(method.getName());
        signature.append('(');
        Class<?>[] parameterTypes = method.getParameterTypes();
        for (int index = 0; index < parameterTypes.length; index++) {
            if (index > 0) {
                signature.append(", ");
            }
            signature.append(parameterTypes[index].getSimpleName());
        }
        signature.append(')');
        return signature.toString();
    }

    private String formatInvocationError(Exception exception) {
        Throwable cause = exception instanceof InvocationTargetException invocationTargetException
                ? invocationTargetException.getTargetException()
                : exception;
        return "<error: " + cause.getClass().getSimpleName() + ">";
    }

    @FunctionalInterface
    private interface ThrowingSupplier<T> {
        T get() throws Exception;
    }

    /**
     * Deferred expansion record used to keep pause-time snapshots fast.
     */
    private record VariableExpansion(Object value, int depth, IdentityHashMap<Object, Boolean> seen) {
    }

    private record BreakpointDefinition(int lineNumber, String condition) {
        private BreakpointDefinition(int lineNumber, String condition) {
            this.lineNumber = lineNumber;
            this.condition = condition == null ? "" : condition.trim();
        }
    }

    private record StackFrameState(int frameId, String frameName, int lineNumber, int localsReference,
                                   int sourceReference, PyObject frameGlobals, PyObject frameLocals,
                                   Map<String, Object> jsBindings, List<Map<String, Object>> variables) {
    }

    private static final class JavaScriptFrameMarker {
        private final String functionName;
        private int currentLine;

        private JavaScriptFrameMarker(String functionName, int lineNumber) {
            this.functionName = functionName;
            this.currentLine = lineNumber;
        }
    }

    private static final class JavaScriptTraceState {
        private int scriptLine = 1;
        private final Deque<JavaScriptFrameMarker> frames = new ArrayDeque<>();
    }

    /**
     * Tracks a pending stepping request until execution reaches a matching line/depth transition.
     */
    private record StepState(String scriptName, int threadId, int lineNumber, int frameDepth, StepMode mode) {
        private StepState(String scriptName, int threadId, int lineNumber, int frameDepth, StepMode mode) {
            this.scriptName = scriptName.toUpperCase();
            this.threadId = threadId;
            this.lineNumber = lineNumber;
            this.frameDepth = frameDepth;
            this.mode = mode;
        }

        private static StepState stepOver(PauseState state) {
            return new StepState(state.scriptName, state.threadId, state.lineNumber, state.frameDepth, StepMode.OVER);
        }

        private static StepState stepIn(PauseState state) {
            return new StepState(state.scriptName, state.threadId, state.lineNumber, state.frameDepth, StepMode.IN);
        }

        private static StepState stepOut(PauseState state) {
            return new StepState(state.scriptName, state.threadId, state.lineNumber, state.frameDepth, StepMode.OUT);
        }
    }

    private enum StepMode {
        OVER {
            @Override
            boolean shouldStop(StepState state, int lineNumber, int frameDepth) {
                return frameDepth < state.frameDepth
                        || (frameDepth == state.frameDepth && lineNumber != state.lineNumber);
            }
        },
        IN {
            @Override
            boolean shouldStop(StepState state, int lineNumber, int frameDepth) {
                return frameDepth != state.frameDepth || lineNumber != state.lineNumber;
            }
        },
        OUT {
            @Override
            boolean shouldStop(StepState state, int lineNumber, int frameDepth) {
                return frameDepth < state.frameDepth;
            }
        };

        abstract boolean shouldStop(StepState state, int lineNumber, int frameDepth);
    }
}
