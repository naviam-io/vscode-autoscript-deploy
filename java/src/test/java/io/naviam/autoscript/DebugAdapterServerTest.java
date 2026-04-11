package io.naviam.autoscript;

import org.junit.Test;
import org.python.core.PyDictionary;
import org.python.core.PyString;
import org.python.core.PyStringMap;

import java.lang.reflect.Field;
import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.net.ServerSocket;
import java.util.ArrayList;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

public class DebugAdapterServerTest {

    @Test
    public void pythonConditionCanReadInjectedBindings() throws Exception {
        DebugAdapterServer server = newServer();

        boolean result = evaluatePythonCondition(
            server,
            "mbo.getString(\"ASSETNUM\") == \"13170\"",
            Map.of("mbo", new FakeMbo("13170"))
        );

        assertTrue(result);
    }

    @Test
    public void pythonConditionUsesJythonExpressionSemantics() throws Exception {
        DebugAdapterServer server = newServer();

        boolean result = evaluatePythonCondition(
            server,
            "mbo.getString(\"ASSETNUM\").equals(\"13170\")",
            Map.of("mbo", new FakeMbo("13170"))
        );

        assertFalse(result);
    }

    @Test
    public void resolveScriptNameUsesIndexedPathBeforeFilenameFallback() throws Exception {
        DebugAdapterServer server = newServer();
        setField(server, "scriptPathIndex", Map.of("ASSET_SAVE", "/tmp/scripts/asset_save.py"));

        String resolved = (String) invoke(server, "resolveScriptName", new Class<?>[] { Map.class }, Map.of("path", "/tmp/scripts/asset_save.py"));

        assertEquals("ASSET_SAVE", resolved);
    }

    @Test
    public void resolveScriptNameFallsBackToUppercaseFileStemAndName() throws Exception {
        DebugAdapterServer server = newServer();

        String fromPath = (String) invoke(server, "resolveScriptName", new Class<?>[] { Map.class }, Map.of("path", "/tmp/scripts/asset_save.py"));
        String fromName = (String) invoke(server, "resolveScriptName", new Class<?>[] { Map.class }, Map.of("name", "asset_save.py"));
        Object missing = invoke(server, "resolveScriptName", new Class<?>[] { Map.class }, Map.of());

        assertEquals("ASSET_SAVE", fromPath);
        assertEquals("ASSET_SAVE", fromName);
        assertNull(missing);
    }

    @Test
    public void helperMethodsHandleCommonValueConversions() throws Exception {
        DebugAdapterServer server = newServer();

        assertTrue((Boolean) invoke(server, "isTruthy", new Class<?>[] { Object.class }, List.of("x")));
        assertFalse((Boolean) invoke(server, "isTruthy", new Class<?>[] { Object.class }, Collections.emptyList()));
        assertTrue((Boolean) invoke(server, "isTruthy", new Class<?>[] { Object.class }, Map.of("x", 1)));
        assertFalse((Boolean) invoke(server, "isTruthy", new Class<?>[] { Object.class }, Map.of()));
        assertTrue((Boolean) invoke(server, "isTruthy", new Class<?>[] { Object.class }, new int[] { 1 }));
        assertFalse((Boolean) invoke(server, "isTruthy", new Class<?>[] { Object.class }, new int[0]));
        assertEquals(42, invoke(server, "intValue", new Class<?>[] { Object.class, int.class }, "42", -1));
        assertEquals(-1, invoke(server, "intValue", new Class<?>[] { Object.class, int.class }, "bad", -1));
        assertEquals("", invoke(server, "stringValue", new Class<?>[] { Object.class }, new Object[] { null }));
        assertEquals("value", invoke(server, "stringValue", new Class<?>[] { Object.class }, "value"));
    }

