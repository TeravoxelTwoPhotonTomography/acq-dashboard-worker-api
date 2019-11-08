import {GraphQLScalarType} from "graphql";
import {Kind} from "graphql/language";

import {GraphQLAppContext, IPaginationConnections, ISimplePage} from "./graphQLContext";
import {CompletionResult, StartTaskData, TaskExecution} from "../data-model/local/taskExecution";
import {PipelineWorker, IWorkerInput} from "../data-model/local/worker";
import {QueueType, startTask} from "../task-management/taskSupervisor";

const debug = require("debug")("pipeline:worker-api:resolvers");

interface IIdOnlyArguments {
    id: string;
}

interface IRemoveCompletedArguments {
    code: CompletionResult;
}

interface IStartTaskArguments {
    taskInput: string;
}

interface ICancelTaskArguments {
    taskExecutionId: string;
    forceIfNeeded: boolean;
}

interface IUpdateWorkerArguments {
    worker: IWorkerInput;
}

interface IPageArguments {
    offset: number;
    limit: number;
    status: CompletionResult;
}

interface IConnectionArguments {
    first: number;
    after: string;
}

export interface IStartTaskResponse {
    taskExecution: StartTaskData;
    localTaskLoad: number;
    clusterTaskLoad: number;
}

let resolvers = {
    Query: {
        taskExecution(_, args: IIdOnlyArguments, context: GraphQLAppContext): Promise<TaskExecution> {
            return context.getTaskExecution(args.id);
        },
        taskExecutions(_, __, context: GraphQLAppContext): Promise<TaskExecution[]> {
            return context.getTaskExecutions();
        },
        taskExecutionPage(_, args: IPageArguments, context: GraphQLAppContext): Promise<ISimplePage<TaskExecution>> {
            return context.getTaskExecutionsPage(args.offset, args.limit, args.status);
        },
        taskExecutionConnections(_, args: IConnectionArguments, context: GraphQLAppContext): Promise<IPaginationConnections<TaskExecution>> {
            return context.getTaskExecutionsConnection(args.first, args.after);
        },
        runningTasks(_, __, context: GraphQLAppContext): Promise<TaskExecution[]> {
            return context.getRunningTaskExecutions();
        },
        worker(_, __, context: GraphQLAppContext): PipelineWorker {
            return PipelineWorker.CurrentWorker;
        }
    },
    Mutation: {
        updateWorker(_, args: IUpdateWorkerArguments, context: GraphQLAppContext): Promise<PipelineWorker> {
            return PipelineWorker.updateFromInput(args.worker);
        },
        startTask(_, args: IStartTaskArguments, context: GraphQLAppContext): Promise<IStartTaskResponse> {
            return startTask(JSON.parse(args.taskInput));
        },
        stopTask(_, args: ICancelTaskArguments, context: GraphQLAppContext): Promise<TaskExecution> {
            debug(`stop task ${args.taskExecutionId}`);
            return context.taskManager.stopTask(args.taskExecutionId);
        },
        removeCompletedExecutionsWithCode(_, args: IRemoveCompletedArguments, context: GraphQLAppContext) {
            return context.removeTaskExecutionsWithCompletionCode(args.code);
        }
    },
    TaskExecution: {
        task(taskExecution, _, context: GraphQLAppContext) {
            return context.getTaskDefinition(taskExecution.task_definition_id);
        }
    },
    Worker: {
        async local_task_load(w: Worker, _, context: GraphQLAppContext) {
            const tasks = await context.getRunningTaskExecutionsByQueueType(QueueType.Local);
            return tasks.reduce((p, t) => {
                return p + t.local_work_units;
            }, 0);
        },
        async cluster_task_load(w: Worker, _, context: GraphQLAppContext) {
            const tasks = await context.getRunningTaskExecutionsByQueueType(QueueType.Cluster);
            return tasks.reduce((p, t) => {
                return p + t.cluster_work_units;
            }, 0);
        }
    },
    Date: new GraphQLScalarType({
        name: "Date",
        description: "Date custom scalar type",
        parseValue: (value) => {
            return new Date(value); // value from the client
        },
        serialize: (value) => {
            return value.getTime(); // value sent to the client
        },
        parseLiteral: (ast) => {
            if (ast.kind === Kind.INT) {
                return parseInt(ast.value, 10); // ast value is always in string format
            }
            return null;
        },
    })
};

export default resolvers;
