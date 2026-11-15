#!/usr/bin/env node
/**
 * npm run demo: show the league the app from this computer, in one command
 * (docs/demo.md). No accounts, no keys and nothing to pay for.
 *
 * 1. Finds Postgres: Docker (its own container, kb-demo-postgres) or a local
 *    Homebrew server. Says how to install one when neither is there.
 * 2. Recreates the kb_demo database, migrates it and resets the demo league
 *    (npm run demo:reset), so the season is current and a game is live.
 * 3. Makes a production build, or reuses today's if nothing changed.
 * 4. Starts stripe-mock (the binary or Docker) when it can, so paying works.
 * 5. Starts the app in demo mode on a free port and opens the browser.
 *
 * It never reads .env.local. The demo's secrets are made on the first run
 * and kept in .demo/ (git ignores it); nothing is printed but the address.
 *
 *   npm run demo                 reuse today's build and data when they're fresh
 *   npm run demo -- --fresh      start over: new data and a new build
 *   npm run demo -- --no-open    don't open the browser
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildKey,
  databaseUrl,
  DEMO_DATABASE,
  DEMO_ROLE,
  demoEnv,
  demoSecrets,
  formatEnvFile,
  parseEnvFile,
  POSTGRES_IMAGE,
  STRIPE_MOCK_IMAGE,
} from "./demo-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stateDir = path.join(root, ".demo");
const secretsFile = path.join(stateDir, "env");
const stateFile = path.join(stateDir, "state.json");
const args = new Set(process.argv.slice(2));
const PG_CONTAINER = "kb-demo-postgres";
const STRIPE_CONTAINER = "kb-demo-stripe-mock";
const APP_PORT = 4100;
const PG_PORT = 55432;
const STRIPE_PORT = 12112;
/** Pages visited once after starting, so their first view in the demo is quick. */
const WARM_UP = [
  "/",
  "/seasons/fall-2026/schedule",
  "/seasons/fall-2026/standings",
  "/seasons/spring-2027",
  "/events",
  "/sign-in",
];

let step = 0;
const say = (line) => console.info(`\n[demo ${++step}] ${line}`);
const note = (line) => console.info(`         ${line}`);

function fail(lines) {
  console.error(["", ...lines, ""].join("\n"));
  process.exit(1);
}

/** Runs a command quietly; true when it worked. */
function ok(command, commandArgs, options = {}) {
  const r = spawnSync(command, commandArgs, {
    stdio: "ignore",
    timeout: options.timeout ?? 60_000,
    ...options,
  });
  return r.status === 0;
}

/** Runs a command and returns its output, or null. */
function output(command, commandArgs, options = {}) {
  const r = spawnSync(command, commandArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 30_000,
    ...options,
  });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** Runs a step in the foreground with its output shown; stops on failure. */
