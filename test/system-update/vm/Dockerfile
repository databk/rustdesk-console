FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl qemu-system-x86 qemu-utils genisoimage openssh-client \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 vm \
    && mkdir /vm && chown vm:vm /vm
COPY --chmod=755 boot.sh /usr/local/bin/console-test-vm
USER vm
WORKDIR /vm
ENTRYPOINT ["/usr/local/bin/console-test-vm"]
