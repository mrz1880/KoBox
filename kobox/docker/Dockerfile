# debian:12 + systemd rather than jrei/systemd-debian: multi-arch (arm64 Macs
# and amd64 CI) and no dependency on a third-party image.
FROM debian:12

ENV container=docker
RUN apt-get update && apt-get install -y --no-install-recommends \
    systemd \
    systemd-sysv \
    aria2 \
    dbus \
    bind9utils \
    easy-rsa \
    ca-certificates \
    curl \
    fail2ban \
    git \
    gnupg \
    iproute2 \
    ipset \
    iptables \
    openssh-server \
    openssl \
    procps \
    quota \
    rtorrent \
    sudo \
    xz-utils \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /lib/systemd/system/multi-user.target.wants/getty.target \
    && systemctl mask systemd-logind.service getty@tty1.service

ARG NODE_VERSION=24
RUN curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

RUN mkdir -p /var/lib/kobox /run/sshd

CMD ["/sbin/init"]
