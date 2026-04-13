# Maximo AutoScript Debugger

This project exposes a Debug Adapter Protocol server from inside the Maximo automation script runtime and ships a small VS Code extension that attaches to it.

The debugger is intended for local development against a Maximo environment where the custom Java driver is installed and the VS Code helper extension is running in an Extension Development Host.

## Architecture

The implementation has three main pieces:

- `Driver`: custom Maximo script driver that injects debugger bindings, installs Jython tracing, and instruments JavaScript/Nashorn source before execution.
- `DebugAdapterServer`: in-process TCP Debug Adapter Protocol server that tracks breakpoints, pause state, stack frames, variables, stepping, and console output.
- `src/main/scripts/vscode-autoscript-debug`: VS Code extension that contributes the `autoscript` debug type and builds a script-name to local-file index from the workspace.
  It can also perform a Maximo-side jar install before attach when configured.

The debugger listens inside the Maximo JVM and is designed to be attached to over localhost by VS Code.

## Supported runtimes

- Jython automation scripts
- JavaScript/Nashorn automation scripts

Java and JavaScript do not share the same debug plumbing:

- Jython line breakpoints and stepping use the Jython trace hook.
- JavaScript/Nashorn line breakpoints and stepping use source instrumentation injected before evaluation.

## Feature summary

### Session and attach behavior

- Maximo hosts a local TCP debug adapter.
- VS Code attaches with a custom `autoscript` debug type.
- The extension provides a default attach configuration.
- The extension resolves configured script roots and builds a script index from `.py` and `.js` files in the workspace.
- The extension can optionally connect to Maximo over HTTP before attach, upload the built debugger jar, update `mxe.script.drivers`, and try to activate the debugger driver in the running JVM.
- If the client drops unexpectedly, the server terminates the debug session and resumes any paused script thread.
- Optional liveness controls are available via `naviam.autoscript.debug.client.idleTimeoutMs` and `naviam.autoscript.debug.client.pollMs`.
- The adapter accepts a lightweight custom request (`autoscript/ping`) that extensions can send as a keepalive.

### Breakpoints

- Standard line breakpoints
- Conditional breakpoints
- Manual script breakpoints through the injected debugger bridge
- Breakpoint matching by Maximo script name and line number

Manual breakpoints are available from script code:

Jython:

```python
if debugger.isEnabled():
    debugger.breakpoint("before validation")
```

Jython with an explicit UI line number:

```python
if debugger.isEnabled():
    debugger.breakpoint("before validation", 42)
```

JavaScript/Nashorn:

```javascript
if (__autoscript_debugger.isEnabled()) {
    __autoscript_debugger.breakpoint("before validation", 42);
}
```

### Conditional expression semantics

Conditional breakpoints are evaluated in the script language for the paused frame, not in Java.

Jython conditions use Jython/Python expression syntax:

```python
mbo.getString("ASSETNUM") == "13170"
```

Prefer `==` and other Jython operators over Java-style method calls such as `.equals(...)`.

JavaScript/Nashorn conditions use JavaScript expression syntax:

```javascript
mbo.getString("ASSETNUM") === "13170"
```

Prefer `===` or `==` over Java-style `.equals(...)`.

### Stepping

- Step in
- Step over
- Step out

For JavaScript/Nashorn, the instrumentation also tracks function entry and exit so nested stepping behaves more like a normal debugger.

### Stack frames and source

- Paused sessions expose stack frames to VS Code.
- Jython frames use live script frames where available.
- JavaScript/Nashorn frames use the instrumented locals snapshot and current function markers.
- Source is returned to the client as `.py` or `.js`.
- The VS Code extension builds a script-name to file-path index so local files can be matched by script name.

Current source mapping behavior is name-based:

- a workspace file named `asset_save.py` maps to Maximo script name `ASSET_SAVE`
- a workspace file named `js_asset_save.js` maps to Maximo script name `JS_ASSET_SAVE`

This is simple and effective for local development, but it is not yet a full authoritative mapping from Maximo metadata.

