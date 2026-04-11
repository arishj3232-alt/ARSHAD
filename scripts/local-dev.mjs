import { spawn } from "node:child_process";

const procs = [];

function run(name, command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    shell: true,
    env: { ...process.env, ...env },
    stdio: "pipe",
  });

  child.stdout.on("data", (buf) => {
    process.stdout.write(`[${name}] ${buf}`);
  });
  child.stderr.on("data", (buf) => {
    process.stderr.write(`[${name}] ${buf}`);
  });
  child.on("exit", (code) => {
    process.stdout.write(`[${name}] exited with code ${code ?? 0}\n`);
  });

  procs.push(child);
}

run("frontend", "pnpm", ["--filter", "@workspace/only-two", "run", "dev"], {
  PORT: process.env.FRONTEND_PORT ?? "8080",
});

function shutdown(signal) {
  process.stdout.write(`\nReceived ${signal}, stopping services...\n`);
  for (const p of procs) {
    try {
      p.kill("SIGTERM");
    } catch {}
  }
  setTimeout(() => process.exit(0), 300);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
