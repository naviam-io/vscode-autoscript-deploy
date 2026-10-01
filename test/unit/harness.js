/*
 * Helpers for unit testing the Maximo side scripts.
 *
 * The scripts in resources/ run on Nashorn inside Maximo: they call load('nashorn:parser.js') and
 * Java.type() at the top level, so they cannot be required from Node. Instead, individual pure
 * functions are located with acorn, extracted from the shipped source and evaluated inside a
 * function wrapper, which exercises the real code without a Maximo server and without leaking
 * globals.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const acorn = require('acorn');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function walk(node, visit) {
    if (!node || typeof node !== 'object') {
        return;
    }

    if (typeof node.type === 'string') {
        visit(node);
    }

    Object.keys(node).forEach((key) => {
        const value = node[key];
        if (Array.isArray(value)) {
            value.forEach((child) => walk(child, visit));
        } else if (value && typeof value === 'object' && typeof value.type === 'string') {
            walk(value, visit);
        }
    });
}

function collectFunctionDeclarations(node, visit) {
    walk(node, (candidate) => {
        if (candidate.type === 'FunctionDeclaration' && candidate.id) {
            visit(candidate);
        }
    });
}

function extractFunctionSources(source, names) {
    const declarations = new Map();

    collectFunctionDeclarations(acorn.parse(source, { ecmaVersion: 5 }), (node) => {
        const body = source.slice(node.start, node.end);
        const existing = declarations.get(node.id.name);

        if (typeof existing === 'string' && existing !== body) {
            throw new Error('Function "' + node.id.name + '" is declared more than once with different bodies.');
        }

        declarations.set(node.id.name, body);
    });

    return names.map((name) => {
        if (!declarations.has(name)) {
            throw new Error('Function "' + name + '" was not found in the script.');
        }

        return declarations.get(name);
    });
}

/*
 * Collects assignments of the form `Name._something = <expression>` for the named functions.
 *
 * TypeScript emits a class static as an assignment that sits outside the constructor's function
 * declaration, so extracting the declaration alone loses it. Minification keeps the class's own
 * function name, and the emitted assignment refers to that name rather than to the module binding,
 * so the statics can be recovered from the bundle by name and replayed after the declarations.
 */
function extractStaticAssignments(source, names) {
    const wanted = new Set(names);
    const statics = [];

    walk(acorn.parse(source, { ecmaVersion: 5 }), (node) => {
        if (node.type !== 'AssignmentExpression' || node.operator !== '=') {
            return;
        }

        const target = node.left;
        if (
            target.type !== 'MemberExpression' ||
            target.computed ||
            target.object.type !== 'Identifier' ||
            !wanted.has(target.object.name) ||
            target.property.name.charAt(0) !== '_'
        ) {
            return;
        }

        statics.push(target.object.name + '.' + target.property.name + ' = ' + source.slice(node.right.start, node.right.end) + ';');
    });

    return statics;
}

/*
 * Loads the named functions from a Maximo side script and returns them as an object.
 *
 * The functions must be self contained: anything they reference that is provided by Nashorn or
 * Maximo has to be supplied through the stubs argument, whose keys become parameters of the
 * wrapper. The wrapper is evaluated in the current realm so the values the functions return are
 * ordinary host objects that assert.deepStrictEqual can compare.
 */
function loadScriptFunctions(relativeScriptPath, names, stubs) {
    const source = fs.readFileSync(path.join(REPO_ROOT, relativeScriptPath), 'utf8');
    const stubNames = Object.keys(stubs || {});
    const exported = names.map((name) => name + ': ' + name).join(', ');
    const bodies = extractFunctionSources(source, names).concat(extractStaticAssignments(source, names));

    const wrapper = '(function (' + stubNames.join(', ') + ') {\n' + bodies.join('\n\n') + '\n\nreturn { ' + exported + ' };\n})';

    return vm.runInThisContext(wrapper, { filename: relativeScriptPath })(...stubNames.map((name) => stubs[name]));
}

module.exports = { REPO_ROOT, collectFunctionDeclarations, extractFunctionSources, extractStaticAssignments, loadScriptFunctions };