### Expression evaluation

- Jython expressions can be evaluated against the paused frame
- JavaScript/Nashorn expressions can be evaluated against the captured visible bindings snapshot

This is the same general environment used for conditional breakpoint evaluation.

### Variable inspection

Paused sessions expose locals and other visible bindings in the Variables pane.

The debugger supports:

- simple scalar rendering
- lazy child expansion
- collection, map, and array expansion
- cycle protection
- expansion depth limits
- reflective Java object inspection

For ordinary Java objects, expansion includes:

- bean properties
- instance fields
- `__meta__` with class and identity metadata
- `__methods__` with a filtered and sorted method view

For Maximo-heavy runtime objects, the debugger exposes higher-signal custom views before the generic Java inspector:

- `ScriptService`
- `MboRemote`
- `MboSetRemote`
- `UserInfo`

For `MboRemote`, the custom view includes a compact `attributes` node with key attributes and a few common fields such as `description`, `status`, `siteid`, and `orgid` when available.

The reflective inspector is intentionally read-safe:

- obviously dangerous getters are skipped
- invocation failures are rendered as error strings instead of throwing into the debug session

### Console output

Script stdout and stderr are forwarded to the debugger console.

Output is buffered to line boundaries before being emitted, which keeps the VS Code console readable and tags output with the script name.

## Maximo configuration

Set these properties and restart Maximo:

- `naviam.autoscript.debug.enabled=1`
- `naviam.autoscript.debug.port=4711`

Optional behavior:

- `naviam.autoscript.debug.host`
  Defaults to `0.0.0.0` when unset.
- `naviam.autoscript.debug.js.exclude`
  Comma- or whitespace-separated list of JavaScript script names that should not be instrumented.

## VS Code configuration

The extension contributes an attach configuration like this:

```json
{
  "type": "autoscript",
  "request": "attach",
  "name": "Attach to Maximo AutoScript",
  "host": "127.0.0.1",
  "port": 4711,
  "scriptRoots": ["${workspaceFolder}/autoScripts"],
  "installOnAttach": false
}
```

### Configuration fields

- `host`
  Target host for the in-process debug adapter. Defaults to `127.0.0.1`.
- `port`
  Target port for the in-process debug adapter. Defaults to `4711`.
- `scriptRoots`
  One or more local folders scanned for `.py` and `.js` files. The extension indexes files under these roots by uppercased file stem.
- `installOnAttach`
  Optional pre-attach install flow that uploads the built jar to Maximo and invokes the packaged `NAVIAM.AUTOSCRIPT.DEBUG.INSTALL` automation script.

### Script root resolution

`scriptRoots` values may contain `${workspaceFolder}`. The extension expands these values before indexing files.

If `scriptRoots` is omitted, the extension defaults to:

```text
${workspaceFolder}/autoScripts
```

## Expected workflow

1. Install the built Java code into the target Maximo environment.
2. Set the Maximo debug properties and restart Maximo.
3. Open `src/main/scripts/vscode-autoscript-debug` in VS Code and launch the Extension Development Host.
4. In the development host, open the script workspace, usually `src/main/scripts`.
5. Start the `Attach to Maximo AutoScript` configuration.
6. Set breakpoints in local `.py` or `.js` files under the configured script roots.
7. Trigger the automation script in Maximo.
8. Inspect frames, variables, console output, and step execution from VS Code.

## Known limitations

- Source mapping is still filename-based, not driven by Maximo metadata.
- JavaScript/Nashorn does not yet provide full live lexical parent-scope inspection.
- The debugger is designed for local development and assumes direct access to the Maximo-hosted port.
- Rich inspection for Maximo objects is intentionally conservative to avoid mutating runtime state during inspection.

## Environment assumptions

- Java 17 build/runtime compatibility
- Maximo classes and compile-only jars available from the local Maximo installation configured in `build.gradle`
- Local VS Code workspace contains script files under the configured `scriptRoots`
- Deployment paths and container names remain environment-specific
