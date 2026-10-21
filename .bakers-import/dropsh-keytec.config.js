// Temp test auth: basic-auth as cwiedemann (bb_agent role → import perm).
const BASIC = "Y3dpZWRlbWFubjpnYWlhLWFnZW50LXNlY3JldA=="; // base64("cwiedemann:bakers-agent-secret")
const basicAuthProvider = {
  id: "basic_auth",
  displayName: "HTTP Basic (cwiedemann)",
  capabilities: { login: false, logout: false, status: true },
  async login() { throw new Error("static basic auth"); },
  async logout() {},
  async status() { return { loggedIn: true, provider: "basic_auth" }; },
  createAdapter() {
    return {
      async apply(req) {
        return { ...req, headers: { ...(req.headers ?? {}), Authorization: "Basic " + BASIC } };
      },
    };
  },
};
export default {
  site: { base_url: "http://bakers-wt-227bf7b.ddev.site", jsonapi_prefix: "/jsonapi" },
  defaults: { dry_run: false, timeout_ms: 30000 },
  plugins: [{ id: "keytec-basic-auth", authProvider: basicAuthProvider }],
};
