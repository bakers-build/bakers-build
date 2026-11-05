// Template for a per-developer conductor override. `bakers-cli/scripts/setup.sh`
// (the bootstrap) copies this to .bakers/conductor.config.local.js, filling in the
// client_id value below. It carries no identity: the conductor is this machine +
// project + variant. This template is committed; the generated
// .bakers/conductor.config.local.js is gitignored and loaded only if present
// (see loadLocal() in .bakers/conductor.config.js).
//
// It carries ONLY non-secret connection params. The OAuth client_secret is
// NEVER committed — it is read from the environment at load time. Export it in
// your shell before running the conductor:
//
//   export BB_CONSUMER_SECRET=<your consumer secret>
//
// then authenticate once:
//
//   bakers auth login
export default {
  oauth: {
    client_id: '__CLIENT_ID__',
    client_secret: process.env.BB_CONSUMER_SECRET,
  },
};
