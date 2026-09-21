import { tasks } from "@trigger.dev/sdk";
import * as Sentry from "@sentry/node";

// Initialize Sentry for the Trigger.dev runtime
Sentry.init({
  defaultIntegrations: false,
  // The Data Source Name (DSN) is a unique identifier for your Sentry project.
  dsn:
    process.env.SENTRY_DSN ??
    "https://823c7538ac0e5e4e897b0933bfc0eaf4@o4511411455262720.ingest.us.sentry.io/4511724384354304",
  environment:
    process.env.NODE_ENV === "production" ? "production" : "development",
});

// Register a global onFailure hook to capture task errors
tasks.onFailure(({ payload, error, ctx }) => {
  Sentry.captureException(error, {
    extra: {
      payload,
      ctx,
    },
  });
});
