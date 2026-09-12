/** A minimal router, so the fixture has real route registrations and no dependencies. */

export type Handler = (request: RouteRequest) => RouteResponse;

export interface RouteRequest {
  params: Record<string, string>;
  body: unknown;
}

export interface RouteResponse {
  status: number;
  body: unknown;
}

interface Route {
  method: string;
  path: string;
  handler: Handler;
}

const routes: Route[] = [];

export const router = {
  get(path: string, handler: Handler): void {
    routes.push({ method: "GET", path, handler });
  },
  post(path: string, handler: Handler): void {
    routes.push({ method: "POST", path, handler });
  },
};

export function dispatch(method: string, path: string, body: unknown = null): RouteResponse {
  for (const route of routes) {
    const params = matchPath(route.path, path);
    if (route.method === method && params) return route.handler({ params, body });
  }
  return { status: 404, body: { error: "not found" } };
}

function matchPath(pattern: string, actual: string): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const actualParts = actual.split("/").filter(Boolean);
  if (patternParts.length !== actualParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i] ?? "";
    const a = actualParts[i] ?? "";
    if (p.startsWith(":")) params[p.slice(1)] = a;
    else if (p !== a) return null;
  }
  return params;
}
