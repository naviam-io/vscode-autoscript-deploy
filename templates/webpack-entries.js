/*
 * Entry discovery for Maximo automation scripts.
 *
 * A TypeScript file is a script when it declares a scriptConfig block, wherever it sits and
 * whatever it is called. The file name plays no part in the script's identity: the Maximo script
 * name is scriptConfig.autoscript, and the bundle is named after it so that the Maximo Development
 * Tools extension finds the sidecar files that belong to it.
 *
 * This file has no webpack dependency so that it stays straightforward to read and to test.
 */
const fs = require('fs');
const path = require('path');

// Imported by every script, so it declares no scriptConfig and is never an entry of its own.
const RUNTIME_SHIM = 'runtime-globals.ts';

const IGNORED_DIRECTORIES = ['node_modules', 'dist', 'dist-dev', '.git'];

/**
 * The files the extension looks for beside a deployed bundle, keyed by the suffix they take after
 * the name they are derived from. See deploy-script-command.js in the extension.
 */
const SIDECAR_SUFFIXES = ['.predeploy.json', '.json', '-deploy.js', '.deploy.js'];

/**
 * Finds every deployable script under the given directory.
 *
 * @param {string} rootDir the directory holding webpack.config.js.
 * @param {{ dropParentDir?: boolean }} [options] dropParentDir removes the directory immediately
 *   containing a script from its output path, for projects giving each script its own folder.
 * @returns {{
 *   autoscript: string,
 *   libraryName: string,
 *   entryName: string,
 *   sourcePath: string,
 *   import: string[],
 *   filename: string,
 *   sidecars: { from: string, to: string }[]
 * }[]}
 */
function discoverScriptEntries(rootDir, options) {
    const dropParentDir = Boolean(options && options.dropParentDir);
    const hasRuntimeShim = fs.existsSync(path.join(rootDir, RUNTIME_SHIM));

    const entries = [];
    /** @type {Map<string, string>} */
    const claimedNames = new Map();

    for (const sourcePath of findTypeScriptFiles(rootDir)) {
        const source = fs.readFileSync(sourcePath, 'utf8');
        if (!declaresScriptConfig(source)) {
            continue;
        }

        const autoscript = readAutoscriptName(source);
        if (!autoscript) {
            throw new Error(
                `${path.relative(rootDir, sourcePath)} declares a scriptConfig block without an autoscript name. ` +
                    'The autoscript name is the name the script is deployed under, so it is required.'
            );
        }

        // Extracted scripts and generated ones are written under a lower cased file name, so the
        // bundle uses the same form to stay in step with them. Maximo treats script names as case
        // insensitive, so two names differing only in case are the same script.
        const baseName = autoscript.toLowerCase();

        const claimedBy = claimedNames.get(baseName);
        if (claimedBy) {
            throw new Error(`${path.relative(rootDir, sourcePath)} and ${claimedBy} both declare the autoscript name ${autoscript}.`);
        }
        claimedNames.set(baseName, path.relative(rootDir, sourcePath));

        const outputDir = resolveOutputDir(rootDir, sourcePath, dropParentDir);
        const relativeImport = toRequestPath(path.relative(rootDir, sourcePath));

        entries.push({
            autoscript,
            libraryName: toIdentifier(autoscript),
            entryName: toIdentifier(autoscript),
            sourcePath,
            import: hasRuntimeShim ? [`./${RUNTIME_SHIM}`, relativeImport] : [relativeImport],
            filename: joinOutput(outputDir, `${baseName}.js`),
            sidecars: findSidecars(sourcePath, baseName, outputDir)
        });
    }

    if (entries.length === 0) {
        throw new Error(`No deployable script was found under ${rootDir}. A script is a TypeScript file that declares a scriptConfig block.`);
    }

    return entries;
}

/**
 * @param {string} rootDir
 * @returns {string[]} every candidate TypeScript source file, in a stable order.
 */
function findTypeScriptFiles(rootDir) {
    const found = [];

    for (const entry of fs.readdirSync(rootDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const entryPath = path.join(rootDir, entry.name);

        if (entry.isDirectory()) {
            if (!IGNORED_DIRECTORIES.includes(entry.name) && !entry.name.startsWith('.')) {
                found.push(...findTypeScriptFiles(entryPath));
            }
            continue;
        }

        // Declaration files describe types and compile to nothing.
        if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') && entry.name !== RUNTIME_SHIM) {
            found.push(entryPath);
        }
    }

    return found;
}

/** @param {string} source */
function declaresScriptConfig(source) {
    return /\bscriptConfig\b/.test(source);
}

/**
 * Reads the name without executing the file, which is not possible before it is compiled.
 * @param {string} source
 * @returns {string | undefined}
 */
function readAutoscriptName(source) {
    const match = source.match(/['"]?autoscript['"]?\s*:\s*['"]([^'"]+)['"]/);
    return match ? match[1] : undefined;
}

/**
 * Mirrors the directory a script sits in, so that two scripts of the same name in different
 * folders cannot overwrite one another.
 * @param {string} rootDir
 * @param {string} sourcePath
 * @param {boolean} dropParentDir
 * @returns {string} a relative, possibly empty, output directory.
 */
function resolveOutputDir(rootDir, sourcePath, dropParentDir) {
    const segments = path.relative(rootDir, path.dirname(sourcePath)).split(path.sep).filter(Boolean);

    if (dropParentDir) {
        segments.pop();
    }

    return segments.join('/');
}

/**
 * Collects the files the extension expects beside the bundle, renaming them from the name they
 * carry next to the source to the name the bundle is deployed under.
 * @param {string} sourcePath
 * @param {string} baseName the lower cased autoscript name the bundle is written under
 * @param {string} outputDir
 * @returns {{ from: string, to: string }[]}
 */
function findSidecars(sourcePath, baseName, outputDir) {
    const sourceDir = path.dirname(sourcePath);
    const sourceName = path.basename(sourcePath, '.ts');
    const sidecars = [];

    for (const suffix of SIDECAR_SUFFIXES) {
        const from = path.join(sourceDir, `${sourceName}${suffix}`);
        if (fs.existsSync(from)) {
            sidecars.push({ from, to: joinOutput(outputDir, `${baseName}${suffix}`) });
        }
    }

    return sidecars;
}

/**
 * @param {string} outputDir
 * @param {string} fileName
 * @returns {string} webpack always expects forward slashes in an output file name.
 */
function joinOutput(outputDir, fileName) {
    return outputDir ? `${outputDir}/${fileName}` : fileName;
}

/** @param {string} relativePath */
function toRequestPath(relativePath) {
    return `./${relativePath.split(path.sep).join('/')}`;
}

/**
 * @param {string} autoscript
 * @returns {string} the name with everything a JavaScript identifier cannot hold replaced.
 */
function toIdentifier(autoscript) {
    return autoscript.replace(/[^A-Za-z0-9_$]/g, '_');
}

module.exports = { discoverScriptEntries, RUNTIME_SHIM };
