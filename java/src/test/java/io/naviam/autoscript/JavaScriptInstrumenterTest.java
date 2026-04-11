package io.naviam.autoscript;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class JavaScriptInstrumenterTest {

    @Test
    public void leavesBlankSourcesUntouched() {
        assertEquals(null, JavaScriptInstrumenter.instrument("TEST", null));
        assertEquals("   ", JavaScriptInstrumenter.instrument("TEST", "   "));
    }

    @Test
    public void instrumentsTopLevelStatementsWithTraceCalls() {
        String source = "var asset = mbo.getString(\"ASSETNUM\");\nasset;";

        String instrumented = JavaScriptInstrumenter.instrument("ASSET_SAVE", source);

        assertTrue(instrumented.contains("__autoscript_debugger.trace_js(1,"));
        assertTrue(instrumented.contains("__autoscript_debugger.trace_js(2,"));
        assertTrue(instrumented.contains("'this':(function(){try{return this;}catch(e){return undefined;}})()"));
        assertTrue(instrumented.contains("'asset':(function(){try{return asset;}catch(e){return undefined;}})()"));
    }

    @Test
    public void instrumentsFunctionBodiesAndEscapesNames() {
        String source = "function save_asset(){\n  return 1;\n}";

        String instrumented = JavaScriptInstrumenter.instrument("ASSET_SAVE", source);

        assertTrue(instrumented.contains("__autoscript_debugger.enter_js(\"save_asset\",1);try{"));
        assertTrue(instrumented.contains("}finally{__autoscript_debugger.exit_js();}"));
        assertTrue(instrumented.contains("function save_asset(){__autoscript_debugger.enter_js(\"save_asset\",1);try{"));
    }

    @Test
    public void wrapsSingleStatementControlFlowBodies() {
        String source = "if (flag)\n  value++;\nfor (;flag;)\n  value--;";

        String instrumented = JavaScriptInstrumenter.instrument("TEST", source);

        assertTrue(instrumented.contains("if (flag)\n  {"));
        assertTrue(instrumented.contains("__autoscript_debugger.trace_js(2,"));
        assertTrue(instrumented.contains("for (;flag;)\n  {"));
        assertTrue(instrumented.contains("__autoscript_debugger.trace_js(3,"));
    }

    @Test
    public void doesNotInjectTraceCallsIntoForVarInitializers() {
        String source = "function test(){\n  for (var index = 0; index < 3; index++) {\n    value += index;\n  }\n}";

        String instrumented = JavaScriptInstrumenter.instrument("TEST", source);

        assertTrue(instrumented.contains("for (var index = 0; index < 3; index++) {"));
        assertTrue(instrumented.contains("__autoscript_debugger.trace_js(2,"));
        assertTrue(instrumented.contains("__autoscript_debugger.trace_js(3,"));
        assertTrue(!instrumented.contains("for (__autoscript_debugger.trace_js"));
        assertTrue(!instrumented.contains("for (var __autoscript_debugger.trace_js"));
    }
}
