/*
 * Helpers for compiling TypeScript automation scripts with the webpack project that contains them.
 *
 * This module deliberately has no dependency on the "vscode" module so that it can be exercised by
 * the unit tests in test/unit. The extension injects its logger through setLogger().
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const LOG_SOURCE = 'WebpackProject';
const NO_OP_LOGGER = { debug() {} };

// Matches what an unconfigured webpack build did before the mode became a setting, and keeps a
// deployed script readable for troubleshooting.
const DEFAULT_WEBPACK_MODE = 'development';

let logger = NO_OP_LOGGER;

/**
 * Injects the logger used for diagnostic output.
 * @param {{ debug: Function }} value
 */
function setLogger(value) {
    logger = value || NO_OP_LOGGER;
}

/** @param {string} message */
function debug(message) {
    logger.debug(message, LOG_SOURCE);
}

/**
 * Compiles the webpack project that contains the supplied source file, and resolves the bundle
 * webpack built from it.
 * @param {string} sourceFilePath
 * @param {string} workspaceRoot
 * @param {(message: string) => void} [onProgress]
 * @param {string} [mode] the webpack mode to build in. Defaults to development.
 * @returns {Promise<{ outputFilePath: string, projectRoot: string } | undefined>}
 */
async function prepareWebpackBuild(sourceFilePath, workspaceRoot, onProgress, mode) {
    const report = typeof onProgress === 'function' ? onProgress : () => {};
    const project = findNearestWebpackProject(path.dirname(sourceFilePath), workspaceRoot);

    if (!project) {
        return undefined;
    }

    debug(`Preparing webpack compile in ${project.projectRoot} using ${project.webpackConfigPath}.`);

    // The dependencies must be installed first: a webpack.config.js normally requires webpack and
    // its plugins at the top level, so building before the install fails with a module not found
    // error. See work item 146773.
    report('Installing project dependencies\u2026');

    /** @type {Error | undefined} */
    let initializationError;
    try {
        await ensureWebpackInitialized(project.projectRoot);
    } catch (error) {
        // Not fatal on its own: the project may rely on a globally installed webpack.
        initializationError = error;
        debug(`Local webpack initialization did not complete: ${describeError(error)}`);
    }

    report('Running webpack\u2026');

    /** @type {Record<string, any>} */
    let stats;
    try {
        stats = await runWebpack(project.projectRoot, sourceFilePath, mode || DEFAULT_WEBPACK_MODE);
    } catch (error) {
        throw withInitializationContext(error, initializationError);
    }

    const outputFilePath = selectOutputFile(stats, sourceFilePath);

    debug(`Webpack reported ${sourceFilePath} as ${outputFilePath}.`);

    if (!fs.existsSync(outputFilePath)) {
        throw new Error(`Webpack reported ${outputFilePath} as the output for ${sourceFilePath}, but that file was not produced.`);
    }

    return { outputFilePath, projectRoot: project.projectRoot };
}

/**
 * Picks the single bundle to deploy, refusing to choose when webpack did not build exactly one.
 * @param {Record<string, any>} stats
 * @param {string} sourceFilePath
 * @returns {string}
 */
function selectOutputFile(stats, sourceFilePath) {
    const outputFiles = resolveOutputFilesFromStats(stats, sourceFilePath);

    if (outputFiles.length === 1) {
        return outputFiles[0];
    }

    if (outputFiles.length === 0) {
        throw new Error(
            `${sourceFilePath} is not a webpack entry, so the build produced no script for it. Deploy the TypeScript file that declares the scriptConfig block instead, or add this file to the entries in webpack.config.js.`
        );
    }

    // Deploying an arbitrary one of them would put the wrong script into Maximo.
    throw new Error(`${sourceFilePath} is an entry of several bundles (${outputFiles.map((file) => path.basename(file)).join(', ')}), so the script to deploy is ambiguous.`);
}

/**
 * Adds the reason the dependencies could not be installed to a failure that is likely caused by it.
 * @param {Error} error
 * @param {Error | undefined} initializationError
 * @returns {Error}
 */
function withInitializationContext(error, initializationError) {
    if (!initializationError) {
        return error;
    }

    return new Error(`${error.message} The project dependencies could not be initialized: ${initializationError.message}`);
}

