#!/usr/bin/env node
// Basalt command line: vault, boards, the running app, automation. Zero dependencies (Node 20+).
import { main } from "./lib/cli.mjs";
import "./commands/vault.mjs";
import "./commands/board.mjs";
import "./commands/app.mjs";
import "./commands/auto.mjs";
import "./commands/core.mjs";

main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
