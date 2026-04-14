# AutoDebug

AutoDebug is a Java 17 Maximo automation script debugger that integrates with the Maximo Developer Tools VS Code extension.

It runs a Debug Adapter Protocol server inside the Maximo JVM, injects debugger bindings into automation scripts, and lets VS Code attach to live Jython and JavaScript/Nashorn execution.

## Repository layout

- `src/main/java/io/naviam/autoscript`
  Java-side debugger implementation, Maximo script driver, debug adapter server, and JavaScript instrumentation.
- `docs/vscode-mvp.md`
  Main debugger behavior and design document.

## What it supports

### Runtimes

- Jython automation scripts
- JavaScript/Nashorn automation scripts

### Debugging features

- attach from VS Code to Maximo over TCP
- line breakpoints
- conditional breakpoints
- manual breakpoints from script code
- step in
- step over
- step out
- paused stack frame inspection
- expression evaluation
- console stdout/stderr forwarding
- script-name to local-file indexing from configured workspace roots

### Variable inspection

The debugger exposes locals and other visible bindings and supports:

- simple scalar rendering
- lazy variable expansion
- collection, map, and array expansion
- cycle protection
- expansion depth limits
- reflective Java object inspection
- custom higher-signal views for selected Maximo runtime types

For many Java-backed objects you will see:

- bean properties
- instance fields
- `__meta__`
- `__methods__`

For Maximo-heavy types the debugger adds custom summaries and children for objects such as:

- `ScriptService`
- `MboRemote`
- `MboSetRemote`
- `UserInfo`

## How it works

The main pieces are:

- `Driver`
  Custom Maximo script driver that installs debugger bindings, wraps script output, enables Jython tracing, and instruments JavaScript/Nashorn source before execution.
- `DebugAdapterServer`
  In-process TCP Debug Adapter Protocol server that handles attach, breakpoints, stack traces, stepping, evaluation, and variable inspection.
- VS Code extension
  Provides the `autoscript` debug type, resolves `scriptRoots`, scans local `.py` and `.js` files, and builds a script index keyed by uppercased file stem.
  It can also install the packaged AutoDebug jar into Maximo before attach when configured to do so.

Jython and JavaScript do not use the same internals:

- Jython line events and stepping use the Jython trace hook.
- JavaScript/Nashorn line events and stepping use runtime source instrumentation.

## Maximo configuration

These settings are read from Maximo properties first and then JVM system properties as a fallback. Set them in Maximo or on the Maximo JVM and restart Maximo:

- `naviam.autoscript.debug.enabled`
  Enables the in-process debug adapter. Typical value: `1`.
- `naviam.autoscript.debug.port`
  TCP port exposed by the debug adapter. Default: `4711`.
- `naviam.autoscript.debug.host`
  Bind host for the adapter listener. Default: `0.0.0.0`.
