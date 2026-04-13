package io.naviam.autoscript;

import com.ibm.tivoli.maximo.script.JSR223ScriptDriver;
import com.ibm.tivoli.maximo.script.ScriptInfo;

import org.openjdk.nashorn.api.scripting.NashornException;
import org.python.core.Py;
import org.python.core.PyFrame;
import org.python.core.ThreadState;
import org.python.core.TraceFunction;
import psdi.server.MXServer;
import psdi.util.MXApplicationException;
import psdi.util.MXException;
import psdi.util.logging.MXLogger;
import psdi.util.logging.MXLoggerFactory;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.rmi.RemoteException;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import javax.script.*;

/**
 * Custom Maximo automation script driver that injects debugger bindings, enables Jython tracing,
 * and instruments JavaScript/Nashorn scripts when a client is attached.
 */
public final class DebugDriver extends JSR223ScriptDriver {
    private static final MXLogger LOGGER = MXLoggerFactory.getLogger("naviam.debug");
    private static final DebugAdapterServer DEBUG_ADAPTER_SERVER = DebugAdapterServer.getInstance();
    private static final ThreadLocal<String> CURRENT_SCRIPT_NAME = new ThreadLocal<>();
    private static final ScriptEngineManager SCRIPT_ENGINE_MANAGER = new ScriptEngineManager();
    private static final String EXCLUDED_SCRIPTS_PROPERTY = "naviam.autoscript.debug.js.exclude";
    private static final Set<String> DEFAULT_EXCLUDED_SCRIPTS = Set.of(
            "NAVIAM.AUTOSCRIPT.ADMIN",
            "NAVIAM.AUTOSCRIPT.DBC",
            "NAVIAM.AUTOSCRIPT.DEPLOY",
            "NAVIAM.AUTOSCRIPT.DEPLOY.HISTORY",
            "NAVIAM.AUTOSCRIPT.EXTRACT",
            "NAVIAM.AUTOSCRIPT.FORM",
            "NAVIAM.AUTOSCRIPT.LIBRARY",
            "NAVIAM.AUTOSCRIPT.LOGGING",
            "NAVIAM.AUTOSCRIPT.OBJECTS",
            "NAVIAM.AUTOSCRIPT.REPORT",
            "NAVIAM.AUTOSCRIPT.SCREENS",
            "NAVIAM.AUTOSCRIPT.STORE"
    );


    /**
     * Gets the DebugDriver version.
     *
     * @return version string or "unknown" if the version file cannot be read
     */
    @SuppressWarnings("unused")
    public static String getVersion() {
        InputStream is = DebugDriver.class.getResourceAsStream("/autoscript-debug-version.txt");
        if (is == null) {
            is = DebugDriver.class.getResourceAsStream("/autoscript-debug-version.txt");
        }

        try (InputStream stream = is) {
            if (stream == null) {
                return "unknown";
            }

            BufferedReader reader = new BufferedReader(new InputStreamReader(stream));

            return reader.readLine();
        } catch (IOException e) {
            return "unknown";
        }
    }


    /**
     * Creates the custom Maximo script driver and starts the in-process debug adapter when enabled.
     */
    public DebugDriver() {
        super();
        LOGGER.info("Loaded custom automation script driver " + DebugDriver.class.getName());
        DEBUG_ADAPTER_SERVER.ensureStarted();
    }

    /**
     * Releases adapter resources before this hot-loaded driver instance is removed from Maximo.
     */
    @SuppressWarnings("unused")
    public void shutdown() {
        DEBUG_ADAPTER_SERVER.shutdown();
    }

    /**
     * Defers language support checks to the base Maximo driver and logs the result for diagnostics.
     *
     * @param language Maximo script language identifier
     * @return {@code true} when the base driver can execute the requested language
     */
    @Override
    public boolean canRun(String language) {
        boolean canRun = super.canRun(language);
        if (LOGGER.isDebugEnabled()) {
            LOGGER.debug("Driver " + DebugDriver.class.getName() + " canRun(" + language + ")=" + canRun);
        }
        return canRun;
    }

