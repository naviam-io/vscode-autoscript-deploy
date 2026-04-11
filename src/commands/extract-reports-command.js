import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
// @ts-ignore

import * as yauzl from 'yauzl';

import { parseString, Builder } from 'xml2js';

import { ProgressLocation, window, workspace } from 'vscode';

// get a reference to the Maximo configuration object
import { getMaximoConfig, asyncForEach } from '../extension';

export default async function extractReportsCommand(client) {
    let extractLoc = (await getMaximoConfig()).extractLocationReports;
    // if the extract location has not been specified use the workspace folder.
    if (typeof extractLoc === 'undefined' || !extractLoc) {
        if (workspace.workspaceFolders !== undefined) {
            extractLoc = workspace.workspaceFolders[0].uri.fsPath;
        } else {
            window.showErrorMessage('A working folder must be selected or an export folder configured before exporting reports.', {
                modal: true,
            });
            return;
        }
    }

    if (extractLoc.startsWith('~')) {
        extractLoc = path.join(os.homedir(), extractLoc.slice(1));
    } else if ((extractLoc.startsWith('./') || extractLoc.startsWith('.\\')) && workspace.workspaceFolders !== undefined) {
        extractLoc = path.join(workspace.workspaceFolders[0].uri.fsPath, extractLoc.slice(2));
    } else if (!path.isAbsolute(extractLoc) && workspace.workspaceFolders !== undefined) {
        extractLoc = path.join(workspace.workspaceFolders[0].uri.fsPath, extractLoc);
    }

    if (!fs.existsSync(extractLoc)) {
        fs.mkdirSync(extractLoc, { recursive: true });
    }

    const quickPick = window.createQuickPick();
    quickPick.canSelectMany = true;
    quickPick.title = 'Select Reports from the List';
    quickPick.busy = true;
    quickPick.placeholder = 'Getting Report Definitions\u2026';
    quickPick.show();

    const objects = await client.getReportNames();

    if (objects != null && Array.isArray(objects)) {
        objects.sort((a, b) => a.label.localeCompare(b.label));
        quickPick.items = objects;

        quickPick.placeholder = 'Select All Reports';
        quickPick.busy = false;

        quickPick.onDidAccept(async () => {
            const reports = quickPick.selectedItems;

            if (reports.length > 0) {
                await window.withProgress(
                    {
                        title: 'Extracting Reports',
                        location: ProgressLocation.Notification,
                        cancellable: true,
                    },
                    async (progress, cancelToken) => {
                        let percent = Math.round((1 / reports.length) * 100);

                        let overwriteAll = false;
                        let overwrite = false;

                        await asyncForEach(reports, async (report) => {
                            if (!cancelToken.isCancellationRequested) {
                                progress.report({
                                    increment: percent,
                                    message: `Extracting ${report.description}`,
                                });

                                let reportInfo = await client.getReport(report.reportId);

                                let outputFile = extractLoc + '/' + reportInfo.reportFolder + '/' + report.reportName;

                                if (reportInfo.design) {
                                    let xml = reportInfo.design;
                                    // if the file doesn't exist then just write it out.
                                    if (!fs.existsSync(outputFile)) {
                                        // make sure the folder exists
                                        fs.mkdirSync(extractLoc + '/' + reportInfo.reportFolder, { recursive: true });
                                        fs.writeFileSync(outputFile, xml);
                                        await writeResources(reportInfo, extractLoc);
                                        await writeMetaData(reportInfo, extractLoc);
                                    } else {
                                        let incomingHash = crypto.createHash('sha256').update(xml).digest('hex');
                                        // @ts-ignore
                                        let fileHash = crypto.createHash('sha256').update(fs.readFileSync(outputFile)).digest('hex');

                                        if (fileHash !== incomingHash) {
                                            if (!overwriteAll) {
                                                await window
                                                    .showInformationMessage(
                                                        `The report ${outputFile} exists. \nReplace?`,
                                                        { modal: true },
                                                        ...['Replace', 'Replace All', 'Skip']
                                                    )
                                                    .then(async (response) => {
                                                        if (response === 'Replace') {
                                                            overwrite = true;
                                                        } else if (response === 'Replace All') {
                                                            overwriteAll = true;
                                                        } else if (response === 'Skip') {
                                                            // do nothing
                                                            overwrite = false;
                                                        } else {
                                                            // @ts-ignore
                                                            cancelToken.cancel();
                                                        }
                                                    });
                                            }
                                            if (overwriteAll || overwrite) {
                                                fs.writeFileSync(outputFile, xml);
                                                await writeResources(reportInfo, extractLoc);
                                                await writeMetaData(reportInfo, extractLoc);
                                                overwrite = false;
                                            }
                                        }
                                    }

                                    if (cancelToken.isCancellationRequested) {
                                        return;
                                    }
                                }
                            }
                        });

                        if (!cancelToken.isCancellationRequested) {
                            window.showInformationMessage(reports.length + (reports.length > 1 ? ' reports' : ' report') + ' extracted.', { modal: true });
                        }
                    }
                );
            } else {
                quickPick.hide();
            }
        });
    } else {
        quickPick.hide();
        window.showErrorMessage('No reports were found to extract.', { modal: true });
    }
}

