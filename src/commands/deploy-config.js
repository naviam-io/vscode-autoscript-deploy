import { ProgressLocation, window } from 'vscode';

export default async function deployConfig(client, config) {
    await window.withProgress(
        {
            title: 'Deploying Configurations',
            location: ProgressLocation.Notification,
            cancellable: true
        },
        async (progress, cancelToken) => {
            progress.report({ message: '$(gear) Configuring settings...' });
            try {
                await client.postConfig(config, cancelToken, progress);
            } catch (error) {
                window.showErrorMessage(`${error.message}`, { modal: true });
            }
        }
    );

    return;
}