    @Test
    public void languageMetadataHelpersMatchSupportedRuntimes() throws Exception {
        assertTrue((Boolean) invokeStatic(DebugAdapterServer.class, "isJavaScriptLanguage", new Class<?>[] { String.class }, "javascript"));
        assertTrue((Boolean) invokeStatic(DebugAdapterServer.class, "isJavaScriptLanguage", new Class<?>[] { String.class }, "nashorn"));
        assertFalse((Boolean) invokeStatic(DebugAdapterServer.class, "isJavaScriptLanguage", new Class<?>[] { String.class }, "jython"));
        assertEquals(".js", invokeStatic(DebugAdapterServer.class, "scriptFileExtension", new Class<?>[] { String.class }, "js"));
        assertEquals(".py", invokeStatic(DebugAdapterServer.class, "scriptFileExtension", new Class<?>[] { String.class }, "python"));
        assertEquals("text/javascript", invokeStatic(DebugAdapterServer.class, "scriptMimeType", new Class<?>[] { String.class }, "ecmascript"));
        assertEquals("text/x-python", invokeStatic(DebugAdapterServer.class, "scriptMimeType", new Class<?>[] { String.class }, "jython"));
    }

    @Test
    public void parseAndExtractHelpersConvertMappingsToStringKeyedMaps() throws Exception {
        DebugAdapterServer server = newServer();

        Map<Object, Object> raw = new LinkedHashMap<>();
        raw.put(1, 2);
        raw.put("a", "b");
        raw.put("skip", null);
        Map<String, String> parsed = castStringMap(invoke(server, "parseStringMap", new Class<?>[] { Object.class }, raw));
        assertEquals(Map.of("1", "2", "a", "b"), parsed);

        Map<String, Object> direct = castObjectMap(invoke(server, "extractFrameLocals", new Class<?>[] { Object.class }, Map.of("a", 1, 2, "b")));
        assertEquals(Map.of("a", 1, "2", "b"), direct);

        PyStringMap pyStringMap = new PyStringMap();
        pyStringMap.__setitem__("asset", new PyString("13170"));
        Map<String, Object> fromPyStringMap = castObjectMap(invoke(server, "extractFrameLocals", new Class<?>[] { Object.class }, pyStringMap));
        assertEquals(Map.of("asset", "13170"), fromPyStringMap);

        PyDictionary pyDictionary = new PyDictionary();
        pyDictionary.__setitem__(new PyString("status"), new PyString("ACTIVE"));
        Map<String, Object> fromPyDictionary = castObjectMap(invoke(server, "extractFrameLocals", new Class<?>[] { Object.class }, pyDictionary));
        assertEquals(Map.of("status", "ACTIVE"), fromPyDictionary);
    }

    @Test
    public void summarizeAndClassifySimpleValuesWithoutMaximoTypes() throws Exception {
        DebugAdapterServer server = newServer();

        assertEquals("ArrayList[2]", invoke(server, "summarizeValue", new Class<?>[] { Object.class }, new ArrayList<>(List.of("a", "b"))));
        Map<String, Object> ordered = new LinkedHashMap<>();
        ordered.put("a", 1);
        assertEquals("LinkedHashMap[1]", invoke(server, "summarizeValue", new Class<?>[] { Object.class }, ordered));
        assertEquals("int[3]", invoke(server, "summarizeValue", new Class<?>[] { Object.class }, new int[] { 1, 2, 3 }));
        assertTrue((Boolean) invoke(server, "isSimpleValue", new Class<?>[] { Object.class }, 1));
        assertTrue((Boolean) invoke(server, "isSimpleValue", new Class<?>[] { Object.class }, "x"));
        assertFalse((Boolean) invoke(server, "isSimpleValue", new Class<?>[] { Object.class }, List.of("x")));
    }

    @Test
    public void reflectionSafetyHelpersRecognizeDangerousMethodsAndInvocationErrors() throws Exception {
        DebugAdapterServer server = newServer();

        Method waitMethod = Object.class.getMethod("wait");
        Method clearMethod = SampleBean.class.getMethod("clearCache");
        Method getterMethod = SampleBean.class.getMethod("getName");
        Method methodSignatureTarget = SampleBean.class.getMethod("setCount", int.class);

        assertTrue((Boolean) invoke(server, "isDangerousGetter", new Class<?>[] { Method.class }, waitMethod));
        assertTrue((Boolean) invoke(server, "isDangerousGetter", new Class<?>[] { Method.class }, clearMethod));
        assertFalse((Boolean) invoke(server, "isDangerousGetter", new Class<?>[] { Method.class }, getterMethod));
        assertEquals("public void setCount(int)", invoke(server, "methodSignature", new Class<?>[] { Method.class }, methodSignatureTarget));

        InvocationTargetException wrapped = new InvocationTargetException(new IllegalStateException("boom"));
        assertEquals("<error: IllegalStateException>", invoke(server, "formatInvocationError", new Class<?>[] { Exception.class }, wrapped));
    }

