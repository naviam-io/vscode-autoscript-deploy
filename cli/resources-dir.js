import fs from 'fs';
import path from 'path';

// A file every resources folder contains, so an empty or partial folder is not mistaken for one.
const MARKER = 'naviam.autoscript.install.js';

/**
 * Finds the server-side scripts the CLI installs into Maximo.
 *
 * Published, they sit beside the bundle in dist/resources. Run from source, they are the
 * repository's resources/ folder, one level above cli/.
 *
 * @param {string} moduleDir the directory of the running entry point
 * @returns {string} the resources directory
 */
export function resolveResourcesDir(moduleDir) {
    const besideModule = path.join(moduleDir, 'resources');

    if (fs.existsSync(path.join(besideModule, MARKER))) {
        return besideModule;
    }

    return path.resolve(moduleDir, '..', 'resources');
}
