import handler from "vinext/server/fetch-handler";
import { runWithExecutionContext } from "vinext/shims/request-context";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

const worker = {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    const response = await runWithExecutionContext<Response>(ctx, () => runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx)));
    const pathname = new URL(request.url).pathname.replace(/\/+$/, '');
    const headers = new Headers(response.headers);
    // Public artwork may live on another host. Avoid sending the reader's
    // current page URL along with those image requests.
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set('X-Content-Type-Options', 'nosniff');
    if (headers.get('Content-Type')?.includes('text/html')) {
      // The app has no embedded-account flow. Prevent a third-party frame from
      // disguising account, publication, or library controls as another page.
      headers.set('X-Frame-Options', 'DENY');
      headers.append('Content-Security-Policy', "frame-ancestors 'none'");
    }
    if (['/connect/hardcover', '/signin', '/account', '/forgot-password', '/reset-password'].includes(pathname) || pathname.startsWith('/api/auth/') || pathname.startsWith('/api/account/')) {
      headers.set('Referrer-Policy', 'no-referrer');
      headers.set('Cache-Control', 'private, no-store');
      headers.set('X-Robots-Tag', 'noindex, nofollow');
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};

export default worker;
