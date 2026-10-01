/*
 * Turns a deployment manifest into an ordered plan.
 *
 * This module deliberately has no dependency on the "vscode" module so that it can be exercised by
 * the unit tests in test/unit. It decides *what* will be deployed and in which order; performing
 * the deployment is the caller's job.
 *
 * An entry that declares a "kind" is routed explicitly and never triggers sidecar discovery. An
 * entry without one keeps the historical behaviour: routed by file extension, with the
 * conventional predeploy/deploy sidecars of an automation script applied as before.
 */
const fs = require('fs');
const path = require('path');

const SCRIPT_EXTENSIONS = ['.ts', '.js', '.py', '.jy'];

// The file extensions each kind accepts. databaseConfiguration is absent because it has no file.
const KIND_EXTENSIONS = {
    configuration: ['.json'],
    automationScript: SCRIPT_EXTENSIONS,
    deployScript: SCRIPT_EXTENSIONS,
    inspectionForm: ['.json'],
    screen: ['.xml'],
    report: ['.rptdesign'],
    manifest: ['.json']
};

const DATABASE_CONFIGURATION = 'databaseConfiguration';
const NESTED_MANIFEST = 'manifest';

// A chain of manifests longer than this is assumed to be a mistake rather than an intent.
const MAX_MANIFEST_DEPTH = 10;

/**
 * Reads and plans the manifest at the given path.
 *
 * Returns the ordered steps to perform, or the reasons the manifest cannot be deployed. The two are
 * exclusive: when anything at all is wrong no steps are returned, so nothing is sent to Maximo on
 * the strength of a manifest that is only partly correct.
 *
 * Entries that declare no kind are also reported, as deprecations, so that the caller can point
 * out that the manifest is written in the superseded form. A deprecation never prevents deployment.
 *
 * Entries marked "disabled" are reported too, and are otherwise ignored completely: they are not
 * validated, so an entry can be disabled while the file it names is missing or being rewritten.
 *
 * @param {string} manifestPath absolute path of the manifest file
 * @returns {{ steps: object[], errors: object[], deprecations: {manifestPath: string, index: number}[], disabled: {manifestPath: string, index: number}[] }}
 */
function planManifest(manifestPath) {
    const context = { steps: [], errors: [], deprecations: [], disabled: [], plannedPaths: new Set() };

    _planFile(manifestPath, context, []);

    return context.errors.length > 0
        ? { steps: [], errors: context.errors, deprecations: [], disabled: [] }
        : { steps: context.steps, errors: [], deprecations: context.deprecations, disabled: context.disabled };
}

function _planFile(manifestPath, context, ancestors) {
    const entries = _readEntries(manifestPath, context);
    if (!entries) {
        return;
    }

    const chain = ancestors.concat(manifestPath);
    entries.forEach((entry, index) => _planEntry(entry, index, manifestPath, context, chain));
}

function _readEntries(manifestPath, context) {
    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (error) {
        _fail(context, 'invalidManifest', manifestPath, null, `${manifestPath} could not be read as JSON: ${error.message}`);
        return null;
    }

    if (!manifest || !Array.isArray(manifest.manifest)) {
        _fail(context, 'invalidManifest', manifestPath, null, `${manifestPath} does not contain a "manifest" array.`);
        return null;
    }

    return manifest.manifest;
}

function _planEntry(entry, index, manifestPath, context, ancestors) {
    const kind = entry !== null && typeof entry === 'object' ? entry.kind : undefined;

    if (!_planNotDisabled(entry, index, manifestPath, context)) {
        return;
    }

    if (kind === DATABASE_CONFIGURATION) {
        _planDatabaseConfiguration(entry, index, manifestPath, context);
        return;
    }

    if (typeof kind !== 'undefined' && !Object.prototype.hasOwnProperty.call(KIND_EXTENSIONS, kind)) {
        _fail(context, 'unknownKind', manifestPath, index, `"${kind}" is not a supported kind.`);
        return;
    }

    const declaredPath = _declaredPath(entry);
    if (declaredPath === null) {
        if (typeof kind === 'undefined') {
            _fail(context, 'invalidEntry', manifestPath, index, 'An entry must be a path, or an object with a "path" property.');
        } else {
            _fail(context, 'missingPath', manifestPath, index, `A "${kind}" entry requires a "path" property.`);
        }
        return;
    }

    const resolvedPath = path.resolve(path.dirname(manifestPath), declaredPath);

    if (!fs.existsSync(resolvedPath)) {
        _fail(context, 'fileNotFound', manifestPath, index, `${resolvedPath} does not exist.`);
        return;
    }

    const extension = path.extname(resolvedPath).toLowerCase();

    if (typeof kind !== 'undefined' && !KIND_EXTENSIONS[kind].includes(extension)) {
        _fail(context, 'extensionMismatch', manifestPath, index, `A "${kind}" entry cannot be a ${extension} file: ${resolvedPath}.`);
        return;
    }

    const effectiveKind = typeof kind === 'undefined' ? _inferKind(resolvedPath, extension, index, manifestPath, context) : kind;
    if (effectiveKind === null) {
        return;
    }

    if (typeof kind === 'undefined') {
        context.deprecations.push({ manifestPath, index });
    }

    if (effectiveKind === NESTED_MANIFEST) {
        _planNestedManifest(resolvedPath, index, manifestPath, context, ancestors);
        return;
    }

    if (context.plannedPaths.has(resolvedPath)) {
        _fail(context, 'duplicatePath', manifestPath, index, `${resolvedPath} is already deployed by this manifest.`);
        return;
    }
    context.plannedPaths.add(resolvedPath);

    context.steps.push({
        kind: effectiveKind,
        path: resolvedPath,
        sidecars: typeof kind === 'undefined' && SCRIPT_EXTENSIONS.includes(extension),
        manifestPath
    });
}

