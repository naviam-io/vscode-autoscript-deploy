/// <reference path="../../globals.d.ts" />
/// <reference path="../../manage-facade.d.ts" />

import { close } from './util';

export interface PresentationLabel {
    id: string;
    property: string;
    value: string;
}

export interface PresentationLabelPlan {
    inserts: PresentationLabel[];
    updates: { index: number; value: string }[];
    deletes: number[];
}

/** A presentation ready to write: the XML to store and the MAXLABELS rows it implies. */
export interface PreparedPresentation {
    app: string;
    labelApp: string;
    xml: string;
    labels: PresentationLabel[] | null;
}

export function presentationLabelKey(label: { id: string; property: string }): string {
    return label.id + '\u0000' + label.property;
}

/**
 * The MAXLABELS changes that make the existing rows match the desired ones. Indexes refer to the
 * existing rows; a second row for the same id and property is deleted.
 */
export function planPresentationLabels(existing: PresentationLabel[], desired: PresentationLabel[]): PresentationLabelPlan {
    const wanted: Record<string, PresentationLabel> = {};
    desired.forEach(function (label: PresentationLabel): void {
        wanted[presentationLabelKey(label)] = label;
    });

    const plan: PresentationLabelPlan = { inserts: [], updates: [], deletes: [] };
    const seen: Record<string, boolean> = {};
    existing.forEach(function (label: PresentationLabel, index: number): void {
        const key = presentationLabelKey(label);
        if (seen[key] || !Object.prototype.hasOwnProperty.call(wanted, key)) {
            plan.deletes.push(index);
            return;
        }
        seen[key] = true;
        if (label.value !== wanted[key].value) {
            plan.updates.push({ index: index, value: wanted[key].value });
        }
    });

    desired.forEach(function (label: PresentationLabel): void {
        const key = presentationLabelKey(label);
        if (!seen[key]) {
            seen[key] = true;
            plan.inserts.push(label);
        }
    });
    return plan;
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
    const labels: PresentationLabel[] = [];
    const iterator = parser.getLabels().entrySet().iterator();
    while (iterator.hasNext()) {
        const entry = iterator.next();
        labels.push({ id: String(entry.getKey().getId()), property: String(entry.getKey().getProperty()), value: String(entry.getValue()) });
    }
    return { app: app, labelApp: String(parser.getApplication()), xml: String(parser.getTrimmedXML()), labels: labels };
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

export function syncPresentationLabels(labelApp: string, desired: PresentationLabel[]): void {
    const MXServer = Java.type('psdi.server.MXServer');
    const MboConstants = Java.type('psdi.mbo.MboConstants');
    const maximo = MXServer.getMXServer();
    const flags = MboConstants.NOACCESSCHECK | MboConstants.NOVALIDATION_AND_NOACTION;
    let labelSet: any = null;
    try {
        labelSet = maximo.getMboSet('MAXLABELS', maximo.getSystemUserInfo());
        labelSet.setQbe('APP', labelApp);
        labelSet.setQbeExactMatch(true);
        labelSet.reset();
        labelSet.setLogLargFetchResultDisabled(true);

        const rows: any[] = [];
        const existing: PresentationLabel[] = [];
        let row = labelSet.moveFirst();
        while (row) {
            rows.push(row);
            existing.push({ id: String(row.getString('ID')), property: String(row.getString('PROPERTY')), value: String(row.getString('VALUE')) });
            row = labelSet.moveNext();
        }

        const plan = planPresentationLabels(existing, desired);
        plan.deletes.forEach(function (index: number): void {
            rows[index].delete();
        });
        plan.updates.forEach(function (update: { index: number; value: string }): void {
            rows[update.index].setValue('VALUE', update.value, flags);
        });
        plan.inserts.forEach(function (label: PresentationLabel): void {
            const added = labelSet.add();
            added.setValue('APP', labelApp, MboConstants.NOVALIDATION_AND_NOACTION);
            added.setValue('ID', label.id);
            added.setValue('PROPERTY', label.property);
            added.setValue('VALUE', label.value);
        });
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
