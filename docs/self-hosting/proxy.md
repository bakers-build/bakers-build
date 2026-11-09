---
title: Reverse proxy
description: Put Traefik, Caddy, nginx or an existing proxy in front of the bakers.build server.
---

# Reverse proxy

The server's nginx listens on `127.0.0.1:8080` (`HTTP_PORT`). Your proxy terminates HTTPS for
`DOMAIN` and forwards to it with the usual `X-Forwarded-*` headers. The server trusts them only from
the host and its own Docker network.

## Traefik

Save this as `docker-compose.override.yml` next to `docker-compose.yml`; Compose loads it
automatically. Traefik obtains a Let's Encrypt certificate on port 443.

```yaml
services:
  traefik:
    image: traefik:v3.6.1
    restart: unless-stopped
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --entrypoints.web.address=:80
      - --entrypoints.web.http.redirections.entrypoint.to=websecure
      - --entrypoints.web.http.redirections.entrypoint.scheme=https
      - --entrypoints.websecure.address=:443
      - --certificatesresolvers.le.acme.email=${ACME_EMAIL:-${ADMIN_EMAIL}}
      - --certificatesresolvers.le.acme.storage=/acme/acme.json
      - --certificatesresolvers.le.acme.tlschallenge=true
    ports:
      - 80:80
      - 443:443
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - acme:/acme
    networks: [internal]
  nginx:
    labels:
      traefik.enable: "true"
      traefik.http.routers.bakers.rule: Host(`${DOMAIN}`)
      traefik.http.routers.bakers.entrypoints: websecure
      traefik.http.routers.bakers.tls.certresolver: le

volumes:
  acme:
```

## Caddy

Caddy on the host gets the certificate itself. `/etc/caddy/Caddyfile`:

```text
bakers.example.org {
  reverse_proxy 127.0.0.1:8080
}
```

## nginx

On the host, with a certificate from certbot or your CA:

```nginx
server {
  listen 443 ssl;
  server_name bakers.example.org;
  ssl_certificate     /etc/letsencrypt/live/bakers.example.org/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/bakers.example.org/privkey.pem;
  client_max_body_size 64m;
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
}
server {
  listen 80;
  server_name bakers.example.org;
  return 301 https://$host$request_uri;
}
```

## An existing proxy

Route `DOMAIN` with HTTPS to `127.0.0.1:8080` on this host, passing `X-Forwarded-For` and
`X-Forwarded-Proto`. A proxy on another machine forwards to a local proxy such as Caddy above, since
the server trusts forwarded headers only from this host.