function run(command, commandArgs, env, what) {
  const r = spawnSync(command, commandArgs, {
    cwd: root,
    env,
    stdio: "inherit",
  });
  if (r.status !== 0) fail([`Could not ${what}. The output above says why.`]);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

async function freePort(preferred) {
  for (let port = preferred; port < preferred + 50; port++)
    if (await portFree(port)) return port;
  fail([`No free port near ${preferred}. Close something and try again.`]);
}

function answers(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function waitFor(check, seconds) {
  for (let i = 0; i < seconds * 2; i++) {
    if (await check()) return true;
    await sleep(500);
  }
  return false;
}

function loadSecrets() {
  mkdirSync(stateDir, { recursive: true });
  const saved = existsSync(secretsFile)
    ? parseEnvFile(readFileSync(secretsFile, "utf8"))
    : {};
  const secrets = demoSecrets(saved);
  writeFileSync(secretsFile, formatEnvFile(secrets), { mode: 0o600 });
  // A new database password: a container made with the old one can't be used.
  return { secrets, newPassword: !saved.PG_PASSWORD };
}

function loadState() {
  try {
    return JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    return {};
  }
}

const saveState = (state) =>
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);

const dockerRunning = () => ok("docker", ["info"], { timeout: 15_000 });

/** Postgres in Docker: the demo's own container, kept between runs. */
async function dockerPostgres(secrets, state, newPassword) {
  let exists = output("docker", [
    "ps",
    "-a",
    "--filter",
    `name=^${PG_CONTAINER}$`,
    "--format",
    "{{.Status}}",
  ]);
  if (exists && newPassword) {
    // The saved password is gone (.demo was deleted), so the old container
    // can't be signed in to: start a new one. It only ever held demo data.
    note(`Replacing ${PG_CONTAINER}: its password was not saved.`);
    ok("docker", ["rm", "-f", PG_CONTAINER]);
    exists = null;
  }
  let port = exists ? state.pgPort : undefined;
  if (!exists) {
    port = await freePort(PG_PORT);
    note(`Starting Postgres in Docker (${PG_CONTAINER}, ${POSTGRES_IMAGE}).`);
    note("The first time, Docker downloads the image.");
    const started = spawnSync(
      "docker",
      [
        "run",
        "-d",
        "--name",
        PG_CONTAINER,
        "-e",
        `POSTGRES_USER=${DEMO_ROLE}`,
        "-e",
        "POSTGRES_PASSWORD",
        "-e",
        "POSTGRES_DB=postgres",
        "-p",
        `127.0.0.1:${port}:5432`,
        POSTGRES_IMAGE,
      ],
      {
        // The password goes in through the environment, not the command line.
        env: { ...process.env, POSTGRES_PASSWORD: secrets.PG_PASSWORD },
        stdio: ["ignore", "ignore", "inherit"],
        timeout: 600_000,
      },
    );
    if (started.status !== 0)
      fail(["Could not start Postgres in Docker. The output above says why."]);
  } else if (!exists.startsWith("Up")) {
    ok("docker", ["start", PG_CONTAINER]);
  }
  port ??= Number(
    output("docker", ["port", PG_CONTAINER, "5432/tcp"])?.split(":").pop(),
  );
  const ready = await waitFor(
    () => ok("docker", ["exec", PG_CONTAINER, "pg_isready", "-U", DEMO_ROLE]),
    60,
  );
  if (!ready) fail(["Postgres in Docker did not start within a minute."]);
  const recreate = (sql) =>
    ok("docker", [
      "exec",
      PG_CONTAINER,
      "psql",
      "-U",
      DEMO_ROLE,
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ]);
  return {
    url: databaseUrl({
      host: "127.0.0.1",
      port,
      password: secrets.PG_PASSWORD,
    }),
    port,
    recreate: () =>
      recreate(`drop database if exists ${DEMO_DATABASE} with (force)`) &&
      recreate(`create database ${DEMO_DATABASE}`),
  };
}

/** A local Postgres (Homebrew, Postgres.app): the current user is its superuser. */
function localPostgres(secrets) {
  if (!ok("pg_isready", ["-q"], { timeout: 10_000 })) return null;
  const psql = (sql) =>
    ok("psql", ["-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-c", sql]);
  if (!psql("select 1")) return null;
  const password = secrets.PG_PASSWORD.replaceAll("'", "''");
  const role = `do $$ begin
    if not exists (select from pg_roles where rolname = '${DEMO_ROLE}') then
      create role ${DEMO_ROLE} login password '${password}';
    else
      alter role ${DEMO_ROLE} login password '${password}';
    end if;
  end $$`;
  if (!psql(role)) return null;
  const port = Number(output("psql", ["-d", "postgres", "-tAc", "show port"]));
  return {
    url: databaseUrl({
      host: "localhost",
      port,
      password: secrets.PG_PASSWORD,
    }),
    port,
    recreate: () =>
      psql(`drop database if exists ${DEMO_DATABASE} with (force)`) &&
      psql(`create database ${DEMO_DATABASE} owner ${DEMO_ROLE}`),
  };
}

async function findPostgres(secrets, state, newPassword) {
  if (dockerRunning()) return dockerPostgres(secrets, state, newPassword);
  const local = localPostgres(secrets);
  if (local) return local;
  return fail([
    "The demo needs Postgres on this computer, and none is running.",
    "Install one of these, start it, and run `npm run demo` again:",
    "",
    "  Docker Desktop: https://www.docker.com/products/docker-desktop/",
    "    (the demo then runs Postgres and stripe-mock in it by itself)",
    "",
    "  Homebrew Postgres (macOS):",
    "    brew install postgresql@18",
    "    brew services start postgresql@18",
  ]);
}

/** stripe-mock, so paying works: the binary if installed, else Docker. */
async function startStripeMock(docker) {
  const port = await freePort(STRIPE_PORT);
  let stop = () => {};
  if (ok("stripe-mock", ["-version"], { timeout: 10_000 })) {
    const child = spawn("stripe-mock", ["-http-port", String(port)], {
      stdio: "ignore",
    });
    stop = () => child.kill();
  } else if (docker) {
    ok("docker", ["rm", "-f", STRIPE_CONTAINER]);
    const started = ok(
      "docker",
      [
        "run",
        "-d",
        "--rm",
        "--name",
        STRIPE_CONTAINER,
        "-p",
        `127.0.0.1:${port}:12111`,
        STRIPE_MOCK_IMAGE,
      ],
      { timeout: 600_000 },
    );
    if (!started) return null;
    stop = () => ok("docker", ["stop", STRIPE_CONTAINER]);
  } else {
    return null;
  }
  if (!(await waitFor(() => answers(port), 30))) {
    stop();
    return null;
  }
  return { url: `http://localhost:${port}`, stop };
}

function openBrowser(url) {
  const [command, commandArgs] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  spawn(command, commandArgs, { stdio: "ignore", detached: true }).unref();
}

async function main() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22)
    fail([`The demo needs Node.js 22 or newer (this is ${process.version}).`]);

  if (!existsSync(path.join(root, "node_modules", ".bin", "next"))) {
    say("Installing the app's packages (first run only)");
    run(
      npm,
      ["ci", "--no-audit", "--no-fund"],
      process.env,
      "install packages",
    );
  }

  const { secrets, newPassword } = loadSecrets();
  const state = loadState();

  say("Finding Postgres");
  const pg = await findPostgres(secrets, state, newPassword);
  note(`Using the ${DEMO_DATABASE} database on port ${pg.port}.`);

  const docker = dockerRunning();
  say("Starting stripe-mock for payments");
  const stripe = await startStripeMock(docker);
  if (stripe) note("Payments go through the demo's checkout page.");
  else {
    note("stripe-mock isn't available, so paying shows a demo-payment notice.");
    note(
      "For the checkout too: brew install stripe/stripe-mock/stripe-mock, or start Docker.",
    );
  }

  const port =
    state.appPort && (await portFree(state.appPort))
      ? state.appPort
      : await freePort(APP_PORT);
  const env = demoEnv({
    shell: process.env,
    secrets,
    databaseUrl: pg.url,
    port,
    stripeMockUrl: stripe?.url ?? null,
  });
  const key = buildKey({
    commit: output("git", ["rev-parse", "HEAD"], { cwd: root }) ?? "",
    changes:
      output("git", ["status", "--porcelain", "--", ".", ":!.demo"], {
        cwd: root,
      }) ?? "",
    day: new Date().toLocaleDateString("en-CA", {
      timeZone: "America/New_York",
    }),
    port,
    database: pg.url,
  });
  const buildId = path.join(root, ".next", "BUILD_ID");
  const builtId = existsSync(buildId) ? readFileSync(buildId, "utf8") : null;
  const fresh =
    !args.has("--fresh") &&
    state.key === key &&
    builtId !== null &&
    state.buildId === builtId;

  if (fresh) {
    say(
      "Reusing today's build and demo data (npm run demo -- --fresh starts over)",
    );
  } else {
    say(`Creating the ${DEMO_DATABASE} database`);
    if (!pg.recreate())
      fail([`Could not recreate the ${DEMO_DATABASE} database.`]);
    say("Migrating it");
    run(npm, ["run", "--silent", "db:migrate"], env, "migrate the database");
    say("Filling it with the demo league");
    run(npm, ["run", "--silent", "demo:reset"], env, "reset the demo data");
    say("Building the app (a few minutes)");
    run(npm, ["run", "--silent", "build"], env, "build the app");
    saveState({
      key,
      buildId: readFileSync(buildId, "utf8"),
      appPort: port,
      pgPort: pg.port,
    });
  }

  say("Starting the app");
  const server = spawn(
    path.join(root, "node_modules", ".bin", "next"),
    ["start", "--port", String(port)],
    { cwd: root, env, stdio: ["ignore", "inherit", "inherit"] },
  );
  const stopAll = () => {
    server.kill();
    stripe?.stop();
  };
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      stopAll();
      process.exit(0);
    });
  server.on("exit", (code) => {
    stripe?.stop();
    if (code) process.exit(code);
  });

  if (!(await waitFor(() => answers(port), 60)))
    fail(["The app did not start within a minute. The output above says why."]);
  const url = `http://localhost:${port}`;
  // The first visit to a page after starting loads its code and fills its
  // caches; do that now, so nothing is slow in front of the league.
  note("Warming up the pages.");
  for (const page of WARM_UP)
    await fetch(`${url}${page}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    }).catch(() => undefined);
  console.info(
    [
      "",
      `  The demo is running at ${url}`,
      "",
      "  Tap Player, Captain, Ref or Admin in the yellow banner to see the app as each.",
      "  The walkthrough is in docs/demo.md. Press Ctrl+C to stop.",
      docker
        ? `  Postgres keeps running in Docker (${PG_CONTAINER}); docker stop ${PG_CONTAINER} stops it.`
        : "",
      "",
    ].join("\n"),
  );
  if (!args.has("--no-open")) openBrowser(url);
}

await main();
