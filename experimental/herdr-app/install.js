#!/usr/bin/env node
// Installs bakers into the Herdr app: the bakers mod, the bakers layout and its tab bar, made from Herdr's `main`
// (or the layout --from names), and the cmd-shift-b key.
// Usage: node experimental/herdr-app/install.js [--dry-run] [--from <layout>]
// Run it again after a Herdr update. A layout or keys.json it replaces is kept as .bak-<time>.
import { cpSync, existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bakersLayout, bakersTabs, findNode, withKey } from "./lib/install.js";

const dry = process.argv.includes("--dry-run");
const fromAt = process.argv.indexOf("--from");
const from = fromAt > 0 ? process.argv[fromAt + 1] : "main";
const here = dirname(fileURLToPath(import.meta.url));
const home = process.env.HERDR_APP_HOME ?? join(homedir(), ".config", "herdr-app");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const KEY = "cmd-shift-b", ACTION = "mod.open:bakers";
const GENERATED = new Set(["gpui-kit.d.ts", "jsconfig.json"]);

const say = (line) => console.log(`${dry ? "[dry run] " : ""}${line}`);
const mod = (name) => join(home, "mods", name);

function fail(line) {
  console.error(line);
  process.exit(1);
}

function write(path, text) {
  if (existsSync(path) && readFileSync(path, "utf8") === text) return say(`unchanged ${path}`);
  if (existsSync(path)) say(`back up ${path} as ${path}.bak-${stamp}`);
  if (existsSync(path) && !dry) copyFileSync(path, `${path}.bak-${stamp}`);
  say(`write ${path}`);
  if (!dry) writeFileSync(path, text);
}

function copyMod(source, name) {
  say(`copy ${source} to ${mod(name)}`);
  if (!dry) cpSync(source, mod(name), { recursive: true, filter: (src) => !GENERATED.has(src.split("/").pop()) });
}

function herdr(args) {
  try {
    return { ok: true, out: execFileSync("herdr-app", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) {
    return { ok: false, out: String(e.stderr || e.stdout || e.message) };
  }
}

if (!/^[\w-]+$/.test(from ?? "") || from === "bakers") fail("--from takes the name of another layout in Herdr's layouts folder, e.g. --from my-layout");
const basePath = join(home, "layouts", `${from}.json`);
if (!existsSync(basePath)) fail(`No ${basePath}: open the Herdr app once, or name another layout with --from.`);

const base = JSON.parse(readFileSync(basePath, "utf8"));
const layout = bakersLayout(base, process.platform);
const tabs = findNode(base, "tabs").content.mod;
const tabBar = bakersTabs(readFileSync(join(mod(tabs), "main.js"), "utf8"));

copyMod(join(here, "mods", "bakers"), "bakers");
copyMod(mod(tabs), "bakers-tabs");
say(`add Ticket and Tickets to ${mod("bakers-tabs")}/main.js`);
if (!dry) writeFileSync(join(mod("bakers-tabs"), "main.js"), tabBar);
write(join(home, "layouts", "bakers.json"), `${JSON.stringify(layout, null, 2)}\n`);

const keysPath = join(home, "keys.json");
const keys = withKey(existsSync(keysPath) ? JSON.parse(readFileSync(keysPath, "utf8")) : {}, KEY, ACTION);
if (keys.added) write(keysPath, `${JSON.stringify(keys.keys, null, 2)}\n`);
else say(`key ${KEY}: ${keys.reason === "already set" ? `already ${ACTION}` : `${keys.reason}; bind ${ACTION} to a key of your choice`}`);

if (dry) process.exit(0);
for (const name of ["bakers", "bakers-tabs"]) {
  const check = herdr(["check", mod(name)]);
  console.log(check.out.trim() || `check ${check.ok ? "passed" : "failed"}: ${name}`);
  if (!check.ok) process.exit(1);
}
const swap = herdr(["do", "layout.switch", JSON.stringify({ name: "bakers" })]);
say(swap.ok ? "switched to the bakers layout (ctrl-shift-l cycles layouts)" : "open the Herdr app and pick the bakers layout with ctrl-shift-l");