/** @param {unknown} error */
function describeError(error) {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Runs a command and resolves with its exit code and combined output.
 * @param {string} command
 * @param {string} cwd
 * @returns {Promise<{ code: number | null, output: string }>}
 */
function execCommand(command, cwd) {
    return new Promise((resolve, reject) => {
        let output = '';
        const child = cp.exec(command, { cwd });

        child.stdout?.on('data', (data) => (output += data));
        child.stderr?.on('data', (data) => (output += data));
        child.on('close', (code) => resolve({ code, output }));
        child.on('error', reject);
    });
}

/** @param {string} rootPath */
function localBinDirectory(rootPath) {
    return path.join(rootPath, 'node_modules', '.bin');
}

/**
 * @param {string} rootPath
 * @returns {string | undefined} the local webpack executable, when one is installed.
 */
function findLocalWebpack(rootPath) {
    const binDirectory = localBinDirectory(rootPath);
    return [path.join(binDirectory, 'webpack.cmd'), path.join(binDirectory, 'webpack')].find((bin) => fs.existsSync(bin));
}

/**
 * Runs webpack and returns the statistics it reported for the build.
 * @param {string} rootPath
 * @param {string} sourceFilePath the script being deployed, offered to the configuration.
 * @param {string} mode
 * @returns {Promise<Record<string, any>>}
 */
async function runWebpack(rootPath, sourceFilePath, mode) {
    const webpackBin = findLocalWebpack(rootPath);

    if (webpackBin) {
        debug(`Invoking webpack binary at ${webpackBin}.`);
    } else {
        debug(`Local webpack executable was not found in ${localBinDirectory(rootPath)}. Falling back to global webpack command.`);
    }

    const command = webpackBin ? `"${webpackBin}"` : 'webpack';
    const statsFilePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mdt-webpack-')), 'stats.json');

    try {
        // --stats normal is required rather than merely useful: a configuration declaring a quieter
        // preset, such as the common "errors-only", omits the modules, chunks and output path that
        // the deployed file is resolved from. The command line value overrides the configuration.
        // The source file is offered as an env value so a configuration may build just that entry.
        const { code, output } = await execCommand(
            `${command} --mode ${mode} --env mdtSourceFile="${sourceFilePath}" --json="${statsFilePath}" --stats normal`,
            rootPath
        );

        if (code !== 0) {
            debug(`Webpack process failed with exit code ${code}.`);

            if (!webpackBin) {
                throw new Error(`Local webpack executable was not found in ${localBinDirectory(rootPath)}, and global webpack could not be executed. ${output}`);
            }

            throw new Error(`Webpack failed: ${describeBuildFailure(output)}`);
        }

        debug('Webpack process completed successfully.');
        return readStatsFile(statsFilePath);
    } finally {
        fs.rmSync(path.dirname(statsFilePath), { recursive: true, force: true });
    }
}

/**
 * @param {string} statsFilePath
 * @returns {Record<string, any>}
 */
function readStatsFile(statsFilePath) {
    if (!fs.existsSync(statsFilePath)) {
        throw new Error(`Webpack completed but did not write the build statistics to ${statsFilePath}. A webpack 5 command line is required to deploy a TypeScript script.`);
    }

    try {
        return JSON.parse(fs.readFileSync(statsFilePath, 'utf8'));
    } catch (error) {
        throw new Error(`Unable to read the webpack build statistics: ${describeError(error)}`);
    }
}

/**
 * Leads with the TypeScript error when webpack reported one, as it is the actionable part of a
 * build log that is otherwise dominated by webpack's own output.
 * @param {string} output
 */
function describeBuildFailure(output) {
    const index = output.indexOf('[tsl] ERROR');
    return index >= 0 ? output.substring(index + '[tsl] '.length) : output;
}

/**
 * Ensures the project dependencies, including webpack, are installed before compile.
 * @param {string} rootPath
 * @returns {Promise<void>}
 */
async function ensureWebpackInitialized(rootPath) {
    if (findLocalWebpack(rootPath)) {
        debug('Local webpack binary is already available.');
        return;
    }

    debug('Local webpack binary not found. Checking package.json and installing dependencies.');

    const packageJsonPath = path.join(rootPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
        throw new Error(`package.json was not found in ${rootPath}. Unable to initialize local webpack dependencies.`);
    }

    /** @type {any} */
    let packageJson;
    try {
        packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    } catch {
        throw new Error(`Unable to parse ${packageJsonPath}.`);
    }

    if (!packageJson?.dependencies?.webpack && !packageJson?.devDependencies?.webpack && !packageJson?.scripts?.webpack) {
        throw new Error(`Webpack is not defined in package.json dependencies, devDependencies, or scripts of ${rootPath}.`);
    }

    const installCommand = fs.existsSync(path.join(rootPath, 'package-lock.json')) ? 'npm ci' : 'npm install';
    debug(`Installing npm dependencies using "${installCommand}" to initialize webpack.`);

    const { code, output } = await execCommand(installCommand, rootPath);

    if (code !== 0) {
        debug(`Dependency installation failed with exit code ${code}.`);
        throw new Error(`"${installCommand}" failed in ${rootPath}: ${output}`);
    }

    if (!findLocalWebpack(rootPath)) {
        throw new Error(`"${installCommand}" completed but the local webpack binary was not found in ${localBinDirectory(rootPath)}.`);
    }

    debug('Dependency installation completed and local webpack was found.');
}

/**
 * @param {string} startDir
 * @param {string} workspaceRoot
 * @returns {{ projectRoot: string, webpackConfigPath: string } | undefined}
 */
function findNearestWebpackProject(startDir, workspaceRoot) {
    const boundaryDir = path.resolve(workspaceRoot);
    let currentDir = path.resolve(startDir);

    while (currentDir.startsWith(boundaryDir)) {
        const webpackConfigPath = path.join(currentDir, 'webpack.config.js');
        if (fs.existsSync(webpackConfigPath)) {
            return { projectRoot: currentDir, webpackConfigPath };
        }

        const parentDir = path.dirname(currentDir);
        if (currentDir === boundaryDir || parentDir === currentDir) {
            return undefined;
        }
        currentDir = parentDir;
    }

    return undefined;
}


/**
 * Resolves the bundles that a source file was compiled into, using the statistics webpack itself
 * emitted for the build. Nothing here predicts an output path: webpack reports which modules went
 * into which chunks, and which assets each entrypoint produced.
 *
 * Only a webpack entry resolves. A file that an entry merely imports is part of a bundle without
 * being one, so deploying it would send the whole bundle to Maximo under the wrong script.
 *
 * @param {Record<string, any> | undefined} stats parsed "webpack --json --stats normal" output.
 * @param {string} sourceFilePath
 * @returns {string[]} the absolute JavaScript bundles built from the source file, without duplicates.
 */
function resolveOutputFilesFromStats(stats, sourceFilePath) {
    const targetPath = normalizeFilePath(sourceFilePath);
    /** @type {Set<string>} */
    const outputFiles = new Set();

    for (const compilation of getCompilations(stats)) {
        const chunkIds = collectEntryChunkIds(compilation.modules, targetPath);
        if (chunkIds.size === 0) {
            continue;
        }

        for (const entrypoint of Object.values(compilation.entrypoints ?? {})) {
            if (!toArray(entrypoint?.chunks).some((chunkId) => chunkIds.has(chunkId))) {
                continue;
            }

            for (const asset of toArray(entrypoint?.assets)) {
                // Entrypoint assets also cover source maps and the Terser LICENSE file.
                const assetName = typeof asset === 'string' ? asset : asset?.name;
                if (typeof assetName === 'string' && assetName.endsWith('.js')) {
                    outputFiles.add(path.join(compilation.outputPath ?? '', assetName));
                }
            }
        }
    }

    return [...outputFiles];
}

/**
 * A configuration exporting an array compiles each element separately, and webpack reports one
 * child per element instead of a single top level compilation.
 * @param {Record<string, any> | undefined} stats
 * @returns {Record<string, any>[]}
 */
function getCompilations(stats) {
    if (!stats) {
        return [];
    }

    const children = toArray(stats.children);
    return children.length > 0 ? children : [stats];
}

/**
 * Collects the chunks that were built from a source file named by an entry.
 *
 * Webpack reports depth 0 for the files an entry names directly and a greater depth for everything
 * reached through an import, in both development and production. Entry modules are always reported
 * at the top level with their chunk ids, even in production, where the modules they concatenate are
 * nested and carry no chunk ids of their own.
 *
 * @param {unknown} modules
 * @param {string} targetPath
 * @returns {Set<unknown>}
 */
function collectEntryChunkIds(modules, targetPath) {
    /** @type {Set<unknown>} */
    const chunkIds = new Set();

    for (const module of toArray(modules)) {
        if (module?.depth !== 0 || typeof module?.nameForCondition !== 'string') {
            continue;
        }

        if (normalizeFilePath(module.nameForCondition) === targetPath) {
            toArray(module.chunks).forEach((chunkId) => chunkIds.add(chunkId));
        }
    }

    return chunkIds;
}

/**
 * Normalizes a path so that the source file VS Code reports and the one webpack reports compare
 * equal even when they were reached through a symbolic link, as they are under /tmp on macOS.
 * @param {string} filePath
 * @returns {string}
 */
function normalizeFilePath(filePath) {
    const resolved = path.resolve(filePath);

    try {
        return fs.realpathSync(resolved);
    } catch {
        // The file need not exist: a stats file can outlive the sources it was built from.
        return resolved;
    }
}

/**
 * @param {unknown} value
 * @returns {any[]}
 */
function toArray(value) {
    return Array.isArray(value) ? value : [];
}

module.exports = {
    setLogger,
    prepareWebpackBuild,
    findNearestWebpackProject,
    resolveOutputFilesFromStats
};