- `naviam.autoscript.debug.js.exclude`
  Exact script names to exclude from JavaScript/Nashorn debugger integration. Matching is case-insensitive. Separators can be commas, whitespace, or both, (this is in place as a temporary workaround for the Development Toolkit as it wants to reinstall it's autoscripts every time it runs due to the driver instrumenting the debug framework and the scripts updating at compile time).

Default excluded JavaScript scripts:

- `NAVIAM.AUTOSCRIPT.ADMIN`
- `NAVIAM.AUTOSCRIPT.DBC`
- `NAVIAM.AUTOSCRIPT.DEPLOY`
- `NAVIAM.AUTOSCRIPT.DEPLOY.HISTORY`
- `NAVIAM.AUTOSCRIPT.EXTRACT`
- `NAVIAM.AUTOSCRIPT.FORM`
- `NAVIAM.AUTOSCRIPT.LIBRARY`
- `NAVIAM.AUTOSCRIPT.LOGGING`
- `NAVIAM.AUTOSCRIPT.OBJECTS`
- `NAVIAM.AUTOSCRIPT.REPORT`
- `NAVIAM.AUTOSCRIPT.SCREENS`
- `NAVIAM.AUTOSCRIPT.STORE`

Example:

```properties
mxe.autoscript.debug.enabled=1
mxe.autoscript.debug.port=4711
mxe.autoscript.debug.host=127.0.0.1
mxe.autoscript.debug.js.exclude=NAVIAM.AUTOSCRIPT.EXTRACT,NAVIAM.AUTOSCRIPT.DEPLOY
```

## VS Code configuration

The extension contributes an attach configuration like this:

```json
{
  "type": "autoscript",
  "request": "attach",
  "name": "Attach to Maximo AutoScript",
  "host": "127.0.0.1",
  "port": 4711,
  "scriptRoots": ["${workspaceFolder}/autoScripts"]
}
```

### Configuration fields

- `host`
  Host for the Maximo debug adapter. Defaults to `127.0.0.1`.
- `port`
  Port for the Maximo debug adapter. Defaults to `4711`.
- `scriptRoots`
  Local folders scanned recursively for `.py` and `.js` files. Files are indexed by uppercased file stem.


If `scriptRoots` is omitted, the extension defaults to `${workspaceFolder}/autoScripts`.

Install-on-attach also requires VS Code settings for the Maximo HTTP connection and an absolute Maximo-side install directory. See the extension README for the full list.

## Script usage

### Jython manual breakpoints

```python
if debugger.isEnabled():
    debugger.breakpoint("before save")
```

With an explicit reported line:

```python
if debugger.isEnabled():
    debugger.breakpoint("before save", 42)
```

### JavaScript/Nashorn manual breakpoints

```javascript
if (__autoscript_debugger.isEnabled()) {
    __autoscript_debugger.breakpoint("before save", 42);
}
```

### Conditional breakpoint syntax

Conditional breakpoints are evaluated in the script language, not in Java.

Jython example:

```python
mbo.getString("ASSETNUM") == "13170"
```

JavaScript/Nashorn example:

```javascript
mbo.getString("ASSETNUM") === "13170"
```

Do not rely on Java-style `.equals(...)` in conditional breakpoint expressions.

## Typical workflow

1. Build the Java jar.
2. Either deploy the Java code into the target Maximo environment yourself, or configure install-on-attach so the VS Code extension uploads the jar for you.
3. Enable the Maximo debug properties and restart Maximo if the driver is not activated live.
4. Open `src/main/scripts/vscode-autoscript-debug` in VS Code and launch the Extension Development Host.
5. In the development host, open the script workspace, usually `src/main/scripts`.
6. Start the `Attach to Maximo AutoScript` configuration.
7. Set breakpoints in local `.py` or `.js` files under the configured script roots.
8. Trigger the automation script in Maximo.
9. Inspect variables, evaluate expressions, view console output, and step execution.

## JavaScript/Nashorn notes

- JavaScript instrumentation is only applied when a debug client is attached.
- Scripts excluded by `mxe.autoscript.debug.js.exclude` do not get injected debugger bindings or runtime instrumentation.
- Excluded JavaScript scripts run through Maximo's native JavaScript path.
- The runtime debugger alias for JavaScript is `__autoscript_debugger`.
- You do not need to modify script source to use standard VS Code line breakpoints.
- JavaScript expression evaluation and conditional breakpoints are evaluated against a captured visible-bindings snapshot for the paused frame.

## Limitations

- Source mapping is filename-based rather than driven by authoritative Maximo metadata.
  The VS Code extension indexes local `.py` and `.js` files by uppercased file stem, so workspace names must line up with Maximo script names. If multiple files collapse to the same key, the last indexed file wins.
- The debugger is built around a single in-process adapter and a single active paused script.
  One VS Code client attaches to one Maximo-hosted TCP listener, and only one script execution can remain suspended at a time. If another script hits a breakpoint while one is already paused, that second pause is skipped.
- Jython tracing is intentionally limited to the top-level automation script body.
  Stepping and line events do not try to expose arbitrary non-script Python frames, imported library internals, or Java call stacks as normal debugger frames.
- JavaScript/Nashorn frames are reconstructed from instrumentation snapshots rather than from a live lexical debugger API.
  Parent lexical scopes are not fully exposed as live frames, and evaluate/watch expressions run against the captured visible-bindings snapshot for the paused location.
- Step out from the top-level script body usually runs to completion because there is no outer script frame to stop on.
- JavaScript instrumentation only applies while a debug client is attached.
  Excluded scripts from `mxe.autoscript.debug.js.exclude` continue down Maximo's native JavaScript path and do not expose debugger bindings or standard VS Code line stepping.
- Variable inspection is intentionally conservative for Java and Maximo objects.
  The debugger prefers read-safe summaries, fields, and selected bean properties over invoking getters that may mutate state, trigger persistence work, or perform expensive remote access.
- The transport model assumes direct TCP reachability from VS Code to the Maximo JVM host and port.
  There is no built-in authentication, proxying, or remote session brokering in the debugger itself.

## Build and test

Compile Java:

```bash
./gradlew compileJava
```

Run tests:

```bash
./gradlew test
```

Run the full build:

```bash
./gradlew build
```

`build` runs `test`.

This project depends on a local Maximo installation for compile-only jars and classes. If compilation fails, verify the `maximoHome` path in `build.gradle`.

## Deployment

There is a `deployToContainer` task that builds the jar and copies it to the configured Podman container and local Maximo lib directory.

Those paths are environment-specific and intentionally tied to the current local setup in `build.gradle`.

## Additional documentation

- [Debugger design and behavior](/home/cbrown/IdeaProjects/AutoDebug/docs/vscode-mvp.md)
- [VS Code extension README](/home/cbrown/IdeaProjects/AutoDebug/src/main/scripts/vscode-autoscript-debug/README.md)