    @Test
    public void breakpointLookupAndBlankConditionsStopImmediately() throws Exception {
        DebugAdapterServer server = newServer();

        Map<Integer, Object> breakpoints = new LinkedHashMap<>();
        breakpoints.put(17, newBreakpointDefinition(17, ""));
        setField(server, "breakpointsByScript", Map.of("ASSET_SAVE", breakpoints));

        assertTrue((Boolean) invoke(server, "shouldStopForPythonBreakpoint", new Class<?>[] { String.class, int.class, Map.class, org.python.core.PyFrame.class }, "asset_save", 17, Map.of(), null));
        assertTrue((Boolean) invoke(server, "shouldStopForJavaScriptBreakpoint", new Class<?>[] { String.class, int.class, Map.class, Object.class }, "asset_save", 17, Map.of(), Map.of()));
        assertEquals(17, getField(newBreakpointDefinition(17, "x"), "lineNumber"));
        assertEquals("", getField(invoke(server, "breakpointFor", new Class<?>[] { String.class, int.class }, "ASSET_SAVE", 99), "condition", true));
    }

    @Test
    public void missingBreakpointsDoNotStop() throws Exception {
        DebugAdapterServer server = newServer();

        assertFalse((Boolean) invoke(server, "shouldStopForPythonBreakpoint", new Class<?>[] { String.class, int.class, Map.class, org.python.core.PyFrame.class }, "asset_save", 17, Map.of(), null));
        assertFalse((Boolean) invoke(server, "shouldStopForJavaScriptBreakpoint", new Class<?>[] { String.class, int.class, Map.class, Object.class }, "asset_save", 17, Map.of(), Map.of()));
    }

    @Test
    public void stepStateHonorsModeScriptAndThreadMatching() throws Exception {
        DebugAdapterServer server = newServer();
        int threadId = Math.toIntExact(Thread.currentThread().getId());

        setField(server, "stepState", newStepState("asset_save", threadId, 10, 2, "OVER"));
        assertFalse((Boolean) invoke(server, "shouldStopForStep", new Class<?>[] { String.class, int.class, int.class }, "ASSET_SAVE", 10, 2));
        assertTrue((Boolean) invoke(server, "shouldStopForStep", new Class<?>[] { String.class, int.class, int.class }, "ASSET_SAVE", 11, 2));
        assertTrue((Boolean) invoke(server, "shouldStopForStep", new Class<?>[] { String.class, int.class, int.class }, "ASSET_SAVE", 10, 1));

        setField(server, "stepState", newStepState("asset_save", threadId, 10, 2, "IN"));
        assertFalse((Boolean) invoke(server, "shouldStopForStep", new Class<?>[] { String.class, int.class, int.class }, "ASSET_SAVE", 10, 2));
        assertTrue((Boolean) invoke(server, "shouldStopForStep", new Class<?>[] { String.class, int.class, int.class }, "ASSET_SAVE", 10, 3));
        assertTrue((Boolean) invoke(server, "shouldStopForStep", new Class<?>[] { String.class, int.class, int.class }, "ASSET_SAVE", 11, 2));

        setField(server, "stepState", newStepState("asset_save", threadId, 10, 2, "OUT"));
        assertFalse((Boolean) invoke(server, "shouldStopForStep", new Class<?>[] { String.class, int.class, int.class }, "ASSET_SAVE", 11, 2));
        assertTrue((Boolean) invoke(server, "shouldStopForStep", new Class<?>[] { String.class, int.class, int.class }, "ASSET_SAVE", 10, 1));

        setField(server, "stepState", newStepState("asset_save", threadId + 1, 10, 2, "OVER"));
        assertFalse((Boolean) invoke(server, "shouldStopForStep", new Class<?>[] { String.class, int.class, int.class }, "ASSET_SAVE", 11, 2));

        setField(server, "stepState", newStepState("other_script", threadId, 10, 2, "OVER"));
        assertFalse((Boolean) invoke(server, "shouldStopForStep", new Class<?>[] { String.class, int.class, int.class }, "ASSET_SAVE", 11, 2));

        invoke(server, "clearStepState", new Class<?>[0]);
        assertFalse((Boolean) invoke(server, "shouldStopForStep", new Class<?>[] { String.class, int.class, int.class }, "ASSET_SAVE", 11, 2));
    }