export async function writeMetaData(reportInfo, extractLoc) {
    let xmlFilePath = extractLoc + '/' + reportInfo.reportFolder + '/reports.xml';

    let reportsXML = await new Promise((resolve, reject) => {
        if (fs.existsSync(xmlFilePath)) {
            const xml = fs.readFileSync(xmlFilePath, 'utf-8');
            parseString(xml, (err, result) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(result);
            });
        } else {
            // Initialize xmlObject with a reports element
            resolve({ reports: {} });
        }
    });

    if (!reportsXML) {
        reportsXML = {};
    }

    if (typeof reportsXML.reports === 'undefined' || !reportsXML.reports) {
        reportsXML.reports = {};
    }

    if (typeof reportsXML.reports.report === 'undefined' || !reportsXML.reports.report) {
        reportsXML.reports.report = [];
    }

    reportsXML.reports.report = reportsXML.reports.report.filter((report) => {
        // Assuming each report has an $ object with an id attribute
        // Keep the report if its id is not the one we want to remove
        return !(report.$ && report.$.name === reportInfo.reportName);
    });

    let report = { $: { name: reportInfo.reportName } };
    report.attribute = [];
    report.attribute.push({
        _: reportInfo.reportName,
        $: { name: 'filename' },
    });
    report.attribute.push({
        _: reportInfo.description,
        $: { name: 'description' },
    });
    report.attribute.push({
        _: reportInfo.directPrintLocation,
        $: { name: 'dploc' },
    });
    report.attribute.push({ _: reportInfo.directPrint, $: { name: 'dp' } });
    report.attribute.push({
        _: reportInfo.browserViewLocation,
        $: { name: 'qlloc' },
    });
    report.attribute.push({ _: reportInfo.browserView, $: { name: 'ql' } });
    report.attribute.push({
        _: reportInfo.printWithAttachmentsLocation,
        $: { name: 'padloc' },
    });
    report.attribute.push({
        _: reportInfo.printWithAttachments,
        $: { name: 'pad' },
    });
    if (reportInfo.toolbarSequence)
        report.attribute.push({
            _: reportInfo.toolbarSequence,
            $: { name: 'toolbarsequence' },
        });
    report.attribute.push({
        _: reportInfo.noRequestPage ? 1 : 0,
        $: { name: 'norequestpage' },
    });
    report.attribute.push({
        _: reportInfo.detail ? 1 : 0,
        $: { name: 'detail' },
    });
    if (reportInfo.recordLimit)
        report.attribute.push({
            _: reportInfo.recordLimit,
            $: { name: 'recordlimit' },
        });
    report.attribute.push({
        _: reportInfo.reportFolder,
        $: { name: 'reportfolder' },
    });
    if (reportInfo.priority)
        report.attribute.push({
            _: reportInfo.priority,
            $: { name: 'priority' },
        });
    report.attribute.push({
        _: reportInfo.scheduleOnly ? 1 : 0,
        $: { name: 'scheduleonly' },
    });
    report.attribute.push({
        _: reportInfo.toolbarLocation,
        $: { name: 'toolbarlocation' },
    });
    report.attribute.push({
        _: reportInfo.useWhereWithParam ? 1 : 0,
        $: { name: 'usewherewithparam' },
    });
    report.attribute.push({
        _: reportInfo.displayOrder ? 1 : 0,
        $: { name: 'displayOrder' },
    });
    report.attribute.push({
        _: reportInfo.paramColumns ? 1 : 0,
        $: { name: 'paramcolumns' },
    });

    if (reportInfo.parameters.length > 0) {
        report.parameters = {};
        report.parameters.parameter = [];
        reportInfo.parameters.forEach((param) => {
            let parameter = { $: { name: param.parameterName } };
            parameter.attribute = [];
            parameter.attribute.push({
                _: param.attributeName,
                $: { name: 'attributename' },
            });
            parameter.attribute.push({
                _: param.defaultValue,
                $: { name: 'defaultvalue' },
            });
            parameter.attribute.push({
                _: param.labelOverride,
                $: { name: 'labeloverride' },
            });
            parameter.attribute.push({
                _: param.lookupName,
                $: { name: 'lookupname' },
            });
            parameter.attribute.push({
                _: param.hidden ? 1 : 0,
                $: { name: 'hidden' },
            });
            parameter.attribute.push({
                _: param.lookup ? 1 : 0,
                $: { name: 'lookup' },
            });
            parameter.attribute.push({
                _: param.operator,
                $: { name: 'operator' },
            });
            parameter.attribute.push({
                _: param.multiLookup ? 1 : 0,
                $: { name: 'multilookup' },
            });
            parameter.attribute.push({
                _: param.hidden ? 1 : 0,
                $: { name: 'hidden' },
            });
            parameter.attribute.push({
                _: param.required ? 1 : 0,
                $: { name: 'required' },
            });
            parameter.attribute.push({
                _: param.sequence,
                $: { name: 'sequence' },
            });
            report.parameters.parameter.push(parameter);
        });
    }
    if (reportInfo.resources) {
        const reportName = path.basename(reportInfo.reportName, path.extname(reportInfo.reportName));

        let outputDir = extractLoc + '/' + reportInfo.reportFolder + '/' + reportName;
        report.resources = {};
        report.resources.resource = [];
        if (fs.existsSync(outputDir)) {
            const files = fs.readdirSync(outputDir);
            files.forEach((file) => {
                let resource = {};
                resource.reference = { _: path.basename(file) };
                resource.filename = './' + reportName + '/' + path.basename(file);
                report.resources.resource.push(resource);
            });
        }
    }

    reportsXML.reports.report.push(report);

    const xml = new Builder().buildObject(reportsXML);
    fs.writeFileSync(xmlFilePath, xml, 'utf-8');
}

