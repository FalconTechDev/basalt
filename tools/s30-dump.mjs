// dump slice items from the base bundle
import { loadBase } from "./app-base.mjs";
import { loadBundle } from "./split-app.mjs";
import fs from "node:fs";
const base = loadBase("ca5acac");
const { loadBundle } = await import("./split-app.mjs");
const b = loadBundle; // noop
