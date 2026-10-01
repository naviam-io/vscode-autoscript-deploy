/*
 * Resolves the companion files of an automation script.
 *
 * A script may be accompanied by a deploy script (<name>-deploy.<ext> or <name>.deploy.<ext>) and by
 * configuration documents (<name>.predeploy.json and <name>.json). They are always named after the
 * script's source and live beside it, whatever the language.
 *
 * TypeScript is why the source path has to be passed in separately: what is deployed to Maximo is
 * the webpack bundle under the project's output directory, and webpack is under no obligation to
 * copy the companions there.
 */
const path = require('path');

const NO_COMPANIONS = {
    deployFileName: null,
    deployDotFileName: null,
    deployJSONFileName: null,
    preDeployJSONFileName: null
};

/**
 * Works out the companion files of a script.
 *
 * @param {string} filePath the path of the script being deployed; for TypeScript, the built bundle
 * @param {{ sidecars?: boolean, companionPath?: string }} [options] set sidecars to false to deploy
 *     the source on its own, and companionPath to the original source file when filePath is a
 *     build output
 * @returns {{ deployFileName: string|null, deployDotFileName: string|null, deployJSONFileName: string|null, preDeployJSONFileName: string|null }}
 */
function resolveScriptCompanions(filePath, options) {
    if (options && options.sidecars === false) {
        return Object.assign({}, NO_COMPANIONS);
    }

    const sourcePath = options && options.companionPath ? options.companionPath : filePath;
    const extension = path.extname(sourcePath);
    const base = sourcePath.substring(0, sourcePath.length - extension.length);

    return {
        deployFileName: base + '-deploy' + extension,
        deployDotFileName: base + '.deploy' + extension,
        deployJSONFileName: base + '.json',
        preDeployJSONFileName: base + '.predeploy.json'
    };
}

module.exports = { resolveScriptCompanions };
