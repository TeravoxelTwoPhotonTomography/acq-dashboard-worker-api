import * as path from "path";
const fs = require("fs");
import {Sequelize, Options} from "sequelize";

const debug = require("debug")("pipeline:pipeline-api:database-connector");

export class SequelizeDatabaseClient {
    private readonly _options: Options;
    private _connection: Sequelize;

    protected constructor(options: Options) {
        this._options = options;
    }

    protected async start(name: string) {
        this.createConnection(name, this._options);
        await this.authenticate("pipeline");
    }

    private createConnection(name: string, options: Options) {
        this._connection = new Sequelize(options.database, options.username, options.password, options);

        this.loadModels(path.normalize(path.join(__dirname, "..", "data-model", name)));
    }

    private async authenticate(name: string) {
        try {
            await this._connection.authenticate();

            debug(`successful database connection: ${name}`);
        } catch (err) {
            if (err.name === "SequelizeConnectionRefusedError") {
                debug(`failed database connection: ${name} (connection refused - is it running?) - delaying 5 seconds`);
            } else {
                debug(`failed database connection: ${name} - delaying 5 seconds`);
                debug(err);
            }

            setTimeout(() => this.authenticate(name), 5000);
        }
    }

    private loadModels(modelLocation: string) {
        const modules = [];

        fs.readdirSync(modelLocation).filter(file => {
            return (file.indexOf(".") !== 0) && (file.slice(-3) === ".js");
        }).forEach(file => {
            let modelModule = require(path.join(modelLocation, file.slice(0, -3)));

            if (modelModule.modelInit != null) {
                modelModule.modelInit(this._connection);
                modules.push(modelModule);
            }
        });

        modules.forEach(modelModule => {
            if (modelModule.modelAssociate != null) {
                modelModule.modelAssociate();
            }
        });
    }
}
