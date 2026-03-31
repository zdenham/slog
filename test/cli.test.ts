import { describe, test, expect, afterAll } from "bun:test";
import { spawnSlog, startIsolatedServer, postLog, type IsolatedServer } from "./helpers.ts";
import { readFileSync, existsSync } from "fs";
import { Database } from "bun:sqlite";

// Track servers for cleanup
const servers: IsolatedServer[] = [];
afterAll(async () => {
  for (const s of servers) {
    await s.cleanup();
  }
});

async function withServer(fn: (server: IsolatedServer) => Promise<void>) {
  const server = await startIsolatedServer();
  servers.push(server);
  await fn(server);
}

describe("slog serve", () => {
  test("starts server, writes pidfile", async () => {
    await withServer(async (server) => {
      expect(existsSync(server.pidPath)).toBe(true);
      const pidData = JSON.parse(readFileSync(server.pidPath, "utf-8"));
      expect(pidData.pid).toBeGreaterThan(0);
      expect(pidData.port).toBe(server.port);
      expect(pidData.db).toBe(server.dbPath);
    });
  });

  test("health endpoint returns ok", async () => {
    await withServer(async (server) => {
      const resp = await fetch(`http://127.0.0.1:${server.port}/health`);
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body).toEqual({ ok: true });
    });
  });

  test("idempotent — second serve exits 0", async () => {
    await withServer(async (server) => {
      const result = await spawnSlog(
        "serve",
        "--port", String(server.port),
        "--db", server.dbPath,
        "--pidfile", server.pidPath
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("already running");
    });
  });

  test("server shuts down on SIGTERM, pidfile removed", async () => {
    const server = await startIsolatedServer();
    const pidData = JSON.parse(readFileSync(server.pidPath, "utf-8"));

    process.kill(pidData.pid, "SIGTERM");
    await Bun.sleep(500);

    expect(existsSync(server.pidPath)).toBe(false);

    // Clean up tmpdir manually since server is dead
    const { rmSync } = await import("fs");
    try { rmSync(server.tmpDir, { recursive: true, force: true }); } catch {}
  });
});

describe("slog status", () => {
  test("with running server: exits 0, prints info", async () => {
    await withServer(async (server) => {
      const result = await spawnSlog("status", "--pidfile", server.pidPath);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("port:");
      expect(result.stdout).toContain("pid:");
    });
  });

  test("--port flag prints only port number", async () => {
    await withServer(async (server) => {
      const result = await spawnSlog("status", "--pidfile", server.pidPath, "--port");
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe(String(server.port));
    });
  });

  test("no server: exits 1", async () => {
    const result = await spawnSlog("status", "--pidfile", "/tmp/slog-nonexistent.pid");
    expect(result.exitCode).toBe(1);
  });
});

