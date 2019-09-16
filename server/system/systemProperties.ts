const os = require("os");

export interface IIMachineProperties {
    osType: string;
    platform: string;
    arch: string;
    release: string;
    cpuCount: number;
    totalMemory: number;
}

function readMachineProperties(): IIMachineProperties {
    return {
        osType: os.type(),
        platform: os.platform(),
        arch: os.arch(),
        release: os.release(),
        cpuCount: os.cpus().length,
        totalMemory: os.totalmem()
    };
}

export const MachineProperties = readMachineProperties();
