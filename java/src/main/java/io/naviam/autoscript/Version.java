package io.naviam.autoscript;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;

/**
 * Utility class to print the version without requiring dependencies.
 */
public class Version {


    /**
     * Print the debug driver version.
     *
     * @param args command line arguments, not used.
     */
    public static void main(String[] args) {
        System.out.println("Version: " + getVersion());
        System.exit(0);
    }


    /**
     * Gets the DebugDriver version.
     *
     * @return version string or "unknown" if the version file cannot be read
     */
    @SuppressWarnings("unused")
    public static String getVersion() {
        InputStream is = Version.class.getResourceAsStream("/autoscript-debug-version.txt");
        if (is == null) {
            is = Version.class.getResourceAsStream("/autoscript-debug-version.txt");
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
}
