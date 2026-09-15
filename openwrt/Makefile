include $(TOPDIR)/rules.mk

PKG_NAME:=rustdesk-console
PKG_VERSION:=1.8.0
PKG_RELEASE:=1

ifeq ($(ARCH),x86_64)
  SEA_ARCH:=x64
else ifeq ($(ARCH),aarch64)
  SEA_ARCH:=arm64
else
  SEA_ARCH:=unsupported
endif

PKG_SOURCE:=$(PKG_NAME)-$(PKG_VERSION)-linux-$(SEA_ARCH)-musl.tar.gz
PKG_SOURCE_URL:=https://github.com/databk/rustdesk-console/releases/download/$(PKG_VERSION)
PKG_HASH:=
PKG_MIRROR_HASH:=
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)-$(PKG_VERSION)

include $(INCLUDE_DIR)/package.mk

define Package/rustdesk-console
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=RustDesk
  TITLE:=RustDesk Console management platform
  DEPENDS:=+libc +libstdcpp6 +libgcc1
  MAINTAINER:=databk
endef

define Package/rustdesk-console/description
  Enterprise-grade management platform for the RustDesk ecosystem.
  Self-hosted console as an alternative to RustDesk Server Pro.
  This package ships prebuilt musl binaries (Node.js SEA + sqlite3 + sharp)
  for x86_64 and aarch64 only. Running on other architectures will fail.
endef

Build/Configure:=
Build/Compile:=

define Package/rustdesk-console/install
	$(INSTALL_DIR) $(1)/usr/lib/rustdesk-console
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_DIR) $(1)/etc/rustdesk-console
	$(TAR) -C $(PKG_BUILD_DIR) -xzf $(DL_DIR)/$(PKG_SOURCE)
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/rustdesk-console $(1)/usr/lib/rustdesk-console/rustdesk-console
	$(CP) $(PKG_BUILD_DIR)/templates $(1)/usr/lib/rustdesk-console/templates
	$(CP) $(PKG_BUILD_DIR)/node_modules $(1)/usr/lib/rustdesk-console/node_modules
	$(INSTALL_BIN) ./files/rustdesk-console.init $(1)/etc/init.d/rustdesk-console
	$(INSTALL_DATA) ./files/rustdesk-console.env $(1)/etc/rustdesk-console/rustdesk-console.env
	printf '#!/bin/sh\nexec /usr/lib/rustdesk-console/rustdesk-console "$$@"\n' > $(1)/usr/bin/rustdesk-console
	chmod 0755 $(1)/usr/bin/rustdesk-console
endef

$(eval $(call BuildPackage,rustdesk-console))