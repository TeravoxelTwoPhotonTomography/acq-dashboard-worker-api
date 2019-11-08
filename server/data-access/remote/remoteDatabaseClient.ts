import {Options} from "sequelize";

import {SequelizeOptions} from "../../options/coreServicesOptions";
import {SequelizeDatabaseClient} from "../seqeulizeDatabaseClient";

export class RemoteDatabaseClient extends SequelizeDatabaseClient {
    public static async Start(options: Options = SequelizeOptions.remote): Promise<RemoteDatabaseClient> {
        const client = new RemoteDatabaseClient(options);

        await client.start("remote");

        return client;
    }
}
