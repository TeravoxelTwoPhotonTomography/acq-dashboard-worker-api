import * as os from "os";
import * as express from "express";
import * as bodyParser from "body-parser";
import {ApolloServer, gql} from "apollo-server-express";

const debug = require("debug")("pipeline:worker-api:server");

import {SocketIoClient} from "./io/serverConnection";
import {MainQueue} from "./message-queue/mainQueue";
import {LocalDatabaseClient} from "./data-access/local/localDatabaseClient";
import {ServiceConfiguration} from "./options/serviceConfig";
import {CoordinatorService} from "./options/coreServicesOptions";
import {typeDefinitions} from "./graphql/typeDefinitions";
import resolvers from "./graphql/resolvers";
import {GraphQLAppContext} from "./graphql/graphQLContext";
import {RemoteDatabaseClient} from "./data-access/remote/remoteDatabaseClient";
import {PipelineWorker} from "./data-model/local/worker";

start().then().catch((err) => debug(err));

async function start() {
    await LocalDatabaseClient.Start();

    await RemoteDatabaseClient.Start();

    await MainQueue.Instance.connect();

    const app = express();

    app.use(bodyParser.urlencoded({extended: true}));

    app.use(bodyParser.json());

    await SocketIoClient.use(PipelineWorker.CurrentWorker, CoordinatorService);

    const server = new ApolloServer({
        typeDefs: gql`${typeDefinitions}`,
        resolvers,
        introspection: true,
        playground: true,
        context: () => new GraphQLAppContext()
    });

    server.applyMiddleware({app, path: ServiceConfiguration.graphQlEndpoint});

    app.listen(ServiceConfiguration.networkPort, () => debug(`pipeline worker api available at http://${os.hostname()}:${ServiceConfiguration.networkPort}/graphql`));
}