    /**
     * Injects debugger bindings, selects the runtime-specific debug path, and delegates execution.
     *
     * <p>Jython scripts use the trace hook for line events. JavaScript/Nashorn scripts are instrumented
     * before evaluation when a debugger client is attached and the script is not excluded.</p>
     */
    @Override
    protected void evalScript(ScriptInfo scriptInfo, Map<String, Object> context) throws MXException, RemoteException {
        LOGGER.debug("Executing automation script " + scriptInfo.getName() + " with custom driver " + DebugDriver.class.getName());
        DEBUG_ADAPTER_SERVER.ensureStarted();
        boolean excluded = isExcludedScript(scriptInfo);
        boolean javaScriptScript = isJavaScriptScript(scriptInfo);
        boolean interfaceScript = scriptInfo.isInterfaceScript();
        boolean clientAttached = DEBUG_ADAPTER_SERVER.isClientAttached();
        boolean instrumentJavaScript = javaScriptScript && clientAttached && !excluded;
        String executionPath;
        if (instrumentJavaScript) {
            executionPath = "js-instrumented";
        } else if (!isPythonScript(scriptInfo)) {
            executionPath = "super-eval";
        } else {
            executionPath = "python-trace/super-eval";
        }
        if (LOGGER.isDebugEnabled()) {
            LOGGER.debug("Script " + scriptInfo.getName()
                    + " debug gates: isJavaScriptScript=" + javaScriptScript
                    + ", isInterfaceScript=" + interfaceScript
                    + ", isClientAttached=" + clientAttached
                    + ", excluded=" + excluded
                    + ", path=" + executionPath);
        }
        if (!excluded) {
            context.put("debugger", DEBUG_ADAPTER_SERVER.createBridge(scriptInfo, context));
            context.put(JavaScriptInstrumenter.DEBUGGER_ALIAS, context.get("debugger"));
        }
        CURRENT_SCRIPT_NAME.set(scriptInfo.getName());

        if (javaScriptScript && shouldInstrumentJavaScript(scriptInfo)) {
            try {
                evalJavaScriptScript(scriptInfo, context);
            } finally {
                CURRENT_SCRIPT_NAME.remove();
            }
            return;
        }

        if (!isPythonScript(scriptInfo)) {
            try {
                super.evalScript(scriptInfo, context);
            } finally {
                CURRENT_SCRIPT_NAME.remove();
            }
            return;
        }

        ThreadState threadState = Py.getThreadState();
        TraceFunction previousTraceFunction = threadState.tracefunc;
        try {
            if (!excluded && DEBUG_ADAPTER_SERVER.hasBreakpoints(scriptInfo.getName())) {
                threadState.tracefunc = new BreakpointTraceFunction(scriptInfo, context);
            }
            super.evalScript(scriptInfo, context);
        } finally {
            CURRENT_SCRIPT_NAME.remove();
            threadState.tracefunc = previousTraceFunction;
        }
    }

    /**
     * Wraps stdout and stderr so script output is mirrored into the attached debug session.
     *
     * <p>Also mirrors the Maximo context bindings into {@code GLOBAL_SCOPE} so that Jython
     * scripts can access variables like {@code mbo} from within function bodies. Jython's
     * JSR-223 engine uses {@code GLOBAL_SCOPE} as the Python module's global namespace; when
     * it is {@code null} (the {@link javax.script.SimpleScriptContext} default) Jython falls
     * back to the engine interpreter's own empty namespace. With a hot-loaded driver the
     * {@code invocableScriptCache} is always cold so that fallback namespace is never
     * pre-populated, causing a {@code NameError} when functions try to resolve {@code mbo}.</p>
     */
    @Override
    protected ScriptContext createScriptContext(
            Bindings bindings,
            Map<String, Object> context,
            Writer writer,
            Writer errorWriter
    ) {
        String scriptName = CURRENT_SCRIPT_NAME.get();
        Writer debugWriter = new LineForwardingWriter(writer, scriptName, "stdout");
        Writer debugErrorWriter = new LineForwardingWriter(errorWriter, scriptName, "stderr");
        ScriptContext scriptContext = super.createScriptContext(bindings, context, debugWriter, debugErrorWriter);
        scriptContext.setBindings(new SimpleBindings(new HashMap<>(context)), ScriptContext.GLOBAL_SCOPE);
        return scriptContext;
    }

    /**
     * Restricts tracing behavior to Jython-backed scripts where line events are available.
     */
    @SuppressWarnings("BooleanMethodIsAlwaysInverted")
    private boolean isPythonScript(ScriptInfo scriptInfo) {
        String language = scriptInfo.getScriptLanguge();
        if (language == null) {
            return false;
        }
        return "jython".equalsIgnoreCase(language) || "py".equalsIgnoreCase(language) || "python".equalsIgnoreCase(language);
    }

