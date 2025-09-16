import { use } from "chai";

if (process.env.CHAINSHOT_ENABLED === "true") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { chainShotPlugin } = require("@cloudwalk/chainshot");
  use(chainShotPlugin());
}