    @Test
    public void objectExpansionIncludesInspectorMetadataAndMethods() throws Exception {
        DebugAdapterServer server = newServer();
        SampleBean bean = new SampleBean();

        Map<String, Object> variable = castObjectMap(invoke(
            server,
            "createVariable",
            new Class<?>[] { String.class, Object.class, int.class, IdentityHashMap.class },
            "bean",
            bean,
            0,
            new IdentityHashMap<>()
        ));

        int reference = (Integer) variable.get("variablesReference");
        assertNotEquals(0, reference);

        List<Map<String, Object>> children = castVariableList(invoke(server, "resolveVariables", new Class<?>[] { int.class }, reference));

        assertTrue(containsChildNamed(children, "name"));
        assertTrue(containsChildNamed(children, "count"));
        assertTrue(containsChildNamed(children, "__meta__"));
        assertTrue(containsChildNamed(children, "__methods__"));

        Map<String, Object> methods = childNamed(children, "__methods__");
        int methodsReference = (Integer) methods.get("variablesReference");
        assertNotEquals(0, methodsReference);

        List<Map<String, Object>> methodEntries = castVariableList(invoke(server, "resolveVariables", new Class<?>[] { int.class }, methodsReference));
        assertTrue(methodEntries.stream().anyMatch(entry -> "public String getName()".equals(entry.get("name"))));
        assertTrue(methodEntries.stream().anyMatch(entry -> "public void setCount(int)".equals(entry.get("name"))));
        assertTrue(methodEntries.stream().anyMatch(entry -> "SampleBean".equals(entry.get("value"))));
    }

    @Test
    public void createVariableAvoidsCyclesAndDepthOverflow() throws Exception {
        DebugAdapterServer server = newServer();
        SampleBean bean = new SampleBean();
        IdentityHashMap<Object, Boolean> seen = new IdentityHashMap<>();
        seen.put(bean, Boolean.TRUE);

        Map<String, Object> cycleVariable = castObjectMap(invoke(
            server,
            "createVariable",
            new Class<?>[] { String.class, Object.class, int.class, IdentityHashMap.class },
            "bean",
            bean,
            0,
            seen
        ));
        assertEquals(0, cycleVariable.get("variablesReference"));

        Map<String, Object> depthVariable = castObjectMap(invoke(
            server,
            "createVariable",
            new Class<?>[] { String.class, Object.class, int.class, IdentityHashMap.class },
            "bean",
            bean,
            4,
            new IdentityHashMap<>()
        ));
        assertEquals(0, depthVariable.get("variablesReference"));
    }

    @Test
    public void shutdownClosesListenerAndClearsRuntimeState() throws Exception {
        DebugAdapterServer server = newServer();
        ServerSocket socket = new ServerSocket(0);
        setField(server, "serverSocket", socket);
        setField(server, "scriptPathIndex", Map.of("ASSET_SAVE", "/tmp/asset_save.py"));
        setField(server, "breakpointsByScript", new LinkedHashMap<>(Map.of("ASSET_SAVE", new LinkedHashMap<>())));
        setField(server, "variableReferences", new java.util.concurrent.ConcurrentHashMap<>(Map.of(1000, List.of())));

        Field startedField = DebugAdapterServer.class.getDeclaredField("started");
        startedField.setAccessible(true);
        ((java.util.concurrent.atomic.AtomicBoolean) startedField.get(server)).set(true);

        server.shutdown();

        assertTrue(socket.isClosed());
        assertNull(getField(server, "serverSocket"));
        assertEquals(Map.of(), getField(server, "scriptPathIndex"));
        assertTrue(((Map<?, ?>) getField(server, "breakpointsByScript")).isEmpty());
        assertTrue(((Map<?, ?>) getField(server, "variableReferences")).isEmpty());
        assertFalse(((java.util.concurrent.atomic.AtomicBoolean) startedField.get(server)).get());
    }

    @Test
    public void clientActivityTimestampDrivesIdleDetection() throws Exception {
        DebugAdapterServer server = newServer();

        invoke(server, "markClientActivity", new Class<?>[0]);
        assertFalse((Boolean) invoke(server, "isClientIdle", new Class<?>[] { int.class }, 50));

        setField(server, "lastClientActivityMillis", System.currentTimeMillis() - 5_000);
        assertTrue((Boolean) invoke(server, "isClientIdle", new Class<?>[] { int.class }, 1_000));
    }

