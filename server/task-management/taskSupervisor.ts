import {PipelineWorker} from "../data-model/local/worker";

const asyncUtils = require("async");
import * as fse from "fs-extra";

const debug = require("debug")("pipeline:worker-api:task-supervisor");

import {localTaskManager} from "./localTaskManager";
import {CompletionResult, ExecutionStatus, StartTaskData, TaskExecution} from "../data-model/local/taskExecution";
import {LSFTaskManager} from "./lsfManager";
import * as path from "path";
import {MainQueue} from "../message-queue/mainQueue";
import {IStartTaskResponse} from "../graphql/resolvers";

export enum QueueType {
    Local = 0,
    Cluster = 1
}

/***
 * These are mapped from string values return from PM2 for local management and LSF for cluster management.
 ***/
export enum JobStatus {
    Undefined = -1,
    Unknown = 0,
    Pending = 1,
    Started = 2,
    Online = 3,
    Restarted = 4,
    RestartOverLimit = 5,
    Stopping = 6,
    Stopped = 7,
    Exited = 8,
    Deleted = 9
}

export interface IJobStatistics {
    cpuPercent: number;
    cpuTimeSeconds: number;
    memoryMB: number;
}

export interface IJobUpdate {
    id: number;
    status: JobStatus;
    exitCode: number;
    statistics: IJobStatistics;
}

export interface ITaskSupervisor {
    startTask(remoteTaskExecution: TaskExecution): Promise<IStartTaskResponse>;
    stopTask(taskExecutionId: string): Promise<TaskExecution>;
}

export interface ITaskUpdateSource {
    TaskUpdateDelegate: ITaskUpdateDelegate;
}

export interface ITaskUpdateDelegate {
    updateZombie(taskExecution: TaskExecution);
    update(taskExecution: TaskExecution, processInfo: IJobUpdate);
    notifyTaskLoad(queueType: QueueType, load: number);
}

export interface ITaskManager {
    startTask(taskExecution: TaskExecution): void;
    stopTask(taskExecutionId: string): void;
}

export class TaskSupervisor implements ITaskSupervisor, ITaskUpdateDelegate {
    public static Instance = new TaskSupervisor();

    private _localTaskLoad = 0;
    private _clusterTaskLoad = 0;

    public constructor() {
        localTaskManager.TaskUpdateDelegate = this;

        LSFTaskManager.Instance.TaskUpdateDelegate = this;
    }

