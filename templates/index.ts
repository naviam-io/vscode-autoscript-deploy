// Declare implicit variables like service to avoid TypeScript errors. These will be provided by the Naviam environment at runtime.
declare var service: any;

main();

function main(): void {
    // Your script's main logic goes here. You can use the 'service' variable to interact with the Naviam environment.
}

var scriptConfig = {
    autoscript: '${script_name}',
    description: '${script_description}',
    version: '1.0.0',
    active: true,
    logLevel: 'ERROR'
};
