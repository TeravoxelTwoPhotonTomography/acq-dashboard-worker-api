import {Sequelize, Model, DataTypes, BelongsToGetAssociationMixin, Op} from "sequelize"

import {TaskRepository} from "./taskRepository";

export class TaskDefinition extends Model {
    public id: string;
    public name: string;
    public description: string;
    public script: string;
    public interpreter: string;
    public script_args: string;
    public cluster_args: string;
    public expected_exit_code: number;
    public local_work_units: number;
    public cluster_work_units: number;
    public log_prefix: string;
    public task_repository_id: string;
    public readonly created_at: Date;
    public readonly updated_at: Date;
    public readonly deleted_at: Date;

    public getTaskRepository!: BelongsToGetAssociationMixin<TaskRepository>;

    /**
     * Find all tasks in repos that have not been deleted.
     */
    public static async getAll(): Promise<TaskDefinition[]> {
        const repos = await TaskRepository.findAll();

        return TaskDefinition.findAll({where: {task_repository_id: {[Op.in]: repos.map(p => p.id)}}});
    }
}

export const modelInit = (sequelize: Sequelize) => {
    TaskDefinition.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4
        },
        name: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        description: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        script: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        interpreter: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        script_args: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        cluster_args: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        expected_exit_code: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        local_work_units: {
            type: DataTypes.DOUBLE,
            defaultValue: 0
        },
        cluster_work_units: {
            type: DataTypes.DOUBLE,
            defaultValue: 0
        },
        log_prefix: {
            type: DataTypes.TEXT,
            defaultValue: ""
        }
    }, {
        timestamps: true,
        createdAt: "created_at",
        updatedAt: "updated_at",
        deletedAt: "deleted_at",
        paranoid: true,
        sequelize
    });
};

export const modelAssociate = () => {
    TaskDefinition.belongsTo(TaskRepository, {foreignKey: "task_repository_id"});
};
