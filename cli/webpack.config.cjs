// Bundles the CLI into one ESM file, cli/dist/index.js, with the server scripts copied to
// cli/dist/resources, so the published package needs neither the repository's resources/ nor node_modules.
const fs = require('fs');
const path = require('path');
const webpack = require('webpack');

const RESOURCES = path.resolve(__dirname, '..', 'resources');
const OUTPUT = path.resolve(__dirname, 'dist');
const GENERATED_LIBRARY = 'naviam.autoscript.library.js';

class CopyResourcesPlugin {
    apply(compiler) {
        compiler.hooks.afterEmit.tap('CopyResourcesPlugin', () => {
            if (!fs.existsSync(path.join(RESOURCES, GENERATED_LIBRARY))) {
                throw new Error(`resources/${GENERATED_LIBRARY} is missing. Run "npm run package:library" first.`);
            }

            const target = path.join(OUTPUT, 'resources');
            fs.mkdirSync(target, { recursive: true });

            fs.readdirSync(RESOURCES)
                .filter((file) => /^naviam\.autoscript\..+\.js$/.test(file))
                .forEach((file) => fs.copyFileSync(path.join(RESOURCES, file), path.join(target, file)));
        });
    }
}

module.exports = {
    mode: 'production',
    target: 'node20',
    entry: path.resolve(__dirname, 'index.js'),
    output: {
        path: OUTPUT,
        filename: 'index.js',
        module: true,
        chunkFormat: 'module',
        clean: true
    },
    experiments: {
        outputModule: true
    },
    resolve: {
        alias: {
            // Optional dependency of debug (via axios); without it debug just logs without colours.
            'supports-color': false
        }
    },
    module: {
        parser: {
            javascript: {
                // Otherwise import.meta.url is replaced with the build machine's source path.
                importMeta: false
            }
        }
    },
    // Readable stack traces for users reporting problems.
    optimization: {
        minimize: false
    },
    plugins: [new webpack.BannerPlugin({ banner: '#!/usr/bin/env node', raw: true }), new CopyResourcesPlugin()]
};
