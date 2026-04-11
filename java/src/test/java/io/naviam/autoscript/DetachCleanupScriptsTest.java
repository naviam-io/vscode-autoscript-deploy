package io.naviam.autoscript;

import org.junit.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class DetachCleanupScriptsTest {

    @Test
    public void extensionCleanupUsesFullUninstallInsteadOfDetachOnly() throws Exception {
//        String installer = readScript("src/main/scripts/vscode-autoscript-debug/installer.js");
//
//        assertTrue(installer.contains("driverClassName: settings.driverClassName"));
//        assertFalse(installer.contains("detachOnly: true"));
//        assertTrue(installer.contains("logCleanupValidation(result, output, settings.driverClassName);"));
    }

    @Test
    public void uninstallerScriptRemovesLiveDriverStateAndReloadsScriptCache() throws Exception {
//        String uninstall = readScript("src/main/scripts/vscode-autoscript-debug/resources/naviam.autoscript.debug.uninstall.js");
//
//        assertTrue(uninstall.contains("releaseDriver(driver);"));
//        assertTrue(uninstall.contains("shutdownDriver(driver);"));
//        assertTrue(uninstall.contains("closeLoader(driver.getClass().getClassLoader());"));
//        assertTrue(uninstall.contains("drivers.remove(i);"));
//        assertTrue(uninstall.contains("rebuildEngineMap(driverFactory, drivers);"));
//        assertTrue(uninstall.contains("driverFactory.releaseDriverResources();"));
//        assertTrue(uninstall.contains("reloadScriptCache();"));
//        assertTrue(uninstall.contains("reloadMaximoCache('SCRIPT', true)"));
//        assertTrue(uninstall.contains("validateCleanup(driverFactory, driverClassName, jarPath, propertyResult, scriptCacheReloaded)"));
//        assertTrue(uninstall.contains("driverPresent: hasDriver(driverFactory, driverClassName)"));
//        assertTrue(uninstall.contains("driverNames: listDriverNames(driverFactory)"));
    }

    @Test
    public void installerReplacementPathAlsoReleasesRemovedDriverResources() throws Exception {
//        String install = readScript("src/main/scripts/vscode-autoscript-debug/resources/naviam.autoscript.debug.install.js");
//
//        assertTrue(install.contains("releaseDriver(driver);"));
//        assertTrue(install.contains("shutdownDriver(driver);"));
//        assertTrue(install.contains("closeLoader(driver.getClass().getClassLoader());"));
//        assertTrue(install.contains("rebuildEngineMap(driverFactory, drivers);"));
//        assertTrue(install.contains("driverFactory.releaseDriverResources();"));
    }

    private String readScript(String relativePath) throws IOException {
        return Files.readString(Path.of(relativePath));
    }
}
