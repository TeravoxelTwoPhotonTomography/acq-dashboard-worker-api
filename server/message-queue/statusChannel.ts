import {Connection, Channel} from "amqplib";

const debug = require("debug")("pipeline:worker-api:status-channel");

const WorkerStatusUpdateExchange = "WorkerStatusUpdateExchange";

const WorkerUpdateMessage = "WorkerUpdateMessage";
const WorkerHeartbeatMessage = "WorkerHeartbeatMessage";

export class StatusChannel {
    private _connection: Connection = null;
    private _channel: Channel = null;

    public async connect(connection: Connection): Promise<void> {
        try {
            this._connection = connection;

            this._channel = await this._connection.createChannel();

            this._channel.on("error", async (err) => {
                debug("channel error");
                debug(err);
            });

            this._channel.on("close", async (err) => {
                this._channel = null;
                debug("channel closed");
                debug(err);
            });

            await this._channel.assertExchange(WorkerStatusUpdateExchange, "direct", {durable: false});
        } catch (err) {
            this._channel = null;
            debug("failed to create worker status channel");
            debug(err);
        }
    }

    public sendHeartbeat(data: any) {
        if (this._channel !== null) {
            this._channel.publish(WorkerStatusUpdateExchange, WorkerHeartbeatMessage, Buffer.from(JSON.stringify(data)));
        }
    }

    public sendStatus(data: any) {
        if (this._channel !== null) {
            this._channel.publish(WorkerStatusUpdateExchange, WorkerUpdateMessage, Buffer.from(JSON.stringify(data)));
        }
    }
}