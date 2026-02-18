import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

type ServiceName = "web" | "worker";

type ServiceConfig = {
  name: ServiceName;
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
};

const webPort = Number.parseInt(process.env.PORT ?? "3000", 10);
const normalizedWebPort = Number.isFinite(webPort) ? webPort : 3000;
const workerPort = Number.parseInt(process.env.SURFACES_WORKER_PORT ?? "3400", 10);
const normalizedWorkerPort = Number.isFinite(workerPort) ? workerPort : 3400;

const services: ServiceConfig[] = [
  {
    name: "web",
    command: "bun",
    args: ["run", "start:web"],
    env: {
      ...process.env,
      PORT: String(normalizedWebPort),
    },
  },
  {
    name: "worker",
    command: "bun",
    args: ["run", "worker"],
    env: {
      ...process.env,
      SURFACES_WORKER_PORT: String(normalizedWorkerPort),
      CORE_BASE_URL:
        process.env.CORE_BASE_URL ?? `http://127.0.0.1:${normalizedWebPort}`,
      BRAIN_API_URL:
        process.env.BRAIN_API_URL ??
        `${process.env.CORE_BASE_URL ?? `http://127.0.0.1:${normalizedWebPort}`}/api/surfaces/inbound`,
    },
  },
];

const running = new Map<ServiceName, ChildProcessWithoutNullStreams>();
let shuttingDown = false;

function log(service: ServiceName, message: string): void {
  const now = new Date().toISOString();
  console.log(`[${now}][${service}] ${message}`);
}

function stopAll(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const [name, child] of running.entries()) {
    log(name, `stopping (${signal})`);
    try {
      child.kill(signal);
    } catch {
      // no-op
    }
  }
}

for (const service of services) {
  const child = spawn(service.command, service.args, {
    env: service.env,
    stdio: "pipe",
  });
  running.set(service.name, child);

  log(service.name, `started pid=${child.pid ?? "unknown"}`);

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[${service.name}] ${chunk.toString()}`);
  });

  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${service.name}] ${chunk.toString()}`);
  });

  child.on("exit", (code, signal) => {
    running.delete(service.name);
    log(service.name, `exited code=${code ?? "null"} signal=${signal ?? "null"}`);

    if (!shuttingDown) {
      shuttingDown = true;
      for (const [otherName, otherChild] of running.entries()) {
        log(otherName, `stopping because ${service.name} exited`);
        try {
          otherChild.kill("SIGTERM");
        } catch {
          // no-op
        }
      }
      const exitCode = code ?? 1;
      process.exit(exitCode === 0 ? 1 : exitCode);
    }

    if (running.size === 0) {
      process.exit(code ?? 0);
    }
  });

  child.on("error", (error) => {
    log(service.name, `spawn error: ${error instanceof Error ? error.message : String(error)}`);
  });
}

process.on("SIGINT", () => stopAll("SIGINT"));
process.on("SIGTERM", () => stopAll("SIGTERM"));
