/// <reference path="../../globals.d.ts" />
/// <reference path="../../manage-facade.d.ts" />

/**
 * Snapshot persistence: JSON in DOCINFO.TEXTCONTENT, keyed per record through CONTENTUID.
 * See docs/modules/nashorn-library.md.
 */
import { close, toExternalSynonymValue, updateWarning } from './util';

var MXServer = Java.type('psdi.server.MXServer');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');
var MboConstants = Java.type('psdi.mbo.MboConstants');

export function snapshotKey(objectName: string, identity: string): string {
    // DOCINFO.CONTENTUID throws BMXAA4049E on overflow rather than truncating. Local rather than
    // module level because the unit tests extract this function on its own.
    const SNAPSHOT_KEY_MAX_LENGTH = 50;

    const readable = 'MDT-RETAIN:' + objectName + ':' + identity;
    if (readable.length <= SNAPSHOT_KEY_MAX_LENGTH) {
        return readable;
    }

    // 33 + 1 + 16 is exactly the column width: the prefix keeps the row identifiable by eye, the
    // hash supplies the uniqueness plain truncation would lose.
    return readable.substring(0, 33) + '#' + snapshotKeyHash(readable);
}

/** The leading 8 bytes of a SHA-256 digest, as hex. Java.type is called here rather than at module
 * level so the unit tests can extract this function on its own. */
export function snapshotKeyHash(value: string): string {
    const JavaString = Java.type('java.lang.String');
    const MessageDigest = Java.type('java.security.MessageDigest');
    const digest = MessageDigest.getInstance('SHA-256').digest(new JavaString(value).getBytes('UTF-8'));

    let hex = '';
    for (let index = 0; index < 8; index++) {
        const octet = digest[index] & 0xff;
        hex += (octet < 16 ? '0' : '') + octet.toString(16);
    }
    return hex;
}

/** Whether a key names a snapshot rather than any other document, which is what makes a key
 * supplied by a caller safe to act on. */
export function isSnapshotKey(key: string): boolean {
    return typeof key === 'string' && key.indexOf('MDT-RETAIN:') === 0;
}

/** Newest first: nothing stops DOCINFO holding more than one row for a key, and a stale one must
 * never win over a more recent capture. */
function findSnapshotDocument(docInfoSet: psdi.mbo.MboSetRemote, key: string): psdi.mbo.MboRemote {
    const sqlf = new SqlFormat('contentuid = :1');
    sqlf.setObject(1, 'DOCINFO', 'CONTENTUID', key);
    docInfoSet.setWhere(sqlf.format());
    docInfoSet.setOrderBy('changedate desc, docinfoid desc');
    docInfoSet.reset();
    return docInfoSet.moveFirst();
}

/** When the snapshot was written, as epoch milliseconds, which the client turns into an age. */
function snapshotCapturedOn(docInfo: psdi.mbo.MboRemote): number | null {
    if (docInfo.isNull('CHANGEDATE')) {
        return null;
    }

    // String() first: a Java long reaches JavaScript as a number only through an explicit conversion.
    return Number(String(docInfo.getDate('CHANGEDATE').getTime()));
}

/** A snapshot is found by CONTENTUID, never by type, and SHOW is false so it stays out of the
 * attachment library. */
const SNAPSHOT_DOCTYPE = 'Attachments';

export function readSnapshot(key: string): any {
    const maximo: psdi.server.MXServer = MXServer.getMXServer();
    let docInfoSet: psdi.mbo.MboSetRemote | null = null;
    try {
        docInfoSet = maximo.getMboSet('DOCINFO', maximo.getSystemUserInfo());
        const docInfo = findSnapshotDocument(docInfoSet, key);
        if (!docInfo || docInfo.isNull('TEXTCONTENT')) {
            return null;
        }

        try {
            return JSON.parse(String(docInfo.getString('TEXTCONTENT')));
        } catch (ignored) {
            updateWarning('Ignoring the unreadable retained values snapshot ' + key + '.');
            return null;
        }
    } finally {
        close(docInfoSet);
    }
}

export function writeSnapshot(key: string, snapshot: any): void {
    const maximo: psdi.server.MXServer = MXServer.getMXServer();
    let docInfoSet: psdi.mbo.MboSetRemote | null = null;
    try {
        docInfoSet = maximo.getMboSet('DOCINFO', maximo.getSystemUserInfo());

        let docInfo = findSnapshotDocument(docInfoSet, key);
        if (!docInfo) {
            docInfo = docInfoSet.add();
            (docInfo as any).getMboValue('DOCUMENT').autoKey();
            docInfo.setValue('URLTYPE', toExternalSynonymValue('URLTYPE', '!FILE!', docInfo), MboConstants.NOACCESSCHECK);
            docInfo.setValue('URLNAME', key, MboConstants.NOACCESSCHECK);
            // Non-persistent, but DOCINFO validation still requires it.
            docInfo.setValue('NEWURLNAME', key, MboConstants.NOACCESSCHECK);
            docInfo.setValue('CONTENTUID', key, MboConstants.NOACCESSCHECK);
            docInfo.setValue('SHOW', false, MboConstants.NOACCESSCHECK);
            docInfo.setValue('DOCTYPE', SNAPSHOT_DOCTYPE, MboConstants.NOACCESSCHECK);
        }

        docInfo.setValue('DESCRIPTION', 'Maximo Development Tools retained values: ' + key, MboConstants.NOACCESSCHECK);
        docInfo.setValue('TEXTCONTENT', JSON.stringify(snapshot), MboConstants.NOACCESSCHECK);
        docInfoSet.save();
    } finally {
        close(docInfoSet);
    }
}

export function deleteSnapshot(key: string): void {
    const maximo: psdi.server.MXServer = MXServer.getMXServer();
    let docInfoSet: psdi.mbo.MboSetRemote | null = null;
    try {
        docInfoSet = maximo.getMboSet('DOCINFO', maximo.getSystemUserInfo());
        let docInfo = findSnapshotDocument(docInfoSet, key);
        if (!docInfo) {
            return;
        }

        // Every row, so an older duplicate cannot resurrect a discarded snapshot.
        while (docInfo) {
            docInfo.delete(MboConstants.NOACCESSCHECK);
            docInfo = docInfoSet.moveNext();
        }
        docInfoSet.save();
    } finally {
        close(docInfoSet);
    }
}

/** A stored snapshot's age, without reading its contents. Null when the key holds no snapshot. */
export function describeSnapshot(key: string): { key: string; capturedOn: number | null } | null {
    const maximo: psdi.server.MXServer = MXServer.getMXServer();
    let docInfoSet: psdi.mbo.MboSetRemote | null = null;
    try {
        docInfoSet = maximo.getMboSet('DOCINFO', maximo.getSystemUserInfo());
        const docInfo = findSnapshotDocument(docInfoSet, key);
        if (!docInfo) {
            return null;
        }

        return { key: key, capturedOn: snapshotCapturedOn(docInfo) };
    } finally {
        close(docInfoSet);
    }
}
