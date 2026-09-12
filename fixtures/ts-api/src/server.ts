/** Entry point. Importing the route modules is what registers them. */

import "./checkout/create.ts";
import { dispatch } from "./router.ts";

const PORT = Number(process.env.PORT ?? 3000);

export function start(): void {
  console.log(`checkout-api listening on ${PORT}`);
  console.log(dispatch("GET", "/checkout/cs_000001"));
}

if (process.argv[1]?.endsWith("server.ts")) start();
