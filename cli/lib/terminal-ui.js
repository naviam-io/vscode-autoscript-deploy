/*
 * The core Ui port for a terminal: progress and information go to stdout, errors to stderr, and every
 * decision is answered from a command line option. See docs/modules/cli.md.
 */
import { Decision } from '../../src/core/ui.js';

const CODICON = /\$\([a-z0-9~-]+\)\s*/gi;
const WARNING_PREFIX = '\u26a0\ufe0f';

/**
 * The answer to each decision, from the configuration, and the option that gives it.
 *
 * @returns {Record<string, { answer?: string, option?: string }>}
 */
export function decisionAnswers(config) {
    const retained = { restore: 'Restore', discard: 'Discard' }[config.retainedSnapshots];
    return {
        [Decision.ADMIN_MODE]: { answer: config.allowAdminMode ? 'Yes' : undefined, option: '--allowAdminMode' },
        [Decision.DISABLE_ESIG]: { answer: config.allowEsigDisable ? 'Yes' : undefined, option: '--allowEsigDisable' },
        [Decision.RETAINED_SNAPSHOT]: { answer: retained, option: '--retainedSnapshots restore|discard' },
        [Decision.OVERWRITE]: config.overwrite === false ? { answer: 'Skip', option: '--overwrite false' } : { answer: 'Replace All', option: '--overwrite' },
        [Decision.SNAPSHOT_LOOKUP_FAILED]: {}
    };
}

function clean(message) {
    return String(message).replace(CODICON, '').trim();
}

/**
 * @param {{ answers: Record<string, { answer?: string, option?: string }>, stdout?: { write: Function }, stderr?: { write: Function } }} options
 * @returns {{ ui: import('../../src/core/ui.js').Ui, errorCount: () => number }}
 */
export function createTerminalUi({ answers, stdout = process.stdout, stderr = process.stderr }) {
    let errors = 0;
    let lastMessage;

    const out = (text) => stdout.write(text + '\n');
    const err = (text) => stderr.write(text + '\n');

    const print = (message) => {
        const text = clean(message);
        // Warnings reach the terminal through the logger.
        if (!text || text === lastMessage || text.startsWith(WARNING_PREFIX)) {
            return;
        }
        lastMessage = text;
        out(text);
    };

    const ui = {
        async withProgress(options, task) {
            const progress = {
                report: (update) => {
                    if (update && update.message) {
                        print(update.message);
                    }
                }
            };
            const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
            return await task(progress, token);
        },

        async error(message, options) {
            errors++;
            lastMessage = undefined;
            err(`Error: ${clean(message)}`);
            if (options && options.detail) {
                err(clean(options.detail));
            }
        },

        async info(message) {
            lastMessage = undefined;
            out(clean(message));
        },

        async choose(decision, message, options) {
            const { answer, option } = answers[decision] || {};
            lastMessage = undefined;
            out(clean(message));
            if (options && options.detail) {
                out(clean(options.detail));
            }

            if (answer && options.actions.includes(answer)) {
                out(`Answered ${answer} by ${option}.`);
                return answer;
            }

            // An unanswered decision stops what asked it, so the run fails.
            errors++;
            err(option ? `No answer was given: pass ${option} to answer it.` : 'This cannot be answered from the command line, so the operation stops.');
            return undefined;
        },

        async pause() {}
    };

    return { ui, errorCount: () => errors };
}