describe("POST /log ingestion", () => {
  test("single log object → 1 event + props", async () => {
    await withServer(async (server) => {
      const resp = await postLog(server.port, {
        message: "test event",
        level: "info",
        source: "test",
      });
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body).toEqual({ ingested: 1 });

      // Verify in DB
      const db = new Database(server.dbPath, { readonly: true });
      const events = db.prepare("SELECT * FROM log_events").all() as any[];
      expect(events).toHaveLength(1);
      expect(events[0].event).toBe("test event");

      const props = db.prepare("SELECT * FROM log_props ORDER BY key").all() as any[];
      expect(props).toHaveLength(2);
      expect(props[0].key).toBe("level");
      expect(props[0].value_string).toBe("info");
      expect(props[1].key).toBe("source");
      expect(props[1].value_string).toBe("test");
      db.close();
    });
  });

  test("batch array → correct count", async () => {
    await withServer(async (server) => {
      const resp = await postLog(server.port, [
        { message: "first" },
        { message: "second" },
        { message: "third" },
      ]);
      const body = await resp.json();
      expect(body).toEqual({ ingested: 3 });

      const db = new Database(server.dbPath, { readonly: true });
      const count = db.prepare("SELECT count(*) as c FROM log_events").get() as any;
      expect(count.c).toBe(3);
      db.close();
    });
  });

  test("properties typed correctly", async () => {
    await withServer(async (server) => {
      await postLog(server.port, {
        message: "typed test",
        strProp: "hello",
        numProp: 42,
        boolProp: true,
      });

      const db = new Database(server.dbPath, { readonly: true });
      const props = db.prepare("SELECT * FROM log_props ORDER BY key").all() as any[];

      const boolProp = props.find((p: any) => p.key === "boolProp");
      expect(boolProp.value_bool).toBe(1);
      expect(boolProp.value_string).toBeNull();
      expect(boolProp.value_number).toBeNull();

      const numProp = props.find((p: any) => p.key === "numProp");
      expect(numProp.value_number).toBe(42);
      expect(numProp.value_string).toBeNull();

      const strProp = props.find((p: any) => p.key === "strProp");
      expect(strProp.value_string).toBe("hello");
      expect(strProp.value_number).toBeNull();
      db.close();
    });
  });

  test("nested objects flattened with dot notation", async () => {
    await withServer(async (server) => {
      await postLog(server.port, {
        message: "nested test",
        http: { status: 500, method: "GET" },
      });

      const db = new Database(server.dbPath, { readonly: true });
      const props = db.prepare("SELECT * FROM log_props ORDER BY key").all() as any[];

      const statusProp = props.find((p: any) => p.key === "http.status");
      expect(statusProp).toBeTruthy();
      expect(statusProp.value_number).toBe(500);

      const methodProp = props.find((p: any) => p.key === "http.method");
      expect(methodProp).toBeTruthy();
      expect(methodProp.value_string).toBe("GET");
      db.close();
    });
  });

  test("missing message → 400", async () => {
    await withServer(async (server) => {
      const resp = await postLog(server.port, { level: "info" });
      expect(resp.status).toBe(400);
    });
  });

  test("malformed JSON → 400", async () => {
    await withServer(async (server) => {
      const resp = await fetch(`http://127.0.0.1:${server.port}/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json{{{",
      });
      expect(resp.status).toBe(400);
    });
  });
});

describe("slog query", () => {
  test("no args returns recent logs", async () => {
    await withServer(async (server) => {
      await postLog(server.port, { message: "query test", level: "info" });

      const result = await spawnSlog("query", "--db", server.dbPath);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("query test");
    });
  });

  test("custom SQL works", async () => {
    await withServer(async (server) => {
      await postLog(server.port, { message: "custom sql test" });

      const result = await spawnSlog(
        "query", "--db", server.dbPath,
        "SELECT event FROM log_events"
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("custom sql test");
    });
  });

  test("SQL syntax error → stderr, non-zero exit", async () => {
    await withServer(async (server) => {
      await postLog(server.port, { message: "x" });

      const result = await spawnSlog(
        "query", "--db", server.dbPath,
        "SELECTBAD FROM nothing"
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.length).toBeGreaterThan(0);
    });
  });

  test("query with property JOIN filters correctly", async () => {
    await withServer(async (server) => {
      await postLog(server.port, [
        { message: "error event", level: "error" },
        { message: "info event", level: "info" },
      ]);

      const result = await spawnSlog(
        "query", "--db", server.dbPath,
        "SELECT e.event FROM log_events e JOIN log_props p ON e.event_id = p.event_id WHERE p.key = 'level' AND p.value_string = 'error'"
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("error event");
      expect(result.stdout).not.toContain("info event");
    });
  });
});

describe("slog tail", () => {
  test("shows recent logs", async () => {
    await withServer(async (server) => {
      await postLog(server.port, { message: "tail test event" });

      const result = await spawnSlog("tail", "--db", server.dbPath);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("tail test event");
    });
  });
});

describe("slog clear", () => {
  test("--yes deletes all events and props", async () => {
    await withServer(async (server) => {
      await postLog(server.port, { message: "to be cleared", level: "info" });

      const result = await spawnSlog("clear", "--db", server.dbPath, "--yes");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("cleared");

      // Verify empty
      const db = new Database(server.dbPath, { readonly: true });
      const count = db.prepare("SELECT count(*) as c FROM log_events").get() as any;
      expect(count.c).toBe(0);
      const propCount = db.prepare("SELECT count(*) as c FROM log_props").get() as any;
      expect(propCount.c).toBe(0);
      db.close();
    });
  });

  test("without --yes does not delete", async () => {
    await withServer(async (server) => {
      await postLog(server.port, { message: "should survive" });

      const result = await spawnSlog("clear", "--db", server.dbPath);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("--yes");

      // Verify data still there
      const db = new Database(server.dbPath, { readonly: true });
      const count = db.prepare("SELECT count(*) as c FROM log_events").get() as any;
      expect(count.c).toBe(1);
      db.close();
    });
  });
});
