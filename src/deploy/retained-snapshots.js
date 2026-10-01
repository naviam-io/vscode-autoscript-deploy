/*
 * Helpers for the retained values snapshot pre-flight, kept free of vscode so they can be tested.
 * See docs/modules/nashorn-library.md for what a snapshot is and why it is offered rather than
 * applied.
 */

const RECORD_LABELS = {
    cronTasks: 'cron task',
    domains: 'domain'
};

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const AGE_UNITS = [
    { unit: 'day', size: DAY },
    { unit: 'hour', size: HOUR },
    { unit: 'minute', size: MINUTE },
    { unit: 'second', size: SECOND }
];

// Fixed locale: the prompt this phrase is spliced into is English.
const RELATIVE_TIME = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/**
 * Whether a payload might have left a snapshot behind, which is the gate that keeps an ordinary
 * deployment free of the pre-flight round trip.
 *
 * Deliberately a coarse text match rather than a copy of the server's rules: the server decides
 * what a marker means, and the worst a false positive costs is one request that finds nothing.
 *
 * @param {string|Buffer|object} config the deployment payload
 * @returns {boolean} whether the payload mentions retention anywhere
 */
function declaresRetainMarkers(config) {
    if (config === null || typeof config === 'undefined') {
        return false;
    }

    const text = typeof config === 'string' || Buffer.isBuffer(config) ? config.toString() : JSON.stringify(config);
    return /"_retain"/.test(text);
}

/**
 * How the record a snapshot belongs to is named in the prompt.
 *
 * @param {{type?: string, object?: string, identity?: string}} snapshot a snapshot reported by the server
 * @returns {string} the record, for example "cron task SFG20SYNC"
 */
function describeSnapshotRecord(snapshot) {
    const label = (snapshot && RECORD_LABELS[snapshot.type]) || (snapshot && snapshot.object) || 'record';
    const identity = snapshot && snapshot.identity ? String(snapshot.identity) : 'unknown';
    return `${label} ${identity}`;
}

/**
 * How old a snapshot is. Age is what the prompt turns on: an hour old snapshot is almost certainly
 * the retry it was designed for, and a six month old one almost certainly is not.
 *
 * @param {number|null|undefined} capturedOn when the snapshot was written, in epoch milliseconds
 * @param {number} [now] the current time, in epoch milliseconds
 * @returns {string} the age, phrased for a sentence
 */
function formatSnapshotAge(capturedOn, now) {
    if (typeof capturedOn !== 'number' || !isFinite(capturedOn)) {
        return 'at an unknown time';
    }

    // Clamped, because a server clock running ahead must not report a snapshot from the future.
    const elapsed = Math.max(0, (typeof now === 'number' ? now : Date.now()) - capturedOn);
    const scale = AGE_UNITS.find((candidate) => elapsed >= candidate.size) || AGE_UNITS[AGE_UNITS.length - 1];

    return RELATIVE_TIME.format(-Math.floor(elapsed / scale.size), scale.unit);
}

module.exports = { declaresRetainMarkers, describeSnapshotRecord, formatSnapshotAge };
