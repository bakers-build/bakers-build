// Use the canonical private global connection for this dropsh session.
const connection = (await import(`${process.env.HOME}/.bakers/connections/default.js`))
  .default;
export default {
  ...connection,
  defaults: { ...connection.defaults, timeout_ms: 30000 },
};