    private DebugAdapterServer newServer() throws Exception {
        Constructor<DebugAdapterServer> constructor = DebugAdapterServer.class.getDeclaredConstructor();
        constructor.setAccessible(true);
        return constructor.newInstance();
    }

    private boolean evaluatePythonCondition(DebugAdapterServer server, String expression, Map<String, Object> context) throws Exception {
        Method method = DebugAdapterServer.class.getDeclaredMethod("evaluatePythonCondition", String.class, Map.class, org.python.core.PyFrame.class);
        method.setAccessible(true);
        return (boolean) method.invoke(server, expression, context, null);
    }

    private Object invoke(DebugAdapterServer server, String methodName, Class<?>[] parameterTypes, Object... args) throws Exception {
        Method method = DebugAdapterServer.class.getDeclaredMethod(methodName, parameterTypes);
        method.setAccessible(true);
        return method.invoke(server, args);
    }

    private Object invokeStatic(Class<?> type, String methodName, Class<?>[] parameterTypes, Object... args) throws Exception {
        Method method = type.getDeclaredMethod(methodName, parameterTypes);
        method.setAccessible(true);
        return method.invoke(null, args);
    }

    private void setField(DebugAdapterServer server, String fieldName, Object value) throws Exception {
        Field field = DebugAdapterServer.class.getDeclaredField(fieldName);
        field.setAccessible(true);
        field.set(server, value);
    }

    private Object newBreakpointDefinition(int lineNumber, String condition) throws Exception {
        Class<?> type = Class.forName("io.naviam.autoscript.debug.DebugAdapterServer$BreakpointDefinition");
        Constructor<?> constructor = type.getDeclaredConstructor(int.class, String.class);
        constructor.setAccessible(true);
        return constructor.newInstance(lineNumber, condition);
    }

    private Object newStepState(String scriptName, int threadId, int lineNumber, int frameDepth, String modeName) throws Exception {
        Class<?> stepStateType = Class.forName("io.naviam.autoscript.debug.DebugAdapterServer$StepState");
        Class<?> stepModeType = Class.forName("io.naviam.autoscript.debug.DebugAdapterServer$StepMode");
        Constructor<?> constructor = stepStateType.getDeclaredConstructor(String.class, int.class, int.class, int.class, stepModeType);
        constructor.setAccessible(true);
        Object mode = Enum.valueOf(stepModeType.asSubclass(Enum.class), modeName);
        return constructor.newInstance(scriptName, threadId, lineNumber, frameDepth, mode);
    }

    private Object getField(Object target, String fieldName) throws Exception {
        return getField(target, fieldName, false);
    }

    private Object getField(Object target, String fieldName, boolean nullSafe) throws Exception {
        if (target == null && nullSafe) {
            return "";
        }
        Field field = target.getClass().getDeclaredField(fieldName);
        field.setAccessible(true);
        return field.get(target);
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> castVariableList(Object value) {
        return (List<Map<String, Object>>) value;
    }

    private boolean containsChildNamed(List<Map<String, Object>> children, String name) {
        return children.stream().anyMatch(child -> name.equals(child.get("name")));
    }

    private Map<String, Object> childNamed(List<Map<String, Object>> children, String name) {
        return children.stream()
            .filter(child -> name.equals(child.get("name")))
            .findFirst()
            .orElseThrow();
    }

    @SuppressWarnings("unchecked")
    private Map<String, String> castStringMap(Object value) {
        return (Map<String, String>) value;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> castObjectMap(Object value) {
        return (Map<String, Object>) value;
    }

    public static final class FakeMbo {
        private final String assetNum;

        public FakeMbo(String assetNum) {
            this.assetNum = assetNum;
        }

        public String getString(String attributeName) {
            if ("ASSETNUM".equals(attributeName)) {
                return assetNum;
            }
            return "";
        }
    }

    public static final class SampleBean {
        public int count = 3;

        public void clearCache() {
        }

        public String getName() {
            return "sample";
        }

        public int getCount() {
            return count;
        }

        public void setCount(int count) {
        }
    }
}