    /**
     * Restricts JavaScript instrumentation to Nashorn-compatible script languages.
     */
    private boolean isJavaScriptScript(ScriptInfo scriptInfo) {
        String language = scriptInfo.getScriptLanguge();
        if (language == null) {
            return false;
        }
        return "javascript".equalsIgnoreCase(language)
                || "js".equalsIgnoreCase(language)
                || "nashorn".equalsIgnoreCase(language)
                || "ecmascript".equalsIgnoreCase(language);
    }

    /**
     * Evaluates a JavaScript/Nashorn automation script with optional debugger instrumentation.
     *
     * @param scriptInfo active script metadata
     * @param context    current Maximo script bindings
     * @throws MXException when no compatible engine is available or script evaluation fails
     */
    private void evalJavaScriptScript(ScriptInfo scriptInfo, Map<String, Object> context) throws MXException {
        String source = scriptInfo.getScriptSource();
        if (source == null) {
            return;
        }


        String sourceToExecute = JavaScriptInstrumenter.instrument(scriptInfo.getName(), source);
        ScriptEngine engine = SCRIPT_ENGINE_MANAGER.getEngineByName(scriptInfo.getScriptLanguge());
        if (engine == null) {
            engine = SCRIPT_ENGINE_MANAGER.getEngineByName("nashorn");
        }
        if (engine == null) {
            throw new MXApplicationException("script", "compileerr", new Object[]{scriptInfo.getName()});
        }
        if (LOGGER.isDebugEnabled()) {
            LOGGER.debug("Evaluating JavaScript script " + scriptInfo.getName()
                    + " with engine " + engine.getClass().getName());
        }

        context.putIfAbsent("evalresult", null);

        StringWriter stdout = new StringWriter();
        StringWriter stderr = new StringWriter();
        try (PrintWriter writer = new PrintWriter(stdout); PrintWriter errorWriter = new PrintWriter(stderr)) {
            // Run with a dedicated ENGINE_SCOPE map, then merge it back so globals created
            // in script code (for example `var x = ...`) are visible to Maximo after eval.
            Bindings engineBindings = engine.createBindings();
            engineBindings.putAll(context);

            SimpleScriptContext scriptContext = new SimpleScriptContext();
            scriptContext.setBindings(engineBindings, ScriptContext.ENGINE_SCOPE);
            scriptContext.setWriter(new LineForwardingWriter(writer, scriptInfo.getName(), "stdout"));
            scriptContext.setErrorWriter(new LineForwardingWriter(errorWriter, scriptInfo.getName(), "stderr"));
            scriptContext.setAttribute(ScriptEngine.FILENAME, scriptInfo.getName() + ".js", ScriptContext.ENGINE_SCOPE);

            Object evalResult = engine.eval(new StringReader(sourceToExecute), scriptContext);
            context.putAll(engineBindings);
            context.put("evalresult", evalResult);
            if (LOGGER.isDebugEnabled()) {
                LOGGER.debug("JavaScript script " + scriptInfo.getName()
                        + " completed; merged " + engineBindings.size() + " bindings into context");
            }
        } catch (ScriptException e) {

            throw toScriptException(scriptInfo, e);
        }
    }

    /**
     * Converts Nashorn script errors into the Maximo script compile exception format.
     */
    private MXException toScriptException(ScriptInfo scriptInfo, ScriptException exception) {
        Throwable cause = exception.getCause();
        if (cause instanceof NashornException nashornException) {
            LOGGER.error(
                    "JavaScript automation script " + scriptInfo.getName()
                            + " failed at line " + nashornException.getLineNumber()
                            + ", column " + nashornException.getColumnNumber(),
                    nashornException
            );
        } else {
            LOGGER.error("JavaScript automation script " + scriptInfo.getName() + " failed", exception);
        }
        return new MXApplicationException("script", "compileerr", new Object[]{scriptInfo.getName()}, exception);
    }

    /**
     * Enables JavaScript instrumentation only when a debugger is actively attached.
     */
    private boolean shouldInstrumentJavaScript(ScriptInfo scriptInfo) {
        if (!DEBUG_ADAPTER_SERVER.isClientAttached()) {
            return false;
        }

        return !isExcludedScript(scriptInfo);
    }

