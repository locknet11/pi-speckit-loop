import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSddLoop } from "./command.js";

export default function (pi: ExtensionAPI): void {
  registerSddLoop(pi);
}