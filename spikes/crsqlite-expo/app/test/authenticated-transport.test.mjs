import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const packageEntry = require.resolve("@vlcn.io/ws-client");
const transportPath = path.join(path.dirname(packageEntry), "transport/WebSocketTransport.js");
const { default: WebSocketTransport } = await import(pathToFileURL(transportPath));

class FakeWebSocket extends EventTarget {
  static CLOSED = 3;
  static OPEN = 1;
  static lastArgs;

  readyState = 0;
  bufferedAmount = 0;

  constructor(...args) {
    super();
    FakeWebSocket.lastArgs = args;
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }

  send() {}
}

test("WebSocket transport supplies Basic auth as a handshake header", () => {
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  const transport = new WebSocketTransport({
    url: "wss://stash.zachmanson.com/sync",
    room: "stash-spike.sqlite",
    headers: { Authorization: "Basic test-only" },
  });

  try {
    transport.start(() => {});
    assert.equal(FakeWebSocket.lastArgs[0], "wss://stash.zachmanson.com/sync");
    assert.deepEqual(FakeWebSocket.lastArgs[2], { headers: { Authorization: "Basic test-only" } });
    transport.close();
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});
