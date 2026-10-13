// Next.js calls onRequestError for every server-side failure (page render, route
// handler, server action). One structured line per failure goes to the platform
// logs (Vercel Runtime Logs; search the digest the person saw), and to
// ERROR_WEBHOOK_URL if configured. See lib/error-report.ts.
import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { buildErrorReport, forwardErrorReport } = await import("@/lib/error-report");
  const report = buildErrorReport(err, { path: request.path, method: request.method }, { routePath: context.routePath });
  console.error(JSON.stringify(report));
  await forwardErrorReport(report);
};
