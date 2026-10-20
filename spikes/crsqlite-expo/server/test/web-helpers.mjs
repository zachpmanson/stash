import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
export async function waitFor(check) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(25);
  }
  throw new Error("Timed out waiting for isolated test state");
}
export async function launch(t) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "stash-web-test-"));
  const listener = createServer().listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const root = path.resolve(import.meta.dirname, "..");
  const child = spawn(
    process.execPath,
    process.env.STASH_TEST_SERVER_ENTRY
      ? [process.env.STASH_TEST_SERVER_ENTRY]
      : ["--import", "tsx", "src/server.ts"],
    {
      cwd: root,
      env: {
        ...process.env,
        DATA_DIR: tmp,
        SCHEMA_DIR: path.join(tmp, "schemas"),
        PORT: String(port),
        AUTH_USER: "web-test-owner",
        ENABLE_TEST_ENDPOINTS: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logs = "";
  child.stdout.on("data", (value) => {
    logs += value;
  });
  child.stderr.on("data", (value) => {
    logs += value;
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, "exit");
      child.kill("SIGTERM");
      const timeout = setTimeout(() => child.kill("SIGKILL"), 8000);
      const [code, signal] = await exit;
      clearTimeout(timeout);
      assert.equal(signal, null, logs);
      assert.equal(code, 0, logs);
    }
    await rm(tmp, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(async () => {
    if (child.exitCode !== null) throw new Error(logs);
    try {
      return (await fetch(`${base}/healthz`)).ok;
    } catch {
      return false;
    }
  });
  const api = async (url, method = "GET", body, extra = {}) =>
    fetch(`${base}/api${url}`, {
      method,
      headers: {
        "X-Auth-User": "web-test-owner",
        "X-Stash-Request": "1",
        "Content-Type": "application/json",
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const json = async (url, method = "GET", body) => {
    const res = await api(url, method, body);
    assert.equal(
      res.status,
      method === "POST" ? 201 : 200,
      await res.clone().text(),
    );
    return res.json();
  };
  return { base, port, api, json, tmp, child };
}
