// Preloaded into every process the demo starts (NODE_OPTIONS=--require).
// Makes the project's `.env*` files look missing, so the league's real keys
// in `.env.local` cannot reach the demo. Next.js ignores its own
// `__NEXT_PROCESSED_ENV` guard when a build reloads its env, so the files are
// hidden at the file-system level instead. `.env.example` stays readable.
const fs = require("node:fs");
const path = require("node:path");

const hidden = (target) => {
  if (typeof target !== "string" && !(target instanceof URL)) return false;
  const name = path.basename(
    String(target instanceof URL ? target.pathname : target),
  );
  return /^\.env(\..+)?$/.test(name) && name !== ".env.example";
};
const missing = (target, syscall) =>
  Object.assign(
    new Error(`ENOENT: no such file or directory, ${syscall} '${target}'`),
    {
      code: "ENOENT",
      errno: -2,
      syscall,
      path: String(target),
    },
  );

for (const name of [
  "statSync",
  "lstatSync",
  "readFileSync",
  "openSync",
  "accessSync",
]) {
  const original = fs[name];
  fs[name] = function (target, ...rest) {
    if (hidden(target)) {
      if (rest.at(-1)?.throwIfNoEntry === false) return undefined;
      throw missing(target, name.replace("Sync", ""));
    }
    return original.call(this, target, ...rest);
  };
}
const exists = fs.existsSync;
fs.existsSync = (target) => !hidden(target) && exists(target);
for (const name of ["readFile", "stat", "lstat", "access", "open"]) {
  const original = fs.promises[name];
  fs.promises[name] = (target, ...rest) =>
    hidden(target)
      ? Promise.reject(missing(target, name))
      : original(target, ...rest);
}
process.loadEnvFile = (target = ".env") => {
  if (hidden(target)) throw missing(target, "open");
};
