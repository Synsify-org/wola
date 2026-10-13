import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, siteOrigin } from "@/lib/site";

// llms.txt (https://llmstxt.org): a short, plain-text description for AI
// assistants. Wola is private software, so this says what it is and what is NOT
// available to crawl — it does not list any internal pages.
export async function GET() {
  const origin = await siteOrigin();
  const body = `# ${SITE_NAME}

> ${SITE_TAGLINE}. ${SITE_DESCRIPTION}

${SITE_NAME} is a multi-tenant web application. Each organisation has its own
address and its own private data; access requires an account issued by that
organisation's administrator.

## Public
- [Sign in](${origin}/login): the only public page.

## Not available to crawlers
Loan applications, repayment schedules, employee records and the audit trail
are confidential and sit behind sign-in. They are excluded in robots.txt and
marked noindex.
`;
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
