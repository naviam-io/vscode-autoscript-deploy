/*
 * A Ui that records every call and answers decisions from a table, for core unit tests.
 */
function createRecordingUi({ answers = {} } = {}) {
    const calls = [];
    const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
    const progress = { report: (update) => calls.push({ method: 'report', ...update }) };

    const ui = {
        async withProgress({ title }, task) {
            calls.push({ method: 'withProgress', title });
            return await task(progress, token);
        },
        async error(message, { detail } = {}) {
            calls.push({ method: 'error', message, detail });
        },
        async info(message) {
            calls.push({ method: 'info', message });
        },
        async choose(decision, message, { actions }) {
            calls.push({ method: 'choose', decision, message, actions });
            const answer = answers[decision];
            return typeof answer === 'function' ? answer(message, actions) : answer;
        },
        async pause() {}
    };

    return { ui, calls, token };
}

export { createRecordingUi };