    /**
     * Checks whether a script is configured to skip JavaScript instrumentation.
     */
    private boolean isExcludedScript(ScriptInfo scriptInfo) {
        String scriptName = scriptInfo.getName();
        if (scriptName == null) {
            return false;
        }
        return excludedScripts().contains(scriptName.toUpperCase());
    }

    /**
     * Resolves the exclusion list from system properties with a conservative default set.
     */
    private Set<String> excludedScripts() {
        String configured = readProperty(EXCLUDED_SCRIPTS_PROPERTY);
        if (configured == null || configured.isBlank()) {
            return DEFAULT_EXCLUDED_SCRIPTS;
        }

        Set<String> excludedScripts = new LinkedHashSet<>();
        Arrays.stream(configured.split("[,\\s]+"))
                .map(String::trim)
                .filter(value -> !value.isEmpty())
                .map(String::toUpperCase)
                .forEach(excludedScripts::add);
        return excludedScripts.isEmpty() ? DEFAULT_EXCLUDED_SCRIPTS : excludedScripts;
    }

    /**
     * Reads a runtime property used to control debugger behavior.
     */
    @SuppressWarnings("SameParameterValue")
    private String readProperty(String name) {
        String value = null;

        try {
            value = MXServer.getMXServer().getProperty(name);
        } catch (RemoteException ignored) {
        }
        if (value == null || value.isBlank()) {
            value = System.getProperty(name);
        }
        return value != null && value.isBlank() ? null : value;
    }

    /**
     * Jython trace hook that only forwards line events for the top-level script body.
     */
    private static final class BreakpointTraceFunction extends TraceFunction {
        private final ScriptInfo scriptInfo;
        private final Map<String, Object> context;

        private BreakpointTraceFunction(ScriptInfo scriptInfo, Map<String, Object> context) {
            this.scriptInfo = scriptInfo;
            this.context = context;
        }

        @Override
        public TraceFunction traceCall(PyFrame frame) {
            return isScriptFrame(frame) ? this : null;
        }

        @Override
        public TraceFunction traceReturn(PyFrame frame, org.python.core.PyObject ret) {
            return this;
        }

        @Override
        public TraceFunction traceLine(PyFrame frame, int line) {
            if (isScriptFrame(frame)) {
                DEBUG_ADAPTER_SERVER.traceLine(scriptInfo, context, line, frame);
            }
            return this;
        }

        @Override
        public TraceFunction traceException(PyFrame frame, org.python.core.PyException exc) {
            return this;
        }

        /**
         * Filters out non-script frames so stepping and breakpoints stay on the automation script body.
         */
        private boolean isScriptFrame(PyFrame frame) {
            if (frame == null || frame.f_code == null) {
                return false;
            }
            String filename = frame.f_code.co_filename;
            return filename == null || "<script>".equals(filename);
        }
    }

    /**
     * Buffers output until a line boundary so the debugger receives readable console events.
     */
    private static final class LineForwardingWriter extends Writer {
        private final Writer delegate;
        private final String scriptName;
        private final String category;
        private final ByteArrayOutputStream buffer = new ByteArrayOutputStream();

        private LineForwardingWriter(Writer delegate, String scriptName, String category) {
            this.delegate = delegate;
            this.scriptName = scriptName == null || scriptName.isBlank() ? "autoscript" : scriptName;
            this.category = category;
        }

        @SuppressWarnings("NullableProblems")
        @Override
        public synchronized void write(char[] chars, int off, int len) throws IOException {
            delegate.write(chars, off, len);
            byte[] bytes = new String(chars, off, len).getBytes(StandardCharsets.UTF_8);
            for (byte value : bytes) {
                buffer.write(value);
                if (value == '\n') {
                    flushBuffer();
                }
            }
        }

        @Override
        public synchronized void flush() throws IOException {
            delegate.flush();
            flushBuffer();
        }

        @Override
        public synchronized void close() throws IOException {
            delegate.close();
            flushBuffer();
        }

        /**
         * Sends completed output chunks to the debugger and keeps partial lines buffered locally.
         */
        private void flushBuffer() {
            if (buffer.size() == 0) {
                return;
            }

            String text = buffer.toString(StandardCharsets.UTF_8);
            buffer.reset();
            DEBUG_ADAPTER_SERVER.emitOutput("[" + scriptName + "] " + text, category);
        }
    }
}
