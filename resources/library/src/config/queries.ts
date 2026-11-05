/// <reference path="../../globals.d.ts" />
/// <reference path="../../manage-facade.d.ts" />

import { applyValues, close, requireKeys, setValue, updateProgress, valueOrDefault } from '../core/util';
import { applyRetainedValues, hasRetainDeclarations, retainIdentityOf } from '../core/retained-values';
import { deleteSnapshot, readSnapshot, snapshotKey, writeSnapshot } from '../core/snapshot-store';
import { captureExistingState } from '../core/capture';

var MXServer = Java.type('psdi.server.MXServer');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');
var MboConstants = Java.type('psdi.mbo.MboConstants');

/** The Maximo object a query snapshot is keyed by. */
export const SNAPSHOT_OBJECT = 'QUERY';

export function process(query: MaximoQuery): void {
    const maximo: psdi.server.MXServer = MXServer.getMXServer();
    const key = snapshotKey(SNAPSHOT_OBJECT, retainIdentityOf(query));
    let mboSet: psdi.mbo.MboSetRemote | null = null;
    try {
        mboSet = maximo.getMboSet('QUERY', maximo.getSystemUserInfo());
        const queryName = query.app + ':' + query.clauseName + ':' + query.owner;

        if (query._delete) {
            updateProgress('Deleting query ' + queryName);
            deleteQuery(mboSet, query);
            deleteSnapshot(key);
            updateProgress('Deleted query ' + queryName);
        } else {
            updateProgress('Adding/Updating query ' + queryName);
            addOrUpdateQuery(mboSet, query, key);
            deleteSnapshot(key);
            updateProgress('Added/Updated query ' + queryName);
        }
    } finally {
        close(mboSet);
    }
}

function deleteQuery(mboSet: psdi.mbo.MboSetRemote, query: MaximoQuery): void {
    const mbo = findQuery(mboSet, query);
    if (!mbo) {
        return;
    }

    mbo.delete();
    mboSet.save();
}

function addOrUpdateQuery(mboSet: psdi.mbo.MboSetRemote, query: MaximoQuery, key: string): void {
    const existing = findQuery(mboSet, query);

    if (hasRetainDeclarations(query)) {
        let snapshot = readSnapshot(key);
        if (!snapshot && existing) {
            snapshot = captureExistingState('queries', existing.getUniqueIDValue());
            if (!snapshot) {
                throw Error(
                    'Query ' +
                        retainIdentityOf(query) +
                        ' has an existing record whose state could not be captured, so its retained values cannot be preserved.'
                );
            }
            writeSnapshot(key, snapshot);
        }

        query = applyRetainedValues(query, snapshot ? new MaximoQuery(snapshot) : null);
    }

    const mbo = existing || mboSet.add();
    applyQueryValues(mbo, query);
    mboSet.save();
}

function findQuery(mboSet: psdi.mbo.MboSetRemote, query: MaximoQuery): psdi.mbo.MboRemote {
    const sqlf = new SqlFormat('app = :1 and clausename = :2 and owner = :3');
    sqlf.setObject(1, 'QUERY', 'APP', query.app);
    sqlf.setObject(2, 'QUERY', 'CLAUSENAME', query.clauseName);
    sqlf.setObject(3, 'QUERY', 'OWNER', query.owner);
    mboSet.setWhere(sqlf.format());
    mboSet.reset();
    return mboSet.moveFirst();
}

function applyQueryValues(mbo: psdi.mbo.MboRemote, query: MaximoQuery): void {
    if (mbo.toBeAdded()) {
        setValue(mbo, 'APP', query.app);
        setValue(mbo, 'CLAUSENAME', query.clauseName);
        setValue(mbo, 'OWNER', query.owner, MboConstants.NOACCESSCHECK);
    }

    applyValues(mbo, [
        ['CLAUSE', query.clause],
        ['DESCRIPTION', query.description],
        ['INTOBJECTNAME', query.intObjectName],
        ['ISPUBLIC', query.isPublic],
        ['ISUSERLIST', query.isUserList],
        ['NOTES', query.notes],
        ['PRIORITY', query.priority]
    ]);
}

export interface MaximoQueryInput {
    _delete?: boolean;
    app: string;
    clauseName: string;
    owner: string;
    clause: string;
    description: string;
    isPublic: boolean;
    isUserList: boolean;
    intObjectName?: string | null;
    notes?: string | null;
    priority?: number | null;
    _retain?: any;
}

export class MaximoQuery {
    static _keys = ['app', 'clauseName', 'owner'];

    _delete = false;
    app: string;
    clauseName: string;
    clause: string;
    description: string;
    isPublic: boolean;
    isUserList: boolean;
    intObjectName?: string | null;
    notes?: string | null;
    owner: string;
    priority?: number | null;
    _retain: any = [];

    constructor(input: MaximoQueryInput) {
        requireKeys(MaximoQuery, input, 'query');
        this.app = input.app;
        this.clauseName = input.clauseName;
        this.owner = input.owner;
        this.clause = input.clause;
        this.description = input.description;
        this.isPublic = input.isPublic;
        this.isUserList = input.isUserList;

        this._delete = valueOrDefault(input._delete, this._delete);
        this.intObjectName = input.intObjectName;
        this.notes = input.notes;
        this.priority = input.priority;
        this._retain = valueOrDefault(input._retain, this._retain);
    }
}
