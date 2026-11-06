/// <reference path="../../globals.d.ts" />
/// <reference path="../../manage-facade.d.ts" />

import { close } from './util';

/** A presentation ready to write: the XML to store and the parser's label map, keyed by IdProperty, for MAXLABELS. */
export interface PreparedPresentation {
    app: string;
    labelApp: string;
    xml: string;
    labels: any;
}

export function readPresentationXml(app: string): string {
    const MXServer = Java.type('psdi.server.MXServer');
    const SqlFormat = Java.type('psdi.mbo.SqlFormat');
    const maximo = MXServer.getMXServer();
    let presentationSet: any = null;
    try {
        presentationSet = maximo.getMboSet('MAXPRESENTATION', maximo.getSystemUserInfo());
        const sqlf = new SqlFormat('app = :1');
        sqlf.setObject(1, 'MAXPRESENTATION', 'APP', app);
        presentationSet.setWhere(sqlf.format());
        const presentation = presentationSet.moveFirst();
        if (!presentation) {
            throw new Error('The presentation ' + app + ' does not exist.');
        }
        return String(presentation.getString('PRESENTATION'));
    } finally {
        close(presentationSet);
    }
}

/** The names, upper-cased, that are not signature options of the application. */
export function findMissingSigoptions(app: string, names: string[]): string[] {
    const MXServer = Java.type('psdi.server.MXServer');
    const SqlFormat = Java.type('psdi.mbo.SqlFormat');
    const maximo = MXServer.getMXServer();
    const missing: string[] = [];
    let sigoptionSet: any = null;
    try {
        sigoptionSet = maximo.getMboSet('SIGOPTION', maximo.getSystemUserInfo());
        names.forEach(function (name: string): void {
            const optionName = name.toUpperCase();
            if (missing.indexOf(optionName) >= 0) {
                return;
            }
            const sqlf = new SqlFormat('app = :1 and upper(optionname) = :2');
            sqlf.setObject(1, 'SIGOPTION', 'APP', app);
            sqlf.setObject(2, 'SIGOPTION', 'OPTIONNAME', optionName);
            sigoptionSet.setWhere(sqlf.format());
            sigoptionSet.reset();
            if (sigoptionSet.isEmpty()) {
                missing.push(optionName);
            }
        });
    } finally {
        close(sigoptionSet);
    }
    return missing;
}

function presentationParserType(): any {
    try {
        return Java.type('psdi.webclient.system.controller.PresentationParser');
    } catch (ignored) {
        return null;
    }
}

/** Parses the XML the way Maximo does, for the stored form and the labels. Without the parser the XML is stored as is and labels are left alone. */
export function preparePresentationWrite(app: string, xml: string): PreparedPresentation {
    const PresentationParser = presentationParserType();
    if (PresentationParser === null) {
        return { app: app, labelApp: app, xml: xml, labels: null };
    }

    const parser = new PresentationParser(xml);
    return { app: app, labelApp: String(parser.getApplication()), xml: String(parser.getTrimmedXML()), labels: parser.getLabels() };
}

export function writePresentation(prepared: PreparedPresentation): void {
    const MXServer = Java.type('psdi.server.MXServer');
    const SqlFormat = Java.type('psdi.mbo.SqlFormat');
    const maximo = MXServer.getMXServer();
    let presentationSet: any = null;
    try {
        presentationSet = maximo.getMboSet('MAXPRESENTATION', maximo.getSystemUserInfo());
        const sqlf = new SqlFormat('app = :1');
        sqlf.setObject(1, 'MAXPRESENTATION', 'APP', prepared.app);
        presentationSet.setWhere(sqlf.format());
        const presentation = presentationSet.moveFirst();
        if (!presentation) {
            const MXApplicationException = Java.type('psdi.util.MXApplicationException');
            throw new MXApplicationException('designer', 'noapp', Java.to([prepared.app.toUpperCase()], 'java.lang.String[]'));
        }
        presentation.setValue('PRESENTATION', prepared.xml);
        presentationSet.save();
    } finally {
        close(presentationSet);
    }

    if (prepared.labels !== null) {
        syncPresentationLabels(prepared.labelApp, prepared.labels);
    }
}

/**
 * Makes the MAXLABELS rows match the parser's labels. Matching uses the Java map rather than a
 * JavaScript object, see docs/modules/nashorn-library.md.
 */
export function syncPresentationLabels(labelApp: string, labels: any): void {
    const MXServer = Java.type('psdi.server.MXServer');
    const MboConstants = Java.type('psdi.mbo.MboConstants');
    const IdProperty = Java.type('psdi.webclient.system.controller.IdProperty');
    const maximo = MXServer.getMXServer();
    let labelSet: any = null;
    try {
        labelSet = maximo.getMboSet('MAXLABELS', maximo.getSystemUserInfo());
        labelSet.setQbe('APP', labelApp);
        labelSet.setQbeExactMatch(true);
        labelSet.reset();
        labelSet.setLogLargFetchResultDisabled(true);

        // Removing each matched label from the map leaves the ones to insert.
        let row = labelSet.moveFirst();
        while (row) {
            const key = new IdProperty(row.getString('ID'), row.getString('PROPERTY'));
            const value = labels.remove(key);
            if (value === null) {
                row.delete();
            } else if (String(row.getString('VALUE')) !== String(value)) {
                row.setValue('VALUE', value, MboConstants.NOACCESSCHECK | MboConstants.NOVALIDATION_AND_NOACTION);
            }
            row = labelSet.moveNext();
        }

        const iterator = labels.entrySet().iterator();
        while (iterator.hasNext()) {
            const entry = iterator.next();
            const added = labelSet.add();
            added.setValue('APP', labelApp, MboConstants.NOVALIDATION_AND_NOACTION);
            added.setValue('ID', entry.getKey().getId());
            added.setValue('PROPERTY', entry.getKey().getProperty());
            added.setValue('VALUE', entry.getValue());
        }
        labelSet.save();
    } finally {
        close(labelSet);
    }
}

/** Writes a whole screen definition, as the screens script deploys it. */
export function deployPresentationXml(xml: string, app: string): void {
    const prepared = preparePresentationWrite(String(app), String(xml));
    if (prepared.labels !== null) {
        prepared.app = prepared.labelApp;
    }
    writePresentation(prepared);
    reloadPresentationCaches();
}

export function reloadPresentationCaches(): void {
    try {
        Java.type('psdi.webclient.system.controller.LabelCacheMgr').clearAll();
    } catch (ignored) {
        // Not available outside the UI server; the PRESENTATION reload below still applies.
    }
    Java.type('psdi.server.MXServer').getMXServer().reloadMaximoCache('PRESENTATION', true);
}
