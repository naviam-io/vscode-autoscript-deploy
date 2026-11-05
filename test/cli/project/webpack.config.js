const path = require('path');

module.exports = {
    entry: { 'nvtest.cli.ts': './src/index.ts' },
    target: ['web', 'es5'],
    devtool: false,
    output: { path: path.resolve(__dirname, 'dist'), filename: '[name].js', iife: false }
};
