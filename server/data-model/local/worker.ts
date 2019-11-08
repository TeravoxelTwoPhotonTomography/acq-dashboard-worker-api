import {Sequelize, DataTypes} from "sequelize";
import {BaseModel} from "../baseModel";
import {ServiceConfiguration} from "../../options/serviceConfig";

export type IWorkerInput = {
    id: string;
    preferred_network_interface_id: string;
    display_name: string;
    local_work_capacity: number;
    cluster_work_capacity: number;
    is_accepting_jobs: boolean;
}

export class PipelineWorker extends BaseModel {
    public display_name: string;
    public local_work_capacity: number;
    public cluster_work_capacity: number;
    public is_accepting_jobs: boolean;

    public get process_id(): number {
        return process.pid;
    }

    private static _currentWorker: PipelineWorker;

    public static get CurrentWorker(): PipelineWorker {
        return this._currentWorker;
    }

    public static async findCurrentWorker() {
        if (process.env.PIPELINE_WORKER_ID != null) {
            [this._currentWorker] = await PipelineWorker.findOrCreate({where: {id: process.env.PIPELINE_WORKER_ID}});
        } else {
            this._currentWorker = await PipelineWorker.findOne();

            if (this._currentWorker == null) {
                this._currentWorker = await PipelineWorker.create({});
            }
        }

        this._currentWorker.display_name = this._currentWorker.display_name || ServiceConfiguration.name;

        return this._currentWorker;
    }

    public static async updateFromInput(input: IWorkerInput): Promise<PipelineWorker> {
        if (this._currentWorker) {
            this._currentWorker = await this._currentWorker.update({
                display_name: input.display_name || this._currentWorker.display_name,
                local_work_capacity: input.local_work_capacity != null ? input.local_work_capacity : this._currentWorker.local_work_capacity,
                cluster_work_capacity: input.cluster_work_capacity != null ? input.cluster_work_capacity : this._currentWorker.cluster_work_capacity,
                is_accepting_jobs: input.is_accepting_jobs != null ? input.is_accepting_jobs : this._currentWorker.is_accepting_jobs
            });
        }

        return this._currentWorker;
    };
}

export const modelInit = (sequelize: Sequelize) => {
    PipelineWorker.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4
        },
        display_name: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        local_work_capacity: {
            type: DataTypes.FLOAT,
            defaultValue: 1
        },
        cluster_work_capacity: {
            type: DataTypes.FLOAT,
            defaultValue: 0
        },
        is_accepting_jobs: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        }
    }, {
        tableName: "Workers",
        timestamps: true,
        createdAt: "created_at",
        updatedAt: "updated_at",
        deletedAt: "deleted_at",
        paranoid: true,
        sequelize
    });
};
