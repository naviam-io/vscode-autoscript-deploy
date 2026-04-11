package io.naviam.autoscript;

import org.junit.Test;

import java.io.ByteArrayOutputStream;
import java.io.StringWriter;
import java.io.Writer;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;

import static org.junit.Assert.assertEquals;

public class DebugDriverTest {

    @Test
    public void lineForwardingWriterBuffersUntilFlushOrNewline() throws Exception {
        StringWriter delegate = new StringWriter();
        Writer writer = newLineForwardingWriter(delegate, "ASSET_SAVE", "stdout");

        writer.write("abc".toCharArray(), 0, 3);
        assertEquals("abc", delegate.toString());
        assertEquals(3, bufferSize(writer));

        writer.write("\nxy".toCharArray(), 0, 3);
        assertEquals("abc\nxy", delegate.toString());
        assertEquals(2, bufferSize(writer));

        writer.flush();
        assertEquals(0, bufferSize(writer));

        writer.write("z".toCharArray(), 0, 1);
        assertEquals(1, bufferSize(writer));
        writer.close();
        assertEquals(0, bufferSize(writer));
    }

    @Test
    public void lineForwardingWriterDefaultsBlankScriptName() throws Exception {
        StringWriter delegate = new StringWriter();
        Writer writer = newLineForwardingWriter(delegate, " ", "stderr");

        writer.write("line".toCharArray(), 0, 4);
        assertEquals("line", delegate.toString());
        writer.flush();

        Field scriptName = writer.getClass().getDeclaredField("scriptName");
        scriptName.setAccessible(true);
        assertEquals("autoscript", scriptName.get(writer));
    }

    private Writer newLineForwardingWriter(Writer delegate, String scriptName, String category) throws Exception {
        Class<?> type = Class.forName("io.naviam.autoscript.debug.DebugDriver$LineForwardingWriter");
        Constructor<?> constructor = type.getDeclaredConstructor(Writer.class, String.class, String.class);
        constructor.setAccessible(true);
        return (Writer) constructor.newInstance(delegate, scriptName, category);
    }

    private int bufferSize(Writer writer) throws Exception {
        Field bufferField = writer.getClass().getDeclaredField("buffer");
        bufferField.setAccessible(true);
        return ((ByteArrayOutputStream) bufferField.get(writer)).size();
    }
}
