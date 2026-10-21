// Use the canonical private global connection for this dropsh session.
const connection = (await import(`${process.env.HOME}/.bakers/bakers.config.js`))
  .default;
export default {
  ...connection,
  defaults: { ...connection.defaults, timeout_ms: 30000 },
};