export async function writeResources(reportInfo, extractLoc) {
    if (reportInfo.resources) {
        let binaryBuffer = Buffer.from(reportInfo.resources, 'base64');
        const reportName = path.basename(reportInfo.reportName, path.extname(reportInfo.reportName));

        let outputDir = extractLoc + '/' + reportInfo.reportFolder + '/' + reportName;

        fs.mkdirSync(outputDir, { recursive: true });

        for (const file of fs.readdirSync(outputDir)) {
            fs.unlinkSync(path.join(outputDir, file));
        }

        await new Promise((resolve, reject) => {
            yauzl.fromBuffer(binaryBuffer, { lazyEntries: true }, (err, zipFile) => {
                if (err) reject(err);
                zipFile.readEntry();
                zipFile.on('entry', function (entry) {
                    if (/\/$/.test(entry.fileName)) {
                        // Directory file names end with '/'
                        fs.mkdirSync(path.join(outputDir, entry.fileName), {
                            recursive: true,
                        });

                        zipFile.readEntry();
                    } else {
                        // File entry
                        zipFile.openReadStream(entry, (err, readStream) => {
                            if (err) reject(err);
                            const filePath = path.join(outputDir, entry.fileName);
                            fs.mkdirSync(path.dirname(filePath), {
                                recursive: true,
                            });

                            readStream.pipe(fs.createWriteStream(filePath));
                            readStream.on('end', () => {
                                zipFile.readEntry();
                                resolve();
                            });
                        });
                    }
                });
                zipFile.on('end', () => {
                    console.log(`Extraction complete for report "${reportName}"`);
                });
            });
        });
    }
}
