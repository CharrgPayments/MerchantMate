import 'dotenv/config';
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

const app = express();
app.use(express.json({ limit: '10mb' })); // Increase limit for image uploads
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  // Epic F — start compliance background tickers (SLA scan, retention archival,
  // scheduled reports, schema drift detection). No-op on import side effects;
  // setInterval handles are owned by complianceJobs module.
  const { startComplianceJobs } = await import("./complianceJobs");
  startComplianceJobs();

  // Task #27 — Mirror the underwriting pipeline as Workflow Definitions so
  // the Workflows admin shows it natively. Idempotent; the orchestrator
  // continues to run off the in-code PHASES catalogue.
  try {
    const { seedUnderwritingWorkflows } = await import("./scripts/seedUnderwritingWorkflows");
    const result = await seedUnderwritingWorkflows();
    log(`underwriting workflows seeded (defs=${result.upsertedDefinitions}, endpoints=${result.upsertedEndpoints})`);
  } catch (err) {
    console.error("[seed] underwriting workflows failed:", err);
  }

  // Task #28 — Backfill workflow_tickets / workflow_ticket_stages for
  // existing prospect_applications so the unified Worklist UI surfaces
  // historical underwriting work. Idempotent on every boot.
  try {
    const { backfillUnderwritingTickets } = await import("./scripts/backfillUnderwritingTickets");
    const r = await backfillUnderwritingTickets();
    log(`underwriting tickets backfilled (apps=${r.applicationsScanned}, tickets=${r.ticketsEnsured}, stages=${r.stagesUpserted}, failures=${r.failures})`);
  } catch (err) {
    console.error("[backfill] underwriting tickets failed:", err);
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if ((process.env.NODE_ENV ?? "development").trim() === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on port 5000
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = 5000;
  const listenOptions: any = { port, host: "0.0.0.0" };
  if (process.platform !== "win32") listenOptions.reusePort = true;
  server.listen(listenOptions, () => {
    log(`serving on port ${port}`);
  });
})();
