package io.naviam.autoscript;

import com.ibm.tivoli.maximo.script.ScriptInfo;
import org.python.core.Py;
import org.python.core.PyFrame;
import psdi.util.logging.MXLogger;
import psdi.util.logging.MXLoggerFactory;

import java.util.Map;

/**
 * Exposes debugger controls to automation scripts through the injected {@code debugger} binding.
 */
public final class DebugBridge {
    private static final MXLogger LOGGER = MXLoggerFactory.getLogger("maximo.naviam.debug");
    private final DebugAdapterServer debugAdapterServer;
    private final ScriptInfo scriptInfo;
    private final Map<String, Object> context;

    /**
     * Creates the script-visible debugger bridge for one script invocation context.
     */
    DebugBridge(DebugAdapterServer debugAdapterServer, ScriptInfo scriptInfo, Map<String, Object> context) {
        this.debugAdapterServer = debugAdapterServer;
        this.scriptInfo = scriptInfo;
        this.context = context;
    }

    /**
     * Suspends execution immediately and reports a generic breakpoint stop to the attached client.
     */
    @SuppressWarnings("unused")
    public void breakpoint() {
        debugAdapterServer.pause(scriptInfo, context, "Breakpoint", 1, "breakpoint", currentFrame());
    }

    /**
     * Suspends execution immediately with a custom reason shown in the debugger UI.
     *
     * @param reason text displayed for the stop event
     */
    @SuppressWarnings("unused")
    public void breakpoint(String reason) {
        debugAdapterServer.pause(scriptInfo, context, reason, 1, "breakpoint", currentFrame());
    }

    /**
     * Suspends execution and reports the supplied script line number.
     *
     * @param lineNumber 1-based script line to report to the client
     */
    @SuppressWarnings("unused")
    public void breakpoint(int lineNumber) {
        debugAdapterServer.pause(scriptInfo, context, "Breakpoint", lineNumber, "breakpoint", currentFrame());
    }

    /**
     * Suspends execution with a custom reason and explicit line number.
     *
     * @param reason text displayed for the stop event
     * @param lineNumber 1-based script line to report to the client
     */
    @SuppressWarnings("unused")
    public void breakpoint(String reason, int lineNumber) {
        debugAdapterServer.pause(scriptInfo, context, reason, lineNumber, "breakpoint", currentFrame());
    }

    /**
     * Indicates whether debugging is enabled through Maximo or JVM properties.
     *
     * @return {@code true} when the adapter should accept debugger interactions
     */
    @SuppressWarnings("unused")
    public boolean isEnabled() {
        return debugAdapterServer.isEnabled();
    }

    /**
     * Forwards a traced Jython line event to the debug adapter.
     *
     * @param lineNumber 1-based line currently being executed
     * @param frame current Jython frame
     */
    @SuppressWarnings("unused")
    public void trace_line(int lineNumber, PyFrame frame) {
        debugAdapterServer.traceLine(scriptInfo, context, lineNumber, frame);
    }

    /**
     * Forwards an instrumented Nashorn line event to the debug adapter with a snapshot of visible locals.
     *
     * @param lineNumber 1-based line currently being executed
     * @param locals instrumented snapshot of currently visible JavaScript bindings
     */
    @SuppressWarnings("unused")
    public void trace_js(int lineNumber, Object locals) {
        debugAdapterServer.traceJavaScriptLine(scriptInfo, context, lineNumber, locals);
    }

    /**
     * Allows instrumented JavaScript to report a line event even when no locals snapshot is available.
     *
     * @param lineNumber 1-based line currently being executed
     */
    @SuppressWarnings("unused")
    public void trace_js(int lineNumber) {
        debugAdapterServer.traceJavaScriptLine(scriptInfo, context, lineNumber, null);
    }

    /**
     * Tracks entry into an instrumented JavaScript function so step semantics can distinguish nested calls.
     *
     * @param functionName reported JavaScript function name, or a placeholder when anonymous
     * @param lineNumber 1-based line where the function was entered
     */
    @SuppressWarnings("unused")
    public void enter_js(String functionName, int lineNumber) {
        debugAdapterServer.enterJavaScriptFunction(functionName, lineNumber);
    }

    /**
     * Tracks exit from an instrumented JavaScript function so step semantics can distinguish returns.
     */
    @SuppressWarnings("unused")
    public void exit_js() {
        debugAdapterServer.exitJavaScriptFunction();
    }

    /**
     * Reports a caught JavaScript exception to the debug adapter, suspending execution if the
     * client has enabled caught-exception breakpoints.
     *
     * @param lineNumber 1-based line of the {@code catch} clause
     * @param exception  the caught exception value passed through from the catch parameter
     * @param locals     instrumented snapshot of locals visible at the catch site
     */
    @SuppressWarnings("unused")
    public void exception_js(int lineNumber, Object exception, Object locals) {
        if (!debugAdapterServer.isBreakOnCaughtExceptions()) {
            if (LOGGER.isDebugEnabled()) {
                LOGGER.debug("Skipping caught JavaScript exception callback for "
                        + scriptInfo.getName() + " at line " + lineNumber
                        + " because caught-exception breakpoints are disabled");
            }
            return;
        }
        debugAdapterServer.traceJavaScriptException(scriptInfo, context, lineNumber, exception, locals, false);
    }

    /**
     * Reads the current Jython frame so manual breakpoint calls can expose live locals.
     *
     * @return active Jython frame for the current thread, or {@code null} when unavailable
     */
    private PyFrame currentFrame() {
        return Py.getThreadState().frame;
    }
}
