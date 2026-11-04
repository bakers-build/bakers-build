# The PM bot: Hermes at the version the bot is written for, with the bot's content baked in.
# GitHub CI builds and checks it (image_gate) and the release publishes it to GHCR; the
# bakers-ddev Coder template runs it (coder/bakers-ddev/README.md › PM bot).
#
# The base keeps its own start chain: s6-overlay runs Hermes' bootstrap as root (remapping
# the hermes user to HERMES_UID/HERMES_GID, preparing /opt/data), then runs entrypoint.sh as
# hermes, which starts the poller and the gateway in the foreground.
#
# The skills the bot runs come from three named build contexts, which every build line passes
# (experimental/pm-bot/README.md › Build the image):
#   bundle       this repository's .claude/skills/bakers-build, at the image's build revision
#   superpowers  https://github.com/obra/superpowers.git#bb92a77741419a4ab5f06e711a283343f1ada0c3 (v7.0.0)
#   mattpocock   https://github.com/mattpocock/skills.git#d1478fcb140db0b93c0c8df17bcfd311844749d0 (v1.3.2)

# bb-create-ticket and the two recipes, with every bundle file their links reach.
FROM nousresearch/hermes-agent:v0.22.5@sha256:9c5561579f3ffdf333401797094ac3a743738d6c25d40f4331c7bf77b694238d AS skills
COPY --from=bundle . /bundle
COPY build/collect-skills.mjs /collect-skills.mjs
RUN node /collect-skills.mjs /bundle /out bb-create-ticket bb-recipe-superpowers bb-recipe-matt

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
COPY --chown=root:root --from=skills /out /opt/pm-bot/skills/
# The method skills the recipes name, each a complete upstream directory, unchanged.
COPY --chown=root:root --from=superpowers skills/brainstorming /opt/pm-bot/skills/brainstorming/
COPY --chown=root:root --from=superpowers skills/writing-plans /opt/pm-bot/skills/writing-plans/
COPY --chown=root:root --from=superpowers LICENSE /opt/pm-bot/skills/LICENSES/superpowers
COPY --chown=root:root --from=mattpocock skills/productivity/grilling /opt/pm-bot/skills/grilling/
COPY --chown=root:root --from=mattpocock LICENSE /opt/pm-bot/skills/LICENSES/mattpocock
RUN chmod -R a+rX,go-w /opt/pm-bot \
 && chmod 755 /opt/pm-bot/entrypoint.sh

ENTRYPOINT ["/opt/hermes/docker/entrypoint-dispatch.sh", "/opt/pm-bot/entrypoint.sh"]
CMD ["run"]
