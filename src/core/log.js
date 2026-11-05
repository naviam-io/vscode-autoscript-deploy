/**
 * The logger every core module writes to. The host injects its own with setLogger; until then
 * output is discarded. See docs/modules/core.md.
 *
 * @typedef {{ trace: Function, debug: Function, info: Function, warn: Function, error: Function }} LogSink
 * @type {LogSink}
 */
const NO_OP = { trace() {}, debug() {}, info() {}, warn() {}, error() {} };

let sink = NO_OP;

/**
 * @param {LogSink | null} logger
 */
export function setLogger(logger) {
    sink = logger || NO_OP;
}

const Logger = {
    trace: (message, source) => sink.trace(message, source),
    debug: (message, source) => sink.debug(message, source),
    info: (message, source) => sink.info(message, source),
    warn: (message, source) => sink.warn(message, source),
    error: (message, error, source) => sink.error(message, error, source)
};

export default Logger;
