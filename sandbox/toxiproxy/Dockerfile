# Toxiproxy from its official GitHub release, pinned and checksum-verified.
# Built locally instead of pulled from ghcr.io, which some Docker setups (for example
# Docker Desktop behind a proxy or with a stale ghcr login) refuse with "denied".
FROM alpine:3.20

ARG TARGETARCH
ARG VERSION=2.9.0
# From https://github.com/Shopify/toxiproxy/releases/download/v2.9.0/checksums.txt
ARG SHA256_AMD64=8468ff159d953f2cd118232b658f5ee867aa980d2358379b493a395367be5d32
ARG SHA256_ARM64=21b3aa2e0393fb9c2f52c2332a8579d279f864abf9d48414d9039c691d3c2284

RUN set -eu; \
    case "${TARGETARCH:-amd64}" in \
      amd64) sum="$SHA256_AMD64" ;; \
      arm64) sum="$SHA256_ARM64" ;; \
      *) echo "unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    wget -qO /usr/local/bin/toxiproxy-server "https://github.com/Shopify/toxiproxy/releases/download/v${VERSION}/toxiproxy-server-linux-${TARGETARCH:-amd64}"; \
    echo "$sum  /usr/local/bin/toxiproxy-server" | sha256sum -c -; \
    chmod 0755 /usr/local/bin/toxiproxy-server

USER nobody
EXPOSE 8474
ENTRYPOINT ["/usr/local/bin/toxiproxy-server"]
