# The PM bot: Hermes at the version the bot is written for, with the bot's content baked in.
# CI (pm_bot_image) builds and pushes it; the bakers-ddev Coder template runs it
# (coder/bakers-ddev/README.md › PM bot).
#
# The base keeps its own start chain: s6-overlay runs Hermes' bootstrap as root (remapping
# the hermes user to HERMES_UID/HERMES_GID, preparing /opt/data), then runs entrypoint.sh as
# hermes, which starts the poller and the gateway in the foreground.
FROM nousresearch/hermes-agent:v0.22.5@sha256:9c5561579f3ffdf333401797094ac3a743738d6c25d40f4331c7bf77b694238d

# The entrypoint's gateway runs in the foreground instead of being handed to Hermes' s6
# slot, which the container's reduced capabilities (pm-bot.compose.yaml) leave unusable.
ENV HERMES_GATEWAY_NO_SUPERVISE=1

COPY --chown=root:root . /opt/pm-bot/
RUN chmod -R a+rX,go-w /opt/pm-bot \
 && chmod 755 /opt/pm-bot/entrypoint.sh

ENTRYPOINT ["/opt/hermes/docker/entrypoint-dispatch.sh", "/opt/pm-bot/entrypoint.sh"]
CMD ["run"]
