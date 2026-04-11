const path = require('path');
const webpack = require('webpack');
const TerserPlugin = require('terser-webpack-plugin');
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin');

// Custom plugin to replace 'self' with 'this' for Nashorn compatibility
class ReplaceGlobalSelfPlugin {
    apply(compiler) {
        // 1. Tap into 'thisCompilation' instead of 'emit'
        compiler.hooks.thisCompilation.tap('ReplaceGlobalSelfPlugin', (compilation) => {
            // 2. Use 'processAssets' to modify assets at the correct stage
            compilation.hooks.processAssets.tap(
                {
                    name: 'ReplaceGlobalSelfPlugin',
                    // Stage: OPTIMIZE_INLINE is meant for simple text replacements in existing assets
                    stage: webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE
                },
                (assets) => {
                    Object.keys(assets).forEach((filename) => {
                        if (filename.endsWith('.js')) {
                            // 3. Get the original source
                            const asset = compilation.getAsset(filename);
                            let source = asset.source.source();

                            // Ensure source is a string before replacing
                            if (typeof source !== 'string') {
                                source = source.toString();
                            }

                            // Replace standalone 'self' references
                            const newContent = source.replace(/\bself\b/g, 'this');

                            // 4. Use 'updateAsset' and 'RawSource' (modern Webpack 5 approach)
                            compilation.updateAsset(filename, new webpack.sources.RawSource(newContent));
                        }
                    });
                }
            );
        });
    }
}

module.exports = (env, argv) => {
    const mode = argv.mode || 'production';
    const isProduction = mode === 'production';
    return {
        mode,
        // Disable eval-based source maps. Webpack's default dev devtool wraps modules in eval()
        // with "use strict", which causes Nashorn to reject function declarations inside eval.
        devtool: false,
        entry: './src/index.ts',
        target: ['web', 'es5'],
        performance: {
            hints: false
        },
        output: {
            path: path.resolve(__dirname, './dist'),
            filename: '{script_name}.js',
            library: {
                name: '${library_name}',
                type: 'assign',
                export: 'default'
            },
            globalObject: 'this',
            // Force Webpack to not use arrow functions or async functions in its glue code
            // Also force Webpack to not use const or other modern syntax in its runtime code to maintain ES5 compatibility
            environment: {
                arrowFunction: false,
                asyncFunction: false,
                bigIntLiteral: false,
                const: false,
                destructuring: false,
                dynamicImport: false,
                forOf: false,
                module: false
            },
            iife: false,
            scriptType: false
        },
        optimization: {
            // Set this to false to disable minification during the build and make debugging easier
            minimize: isProduction,
            minimizer: [terserMinimizer]
        },
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    use: 'ts-loader',
                    exclude: /node_modules/
                },
                {
                    test: /\.js$/,
                    // This was commented out to allow all node_modules to be transpiled for better compatibility
                    // this may increase build time but the tradeoff is worth it for compatibility and consistency.
                    // exclude: /node_modules\/(?!([package_name_here])\/).*/,
                    use: {
                        loader: 'babel-loader',
                        options: {
                            presets: [
                                [
                                    '@babel/preset-env',
                                    {
                                        targets: {
                                            ie: '11'
                                        },
                                        modules: false,
                                        useBuiltIns: false,
                                        debug: false
                                    }
                                ]
                            ],
                            plugins: []
                        }
                    }
                }
            ]
        },
        resolve: {
            extensions: ['.ts', '.js'],
            fallback: {
                path: require.resolve('path-browserify'),
                stream: require.resolve('stream-browserify'),
                crypto: require.resolve('crypto-browserify'),
                buffer: require.resolve('buffer/'),
                fs: false,
                net: false,
                tls: false
            }
        },
        plugins: [
            new NodePolyfillPlugin(),
            new ReplaceGlobalSelfPlugin(),
            new webpack.ProvidePlugin({
                // Old: process: 'process/browser',
                // New: Explicitly add the .js extension
                process: 'process/browser.js'
            }),
            new webpack.ProvidePlugin({
                process: 'process/browser',
                Buffer: ['buffer', 'Buffer']
            }),
            new webpack.BannerPlugin({
                banner: `
var global = this;
var window = this; 
      `,
                raw: true,
                entryOnly: false
            })
        ]
    };
};

const terserMinimizer = new TerserPlugin({
    terserOptions: {
        ecma: 5,
        compress: {
            ecma: 5,
            // Prevent treating implicit globals as undefined
            typeofs: false,
            // Don't evaluate typeof expressions - keeps typeof service === 'undefined' as-is
            // and prevents replacing service with undefined
            reduce_vars: false,
            // Don't track variable assignments to prevent optimization of implicit globals
            toplevel: false,
            // Keep unused declarations like scriptConfig in the emitted bundle
            unused: false,
            // Avoid dropping declarations whose initializers look side-effect free
            dead_code: false,
            side_effects: false
            // Don't optimize top-level scope where implicit globals are used
        },
        output: {
            ecma: 5,
            comments: false
        },
        mangle: {
            // Tell the minifier NEVER to rename these variables as they are implicit Maximo variables and must be preserved.
            reserved: [
                'generateQRCode',
                'action',
                'app',
                'domainid',
                'errorgroup',
                'errorkey',
                'evalresult',
                'interactive',
                'launchPoint',
                'listErrorGroup',
                'listErrorKey',
                'listOrder',
                'listWhere',
                'mbo',
                'mboname',
                'mboset',
                'mbovalue',
                'onadd',
                'ondelete',
                'onupdate',
                'params',
                'relationObject',
                'relationWhere',
                'requestBody',
                'responseBody',
                'scriptConfig',
                'scriptHome',
                'scriptName',
                'service',
                'srcKeys',
                'targetKeys',
                'thisvalue',
                'user',
                'userInfo',
                'wfinstance'
            ],
            keep_fnames: true,
            toplevel: false
            // Don't mangle top-level variables
        }
    }
});
