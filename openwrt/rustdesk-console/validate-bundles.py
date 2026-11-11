#!/usr/bin/env python3
"""Reject incompatible architecture/libc inputs before SDK package creation."""
import json
import pathlib
import struct
import sys

TARGETS = {"x86_64": ("x64", 62), "aarch64": ("arm64", 183)}


def validate(directory, component, arch, version):
    root = pathlib.Path(directory)
    node_arch, elf_machine = TARGETS[arch]
    info = json.loads((root / "build-info.json").read_text())
    expected = {"arch": node_arch, "platform": "linux", "libc": "musl"}
    if any(info.get(key) != value for key, value in expected.items()):
        raise ValueError(f"Incompatible {component} build-info; expected {expected}")

    executable = "rustdesk-console-web"
    if component == "backend":
        if info.get("version") != version:
            raise ValueError("Backend version differs from SDK package version")
        if info.get("runtime") != "private-node":
            raise ValueError("Backend must be built with npm run build:openwrt")
        for name in ["rustdesk-console", "console.cjs", "release-metadata.json"]:
            if not (root / name).is_file():
                raise ValueError(f"Backend bundle is missing {name}")
        for name in ["node_modules", "templates"]:
            if not (root / name).is_dir():
                raise ValueError(f"Backend bundle is missing {name}/")
        executable = "node"

    with (root / executable).open("rb") as stream:
        header = stream.read(64)
    if (len(header) != 64 or header[:6] != b"\x7fELF\x02\x01"
            or struct.unpack_from("<H", header, 18)[0] != elf_machine):
        raise ValueError(f"Wrong ELF architecture: {root / executable}")


if __name__ == "__main__":
    if len(sys.argv) != 5 or sys.argv[3] not in TARGETS:
        raise SystemExit("Usage: validate-bundles.py BACKEND WEB {x86_64|aarch64} VERSION")
    backend, web, arch, version = sys.argv[1:]
    try:
        validate(backend, "backend", arch, version)
        validate(web, "web", arch, version)
    except (OSError, ValueError) as error:
        raise SystemExit(str(error)) from error
    print(f"Validated {arch} musl bundles")
