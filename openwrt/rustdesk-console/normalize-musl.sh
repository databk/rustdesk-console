#!/bin/sh
set -eu

if [ "$1" = --files ]; then
	shift
	patchelf="$1"
	shift
	for file do
		needed="$("$patchelf" --print-needed "$file")"
		for library in $needed; do
			case "$library" in
				libc.musl-x86_64.so.1|libc.musl-aarch64.so.1)
					# Alpine addons name musl differently. OpenWrt ships libc.so;
					# normalize only private package files, never the system libc.
					"$patchelf" --replace-needed "$library" libc.so "$file"
					;;
			esac
		done
	done
else
	find "$1" -type f \( -name '*.node' -o -name '*.so*' -o -name node \) \
		-exec sh "$0" --files "$2" '{}' +
fi
