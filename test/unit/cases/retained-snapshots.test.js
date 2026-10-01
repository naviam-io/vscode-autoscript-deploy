/*
 * Unit tests for the retained values snapshot pre-flight helpers.
 *
 *   npm run test:unit
 *
 * See docs/modules/nashorn-library.md for what a snapshot is and when one is left behind.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');

const { declaresRetainMarkers, describeSnapshotRecord, formatSnapshotAge } = require('../../../src/deploy/retained-snapshots');

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-01-15T12:00:00Z');

describe('declaresRetainMarkers', () => {
    it('is false for a payload that declares no retention, which is what avoids the round trip', () => {
        const payload = { cronTasks: [{ cronTaskName: 'SFG20SYNC', cronTaskInstance: [{ instanceName: 'SFG20SYNC01' }] }] };
        assert.strictEqual(declaresRetainMarkers(payload), false);
    });

    it('finds a marker wherever it appears, including nested in a child collection', () => {
        assert.strictEqual(declaresRetainMarkers({ domains: [{ domainId: 'NAVIAMTEST', _retain: ['description'] }] }), true);
        assert.strictEqual(
            declaresRetainMarkers({
                cronTasks: [{ cronTaskName: 'SFG20SYNC', cronTaskInstance: [{ cronTaskParam: [{ parameter: 'BATCHSIZE', _retain: ['value'] }] }] }]
            }),
            true
        );
    });

    it('reads a payload that arrives as a string or a buffer, as the call sites supply', () => {
        const payload = JSON.stringify({ domains: [{ domainId: 'NAVIAMTEST', _retain: ['description'] }] });
        assert.strictEqual(declaresRetainMarkers(payload), true);
        assert.strictEqual(declaresRetainMarkers(Buffer.from(payload, 'utf8')), true);
    });

    it('is false when there is nothing to read, leaving the deployment to report any error', () => {
        assert.strictEqual(declaresRetainMarkers('{ not json'), false);
        assert.strictEqual(declaresRetainMarkers(null), false);
        assert.strictEqual(declaresRetainMarkers(undefined), false);
    });
});

describe('formatSnapshotAge', () => {
    it('reports an age in the coarsest unit that still says something', () => {
        assert.strictEqual(formatSnapshotAge(NOW - 30 * SECOND, NOW), '30 seconds ago');
        assert.strictEqual(formatSnapshotAge(NOW - MINUTE, NOW), '1 minute ago');
        assert.strictEqual(formatSnapshotAge(NOW - 45 * MINUTE, NOW), '45 minutes ago');
        assert.strictEqual(formatSnapshotAge(NOW - 2 * HOUR, NOW), '2 hours ago');
        assert.strictEqual(formatSnapshotAge(NOW - 23 * HOUR, NOW), '23 hours ago');
        assert.strictEqual(formatSnapshotAge(NOW - 180 * DAY, NOW), '180 days ago');
    });

    it('says so rather than guessing when Maximo recorded no date', () => {
        assert.strictEqual(formatSnapshotAge(null, NOW), 'at an unknown time');
        assert.strictEqual(formatSnapshotAge(undefined, NOW), 'at an unknown time');
    });

    it('does not report an age in the future when the server clock is ahead', () => {
        assert.strictEqual(formatSnapshotAge(NOW + HOUR, NOW), 'now');
    });
});

describe('describeSnapshotRecord', () => {
    it('names the record the way the configuration type is spoken about', () => {
        assert.strictEqual(describeSnapshotRecord({ type: 'cronTasks', object: 'CRONTASKDEF', identity: 'SFG20SYNC' }), 'cron task SFG20SYNC');
        assert.strictEqual(describeSnapshotRecord({ type: 'domains', object: 'MAXDOMAIN', identity: 'NAVIAMTEST' }), 'domain NAVIAMTEST');
    });

    it('falls back to the Maximo object for a type adopted after this list was written', () => {
        assert.strictEqual(describeSnapshotRecord({ type: 'escalations', object: 'ESCALATION', identity: 'NAVIAMESC' }), 'ESCALATION NAVIAMESC');
    });
});
