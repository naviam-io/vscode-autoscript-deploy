const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
    {
        // Generated, never hand-edited, never linted
        ignores: ['**/node_modules/', '**/dist/', '**/out/', 'resources/naviam.autoscript.library.js']
    },
    {
        // A Maximo script project the CLI tests copy, with deliberately broken files
        ignores: ['test/cli/project/']
    },
    js.configs.recommended,
    {
        linterOptions: {
            reportUnusedDisableDirectives: 'off'
        },
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.node,
                ...globals.es2022
            }
        },
        rules: {
            indent: ['error', 4],
            'linebreak-style': ['error', 'unix'],
            quotes: ['error', 'single', { avoidEscape: true }],
            semi: ['error', 'always'],
            // Nashorn is ES5, so a catch clause always needs a binding even when it is unused
            'no-unused-vars': ['error', { caughtErrors: 'none' }],
            // Added to the recommended set after eslint 8; existing code has not been brought in line
            'no-constant-binary-expression': 'off',
            'no-useless-assignment': 'off',
            'preserve-caught-error': 'off'
        }
    }
];
