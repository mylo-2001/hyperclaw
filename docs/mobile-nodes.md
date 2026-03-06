# Mobile Nodes — Connect Tab

Paired iOS/Android devices can register as **nodes** and receive device commands from the agent (camera, contacts, location, etc.).

## Protocol

1. **Connect** via WebSocket to the gateway (e.g. `ws://host:18789`).
2. **Register** with first message:
   ```json
   {
     "type": "node_register",
     "nodeId": "iPhone-1",
     "platform": "ios",
     "capabilities": {
       "camera": true,
       "screenRecord": true,
       "location": true,
       "contacts": true,
       "calendar": true,
       "photos": true,
       "sms": true,
       "notify": true,
       "motion": true
     },
     "deviceName": "John's iPhone",
     "token": "<gateway auth token if required>"
   }
   ```
3. **Receive** `node:registered` and `node:command` messages.
4. **Execute** commands on the device and reply:
   ```json
   {
     "type": "node:command_response",
     "id": "<command id>",
     "ok": true,
     "data": "<result string or object>"
   }
   ```

## API

- `GET /api/nodes` — list connected nodes.
- Agent tool `node_command` — list nodes or send a command to a node.

## Supported Commands

| Command         | Description                |
|----------------|----------------------------|
| camera_capture | Take photo                 |
| screen_record  | Record screen              |
| location       | Get GPS location           |
| contacts_list  | List contacts              |
| calendar_events| Upcoming calendar events   |
| photos_recent  | Recent photos              |
| sms_send       | Send SMS                   |
| notify         | Show notification          |
| motion         | Motion/accelerometer data  |
