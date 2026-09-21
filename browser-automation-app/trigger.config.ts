import { defineConfig } from "@trigger.dev/sdk";
import { esbuildPlugin } from "@trigger.dev/build/extensions";
import { additionalFiles } from "@trigger.dev/build/extensions/core";
import sentryEsbuildPlugin from "@sentry/esbuild-plugin";

export default defineConfig({
  project: "proj_ufvkwhgsisoeulmspcci",
  runtime: "node",
  legacyDevProcessCwdBehaviour: false,
  logLevel: "log",

  // The max compute seconds a task is allowed to run.
  // You can override this on an individual task.
  maxDuration: 3600,

  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },

  dirs: ["features"],

  build: {
    extensions: [
      additionalFiles({
        files: [
          "./node_modules/@browserbasehq/stagehand/dist/assets/stagehand-extension.zip",
        ],
      }),

      esbuildPlugin(
        sentryEsbuildPlugin({
          org: "enra-r3",
          project: "BrowserMind",
          authToken: process.env.SENTRY_AUTH_TOKEN,
        }),
        {
          placement: "last",
          target: "deploy",
        }
      ),
    ],
  },
});