    public async startTask(remoteTaskExecution: TaskExecution): Promise<IStartTaskResponse> {
        const worker = PipelineWorker.CurrentWorker;

        let queueType = QueueType.Local;

        const localAvailable = worker.local_work_capacity - this._localTaskLoad;
        const clusterAvailable = worker.cluster_work_capacity - this._clusterTaskLoad;

        if (localAvailable < remoteTaskExecution.local_work_units) {
            if (clusterAvailable < remoteTaskExecution.cluster_work_units) {
                debug(`ignoring start task request - worker is at capacity`);
                return {
                    taskExecution: null,
                    localTaskLoad: this._localTaskLoad,
                    clusterTaskLoad: this._clusterTaskLoad
                };
            } else {
                queueType = QueueType.Cluster
            }
        }

        debug(`starting task ${remoteTaskExecution.task_definition_id} for pipeline ${remoteTaskExecution.pipeline_stage_id}`);

        const localTaskExecutionInput = Object.assign({}, remoteTaskExecution);

        localTaskExecutionInput.remote_task_execution_id = remoteTaskExecution.id;
        localTaskExecutionInput.id = undefined;
        localTaskExecutionInput.queue_type = queueType;

        let argsAsArray = JSON.parse(remoteTaskExecution.resolved_script_args);

        argsAsArray = argsAsArray.map(a => {
            if (a.toLowerCase() === "is_cluster_job") {
                return queueType.toString();
            }
            return a;
        });

        localTaskExecutionInput.resolved_script_args = JSON.stringify(argsAsArray);

        if (!path.isAbsolute(localTaskExecutionInput.resolved_script)) {
            // This happens if a repository is not used or an absolute path is not used.  The coordinator does not make
            // it absolute based on that remote location.
            localTaskExecutionInput.resolved_script = path.join(process.cwd(), localTaskExecutionInput.resolved_script);
        }

        let taskExecution: TaskExecution = await TaskExecution.create(localTaskExecutionInput);

        try {
            fse.ensureDirSync(taskExecution.resolved_output_path);
            fse.chmodSync(taskExecution.resolved_output_path, 0o775);
            // resolved_log_path is really the log prefix i.e., the log path plus the prefix for file names.  There is no
            // extension so node sees this as a directory.
            fse.ensureDirSync(path.resolve(taskExecution.resolved_log_path, ".."));
            debug(`ensured log path at ${path.resolve(taskExecution.resolved_log_path, "..")}`);

            const completeFile = path.join(`${taskExecution.resolved_log_path}-done.txt`);

            try {
                if (fse.existsSync(completeFile)) {
                    fse.unlinkSync(completeFile);
                }
            } catch (err) {
                debug(err);
            }

            taskExecution.submitted_at = new Date();
            taskExecution.started_at = taskExecution.submitted_at;

            taskExecution.execution_status_code = ExecutionStatus.Running;

            await taskExecution.save();

            // Not using returned processInfo - using bus messages to get start/online events.  Handling directly here
            // is a race condition with start/exit events for a fast completion process.

            // debug(opts);

            if (queueType === QueueType.Cluster) {
                await LSFTaskManager.Instance.startTask(taskExecution);
                this._clusterTaskLoad += taskExecution.cluster_work_units;
            } else {
                await localTaskManager.startTask(taskExecution);
                this._localTaskLoad += taskExecution.local_work_units;
            }
        } catch (err) {
            debug(err);

            taskExecution.completed_at = new Date();
            taskExecution.execution_status_code = ExecutionStatus.Completed;
            taskExecution.completion_status_code = CompletionResult.Error;

            await taskExecution.save();

            await MainQueue.Instance.sendTaskExecutionComplete(taskExecution);
        }

        const returnTaskExecution = await TaskExecution.findByPk(taskExecution.id);

        return {
            taskExecution: returnTaskExecution.get({plain: true}) as StartTaskData,
            localTaskLoad: this._localTaskLoad,
            clusterTaskLoad: this._clusterTaskLoad
        };
    }

    public async stopTask(taskExecutionId: string, isZombie = false): Promise<TaskExecution> {
        try {
            let taskExecution: TaskExecution = await TaskExecution.findByPk(taskExecutionId);

            if (taskExecution.completion_status_code < CompletionResult.Cancel) {
                taskExecution.execution_status_code = ExecutionStatus.Zombie;
                // Assume orphaned unless the process manager sends a completion event from stop() below.
                taskExecution.completion_status_code = CompletionResult.Cancel;

                await taskExecution.save();
            }

            if (!isZombie) {
                if (taskExecution.queue_type === QueueType.Local) {
                    await localTaskManager.stopTask(taskExecutionId);
                } else {
                    await LSFTaskManager.Instance.stopTask(taskExecutionId);
                }
            }

            return TaskExecution.findByPk(taskExecutionId);
        } catch (err) {
            // Null error means error in ProcessManager.stop() and already reported.
            if (err !== null) {
                debug(err);
            }
            return null;
        }
    }

    public async update(taskExecution: TaskExecution, processInfo: IJobUpdate) {
        await this._update(taskExecution, processInfo);
    }

    public async updateZombie(taskExecution: TaskExecution) {
        await this.stopTask(taskExecution.id, true);
    }

    public notifyTaskLoad(queueType: QueueType, load: number) {
        if (queueType === QueueType.Local) {
            this._localTaskLoad = load;
        } else {
            this._clusterTaskLoad = load;
        }
    }

