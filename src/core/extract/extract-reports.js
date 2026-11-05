import * as fs from 'fs';
import * as path from 'path';

import * as yauzl from 'yauzl';
import { parseString, Builder } from 'xml2js';

import Logger from '../log.js';
import { createExtractedFileWriter } from './extracted-file-writer.js';

const LOG_SOURCE = 'ExtractReportsCommand';

/**
 * Extracts BIRT reports into extractDir: each design into a folder named for its report folder, with
 * its resources beside it and its entry merged into that folder's reports.xml.
 *
 * @param {*} client the Maximo client
 * @param {import('../ui.js').Ui} ui
 * @param {readonly { reportId: *, reportName: string, description: string }[]} reports the reports, as listed by getReportNames
 * @param {string} extractDir an existing folder
 * @returns {Promise<{ extracted: number, failures: { name: string, message: string }[], cancelled: boolean }>}
 */
export async function extractReports(client, ui, reports, extractDir) {
    const writer = createExtractedFileWriter(ui);
    const failures = [];
    let extracted = 0;
    let cancelled = false;

    await ui.withProgress({ title: 'Extracting Reports', cancellable: true }, async (progress, token) => {
        const percent = Math.round((1 / reports.length) * 100);

        for (const report of reports) {
            if (token.isCancellationRequested) {
                cancelled = true;
                break;
            }
            progress.report({ increment: percent, message: `Extracting ${report.description}` });

            try {
                const reportInfo = await client.getReport(report.reportId);

                if (!reportInfo) {
                    throw new Error(`The report ${report.description} was not found.`);
                }

                if (reportInfo.design) {
                    const outputFile = extractDir + '/' + reportInfo.reportFolder + '/' + report.reportName;
                    fs.mkdirSync(extractDir + '/' + reportInfo.reportFolder, { recursive: true });

                    const outcome = await writer.write(outputFile, reportInfo.design, `report ${outputFile}`);
                    if (outcome === 'cancelled') {
                        cancelled = true;
                        break;
                    }
                    if (outcome === 'written' || outcome === 'replaced') {
                        await writeResources(reportInfo, extractDir);
                        await writeMetaData(reportInfo, extractDir);
                    }
                }
                extracted++;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                failures.push({ name: report.description, message });
                Logger.error(`Failed to extract report ${report.description}: ${message}`, null, LOG_SOURCE);
            }
        }
    });

    return { extracted, failures, cancelled };
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
                    Logger.info(`Extraction complete for report "${reportName}".`, LOG_SOURCE);
                });
            });
        });
    }
}