/**
 * Works out what an entry that declares no kind refers to, the way deploying the file directly
 * would: by extension, and for JSON by what the document contains.
 *
 * @returns {string|null} the kind, or null when the entry has been reported as an error.
 */
function _inferKind(resolvedPath, extension, index, manifestPath, context) {
    if (SCRIPT_EXTENSIONS.includes(extension)) {
        return 'automationScript';
    }

    if (extension === '.xml') {
        return 'screen';
    }

    if (extension === '.rptdesign') {
        return 'report';
    }

    if (extension !== '.json') {
        _fail(context, 'unsupportedExtension', manifestPath, index, `${resolvedPath} has no deployable file extension.`);
        return null;
    }

    let json;
    try {
        json = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
    } catch (error) {
        _fail(context, 'invalidJson', manifestPath, index, `${resolvedPath} could not be read as JSON: ${error.message}`);
        return null;
    }

    if (isManifestDocument(json)) {
        return NESTED_MANIFEST;
    }

    return isInspectionFormDocument(json) ? 'inspectionForm' : 'configuration';
}

/**
 * Whether a parsed JSON document is a deployment manifest.
 *
 * @param {*} json the parsed document
 * @returns {boolean}
 */
function isManifestDocument(json) {
    return !!json && typeof json === 'object' && Array.isArray(json.manifest);
}

/**
 * Whether a parsed JSON document is an inspection form.
 *
 * @param {*} json the parsed document
 * @returns {boolean}
 */
function isInspectionFormDocument(json) {
    return !!json && typeof json === 'object' && typeof json.inspformnum !== 'undefined';
}

/**
 * Expands a nested manifest in place, so that the plan is a flat, ordered list regardless of how the
 * author chose to split it across files.
 */
function _planNestedManifest(resolvedPath, index, manifestPath, context, ancestors) {
    if (ancestors.includes(resolvedPath)) {
        _fail(context, 'manifestCycle', manifestPath, index, `${resolvedPath} includes itself, directly or indirectly.`);
        return;
    }

    if (ancestors.length >= MAX_MANIFEST_DEPTH) {
        _fail(
            context,
            'manifestTooDeep',
            manifestPath,
            index,
            `Manifests may not be nested more than ${MAX_MANIFEST_DEPTH} deep; ${resolvedPath} exceeds that.`
        );
        return;
    }

    _planFile(resolvedPath, context, ancestors);
}

function _planDatabaseConfiguration(entry, index, manifestPath, context) {
    if (Object.prototype.hasOwnProperty.call(entry, 'path')) {
        _fail(context, 'unexpectedPath', manifestPath, index, 'A "databaseConfiguration" entry cannot declare a "path".');
        return;
    }

    const unexpected = Object.keys(entry).filter((property) => property !== 'kind' && property !== 'disabled');
    if (unexpected.length > 0) {
        _fail(
            context,
            'unexpectedProperty',
            manifestPath,
            index,
            `A "databaseConfiguration" entry takes no other properties: ${unexpected.join(', ')}.`
        );
        return;
    }

    context.steps.push({ kind: DATABASE_CONFIGURATION, path: null, sidecars: false, manifestPath });
}

/*
 * Whether the entry is not disabled, and so should go on to be planned. A disabled entry is recorded
 * and skipped without any further validation, which is what makes it useful for taking a broken
 * entry out of the way. An entry whose "disabled" is not a boolean is rejected, and so also stops
 * here.
 */
function _planNotDisabled(entry, index, manifestPath, context) {
    if (entry === null || typeof entry !== 'object' || !Object.prototype.hasOwnProperty.call(entry, 'disabled')) {
        return true;
    }

    if (typeof entry.disabled !== 'boolean') {
        _fail(context, 'invalidEntry', manifestPath, index, 'A "disabled" property must be true or false.');
        return false;
    }

    if (entry.disabled) {
        context.disabled.push({ manifestPath, index });
        return false;
    }

    return true;
}

/** @returns {string|null} the path an entry declares, or null when it declares none. */
function _declaredPath(entry) {
    if (typeof entry === 'string') {
        return entry;
    }

    if (entry !== null && typeof entry === 'object' && typeof entry.path === 'string') {
        return entry.path;
    }

    return null;
}

function _fail(context, code, manifestPath, index, message) {
    context.errors.push({ code, manifestPath, index, message });
}

/**
 * Every kind a manifest entry may declare.
 *
 * @returns {string[]}
 */
function supportedKinds() {
    return Object.keys(KIND_EXTENSIONS).concat([DATABASE_CONFIGURATION]);
}

/**
 * The file extensions each kind that takes a file accepts.
 *
 * @returns {Object<string, string[]>}
 */
function extensionsForKinds() {
    const extensions = {};
    for (const kind of Object.keys(KIND_EXTENSIONS)) {
        extensions[kind] = KIND_EXTENSIONS[kind].slice();
    }
    return extensions;
}

module.exports = { planManifest, isManifestDocument, isInspectionFormDocument, supportedKinds, extensionsForKinds };
