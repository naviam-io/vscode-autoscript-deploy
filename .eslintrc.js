module.exports = {
    env: {
        browser: true,
        node: true,
        es2022: true,
    },
    extends: 'eslint:recommended',
    parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
    },
    rules: {
        indent: ['error', 4],
        'linebreak-style': ['error', 'unix'],
        quotes: ['error', 'single', { avoidEscape: true }],
        semi: ['error', 'always'],
    },
};
