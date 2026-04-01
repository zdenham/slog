import { spawn } from "bun";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// SLOG_BIN env var: path to compiled binary. If unset, runs via `bun src/cli.ts`.
const SLOG_BIN = process.env.SLOG_BIN;

function slogCommand(): string[] {
  if (SLOG_BIN) {
    return [SLOG_BIN];
  }
  return ["bun", join(import.meta.dir, "..", "src", "cli.ts")];
}

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function spawnSlog(...args: string[]): Promise<SpawnResult> {
  const cmd = [...slogCommand(), ...args];
  const proc = spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}

export interface IsolatedServer {
  port: number;
  dbPath: string;
  pidPath: string;
  tmpDir: string;
  cleanup: () => Promise<void>;
}

export async function startIsolatedServer(): Promise<IsolatedServer> {
  const tmpDir = mkdtempSync(join(tmpdir(), "slog-test-"));
  const dbPath = join(tmpDir, "test.db");
  const pidPath = join(tmpDir, "test.pid");
  const port = 10000 + Math.floor(Math.random() * 50000);

  // Start server as daemon
  const result = await spawnSlog(
    "serve",
    "--port", String(port),
    "--db", dbPath,
    "--pidfile", pidPath
  );

  if (result.exitCode !== 0) {
    throw new Error(`Failed to start server: ${result.stderr || result.stdout}`);
  }

  // Wait for health check
  const maxWait = 5000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/health`);
      if (resp.ok) {
        return {
          port,
          dbPath,
          pidPath,
          tmpDir,
          cleanup: async () => {
            // Read pid and kill
            try {
              const pidData = JSON.parse(
                await Bun.file(pidPath).text()
              );
              process.kill(pidData.pid, "SIGTERM");
              // Wait for process to exit
              await Bun.sleep(200);
            } catch {}
            try {
              rmSync(tmpDir, { recursive: true, force: true });
            } catch {}
          },
        };
      }
    } catch {
      await Bun.sleep(100);
    }
  }

  throw new Error("Server health check timed out");
}

export async function postLog(
  port: number,
  body: unknown
): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