    private async _update(taskExecution: TaskExecution, jobUpdate: IJobUpdate) {
        if (taskExecution == null) {
            debug(`skipping update for null task execution (${taskExecution == null})`);
            return;
        }

        if (jobUpdate.status != null) {
            if (jobUpdate.status === JobStatus.Pending) {
                taskExecution.started_at = new Date();
            }

            // Have a real status from the process manager (e.g, PM2).
            if (jobUpdate.status > taskExecution.last_process_status_code) {
                taskExecution.last_process_status_code = jobUpdate.status;
            }

            // Stop/Exit/Delete
            if (jobUpdate.status >= JobStatus.Stopped) {
                if (taskExecution.completed_at == null) {
                    // debug(`marking complete for task execution ${taskExecution.id}`);

                    taskExecution.completed_at = new Date();
                    taskExecution.execution_status_code = ExecutionStatus.Completed;

                    if (taskExecution.completion_status_code < CompletionResult.Cancel) {
                        // Do not have control on how PM2 fires events.  Can't assume we didn't get an exit code already.
                        taskExecution.completion_status_code = CompletionResult.Unknown;
                    }

                    if (taskExecution.queue_type === QueueType.Local) {
                        this._localTaskLoad -= taskExecution.local_work_units;
                    } else {
                        this._clusterTaskLoad -= taskExecution.cluster_work_units;
                    }
                }

                if (taskExecution.queue_type === QueueType.Local) {
                    // Exit code may arrive separately from status change of done/exit.
                    if (jobUpdate.exitCode != null) {
                        // May already be set if cancelled.
                        if (taskExecution.completion_status_code < CompletionResult.Cancel) {
                            taskExecution.completion_status_code = (jobUpdate.exitCode === taskExecution.expected_exit_code) ? CompletionResult.Success : CompletionResult.Error;
                        }

                        if (taskExecution.exit_code === null) {
                            taskExecution.exit_code = jobUpdate.exitCode;
                        }
                    }
                } else {
                    debug(`checking completion for ${taskExecution.id}`);

                    if (taskExecution.completion_status_code < CompletionResult.Cancel) {
                        if (jobUpdate.status === JobStatus.Stopped) {
                            taskExecution.completion_status_code = CompletionResult.Success;
                        } else if (jobUpdate.status === JobStatus.Exited) {
                            taskExecution.completion_status_code = CompletionResult.Error;
                        }

                        if ((jobUpdate.exitCode != null) && (taskExecution.exit_code == null)) {
                            taskExecution.exit_code = jobUpdate.exitCode;
                        }

                        if (taskExecution.completion_status_code >= CompletionResult.Success) {
                            if (taskExecution.completion_status_code === CompletionResult.Success) {
                                fse.appendFileSync(`${taskExecution.resolved_log_path}-done.txt`, `Complete ${(new Date()).toUTCString()}`);
                            }
                        }
                    }
                }

                await MainQueue.Instance.sendTaskExecutionComplete(taskExecution);
            } else {
                await MainQueue.Instance.sendTaskExecutionUpdate(taskExecution);
            }
        }

        if (jobUpdate.statistics != null) {
            taskExecution.cpu_time_seconds = validStatistics(taskExecution.cpu_time_seconds, jobUpdate.statistics.cpuTimeSeconds);
            taskExecution.max_cpu_percent = validStatistics(taskExecution.max_cpu_percent, jobUpdate.statistics.cpuPercent);
            taskExecution.max_memory_mb = validStatistics(taskExecution.max_memory_mb, jobUpdate.statistics.memoryMB);
        }

        await taskExecution.save();
    }
}

function validStatistics(current, value): number {
    if ((value != null) && (value > current || isNaN(current))) {
        return value;
    } else {
        return current;
    }
}

const connectorQueueAccess = asyncUtils.queue(accessQueueWorker, 1);

interface IAccessQueueToken {
    remoteTaskExecution: TaskExecution;
    resolve: any;
    reject: any;
}

export async function startTask(remoteTaskExecution: TaskExecution): Promise<IStartTaskResponse> {
    return new Promise<IStartTaskResponse>((resolve, reject) => {
        connectorQueueAccess.push({
            remoteTaskExecution,
            resolve,
            reject
        });
    });
}

async function accessQueueWorker(token: IAccessQueueToken, completeCallback) {
    token.resolve(await TaskSupervisor.Instance.startTask(token.remoteTaskExecution));
    completeCallback();
}
