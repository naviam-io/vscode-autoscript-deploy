/**
 * The core logger for a terminal: warnings always reach stderr, everything else only with --verbose.
 * @param {{ verbose?: boolean, stderr?: { write: Function } }} options
 */
export function createTerminalLogger({ verbose, stderr = process.stderr }) {
    const write = (level, message, source, error) => {
        stderr.write(`[${level}]${source ? ` [${source}]` : ''} ${message}\n`);
        if (error) {
            stderr.write(`${error.stack || error.message || error}\n`);
        }
    };
    const verboseOnly = (level) => (verbose ? (message, source) => write(level, message, source) : () => {});

    return {
        trace: verboseOnly('trace'),
        debug: verboseOnly('debug'),
        info: verboseOnly('info'),
        warn: (message, source) => (verbose ? write('warn', message, source) : stderr.write(`Warning: ${message}\n`)),
        error: verbose ? (message, error, source) => write('error', message, source, error) : () => {}
    };
}
