/**
 * Site-wide HTTP basic auth. The programme data includes the BFI's
 * copyrighted write-ups and images, so the site must never be publicly
 * readable. Credentials: user "lff", password from the LFF_PASSWORD
 * environment variable (set in the Netlify site config). Fails closed if
 * the variable is missing.
 */
export default async (request: Request): Promise<Response | undefined> => {
  const password = Deno.env.get("LFF_PASSWORD");
  const unauthorized = (message: string) =>
    new Response(message, {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="LFF Planner", charset="UTF-8"' },
    });

  if (!password) return new Response("LFF_PASSWORD is not configured", { status: 503 });

  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Basic ")) return unauthorized("Authentication required");
  let decoded = "";
  try {
    decoded = atob(header.slice(6));
  } catch {
    return unauthorized("Malformed credentials");
  }
  const expected = `lff:${password}`;
  // Constant-time-ish comparison; timing is not a real concern for this site,
  // but there's no reason to leak lengths early either.
  if (decoded.length !== expected.length) return unauthorized("Wrong credentials");
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= decoded.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return unauthorized("Wrong credentials");
  return undefined; // fall through to the static asset
};

export const config = { path: "/*" };
