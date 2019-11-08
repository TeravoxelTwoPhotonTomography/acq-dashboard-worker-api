import {Options} from "sequelize";

import {SequelizeOptions} from "../../options/coreServicesOptions";
import {SequelizeDatabaseClient} from "../seqeulizeDatabaseClient";
import {PipelineWorker} from "../../data-model/local/worker";

export class LocalDatabaseClient extends SequelizeDatabaseClient {
    public static async Start(options: Options = SequelizeOptions.local): Promise<LocalDatabaseClient> {
        const client = new LocalDatabaseClient(options);

        await client.start("local");

        await PipelineWorker.findCurrentWorker();

        return client;
    }
}
