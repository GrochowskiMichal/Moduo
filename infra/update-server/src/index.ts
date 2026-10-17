// Worker entry. The Workers runtime only accepts handlers as exports of the main module, so the
// logic (and its exported constants and types, which the tests use) lives in ./server.
import { type Env, handle } from "./server";

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
};
