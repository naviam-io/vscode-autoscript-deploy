#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveResourcesDir } from './resources-dir.js';
import { main } from './lib/main.js';

// Read at run time: the webpack build is configured not to replace import.meta.url.
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

// package.json sits beside the source entry, and one level above the bundle in dist/.
function readVersion() {
    for (const candidate of [path.join(moduleDir, 'package.json'), path.join(moduleDir, '..', 'package.json')]) {
        if (fs.existsSync(candidate)) {
            return JSON.parse(fs.readFileSync(candidate, 'utf8')).version;
        }
    }
    return 'unknown';
}

process.exit(await main(process.argv.slice(2), { resourcesDir: resolveResourcesDir(moduleDir), version: readVersion() }));
