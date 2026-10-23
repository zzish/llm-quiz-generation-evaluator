// Purpose: install the resolve hook in `hooks.mjs` before the runner or the tests load (`node --import`).
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
