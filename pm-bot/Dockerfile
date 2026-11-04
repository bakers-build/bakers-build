# The PM bot: Hermes at the version the bot is written for, with the bot's content baked in.
# GitHub CI builds and checks it (image_gate) and the release publishes it to GHCR; the
# bakers-ddev Coder template runs it (coder/bakers-ddev/README.md › PM bot).
#
# The base keeps its own start chain: s6-overlay runs Hermes' bootstrap as root (remapping
# the hermes user to HERMES_UID/HERMES_GID, preparing /opt/data), then runs entrypoint.sh as
# hermes, which starts the poller and the gateway in the foreground.
FROM nousresearch/hermes-agent:v0.22.5@sha256:9c5561579f3ffdf333401797094ac3a743738d6c25d40f4331c7bf77b694238d

# The entrypoint's gateway runs in the foreground, beside the poller, instead of being handed
# to Hermes' s6 slot.
ENV HERMES_GATEWAY_NO_SUPERVISE=1

# A gateway_state.json the last run left "running" (a workspace stop kills the container) makes
# Hermes' boot reconciler (cont-init.d/02-reconcile-profiles) start its own supervised gateway.
# The entrypoint's gateway then finds the gateway taken, exits, and stops the poller with it.
# Clearing the state before the reconciler runs leaves the gateway to the entrypoint, so every
# start runs the poller beside it.
RUN printf '%s\n' '#!/command/with-contenv sh' \
      'rm -f "${HERMES_HOME:-/opt/data}/gateway_state.json"' \
      > /etc/cont-init.d/019-pm-bot-gateway-state \
 && chmod 755 /etc/cont-init.d/019-pm-bot-gateway-state

COPY --chown=root:root . /opt/pm-bot/
RUN chmod -R a+rX,go-w /opt/pm-bot \
 && chmod 755 /opt/pm-bot/entrypoint.sh

ENTRYPOINT ["/opt/hermes/docker/entrypoint-dispatch.sh", "/opt/pm-bot/entrypoint.sh"]
CMD ["run"]
