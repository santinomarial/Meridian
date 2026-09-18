FROM postgres:16.15-alpine3.24
# The upstream gosu binary embeds an old Go runtime. The entrypoint only uses
# its user-switch operation; Alpine's small native su-exec provides that same
# operation without shipping a second Go runtime.
RUN apk upgrade --no-cache \
  && apk add --no-cache su-exec \
  && rm /usr/local/bin/gosu \
  && sed -i 's/exec gosu postgres/exec su-exec postgres/' /usr/local/bin/docker-entrypoint.sh
