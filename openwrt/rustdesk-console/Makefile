include $(TOPDIR)/rules.mk

PKG_NAME:=rustdesk-console
PKG_VERSION:=1.11.0
PKG_RELEASE:=1
PKG_LICENSE:=AGPL-3.0-only
PKG_MAINTAINER:=RustDesk Console contributors

include $(INCLUDE_DIR)/package.mk

# Inputs must be unpacked, tested musl bundles. Preserve Node's native-export
# tables and the upstream runtime binaries when packaging.
STRIP:=:
RSTRIP:=:

define Package/rustdesk-console
  SECTION:=net
  CATEGORY:=Network
  TITLE:=RustDesk Console with its native web frontend
  URL:=https://github.com/databk/rustdesk-console
  DEPENDS:=@(x86_64||aarch64) +libstdcpp +libgcc
  USERID:=rustdesk-console:rustdesk-console
endef

define Package/rustdesk-console/description
  Native Console API and web UI, supervised by procd. No system Node, Docker,
  network changes or firewall rules are needed. Disabled until configured.
endef

define Package/rustdesk-console/conffiles
/etc/config/rustdesk-console
/etc/rustdesk-console/credentials
endef

define Build/Prepare
	$(call Build/Prepare/Default)
	test -n "$(CONSOLE_BUNDLE)" && test -x "$(CONSOLE_BUNDLE)/rustdesk-console"
	test -n "$(WEB_BUNDLE)" && test -x "$(WEB_BUNDLE)/rustdesk-console-web"
	test ! -e "$(CONSOLE_BUNDLE)/sea-prep.blob"
	python3 ./validate-bundles.py "$(CONSOLE_BUNDLE)" "$(WEB_BUNDLE)" "$(ARCH)" "$(PKG_VERSION)"
endef

define Build/Compile
endef

define Package/rustdesk-console/install
	$(INSTALL_DIR) $(1)/usr/lib/rustdesk-console/backend $(1)/usr/lib/rustdesk-console/web
	$(CP) $(CONSOLE_BUNDLE)/rustdesk-console $(CONSOLE_BUNDLE)/node \
		$(CONSOLE_BUNDLE)/console.cjs $(CONSOLE_BUNDLE)/node_modules \
		$(CONSOLE_BUNDLE)/templates $(CONSOLE_BUNDLE)/build-info.json \
		$(CONSOLE_BUNDLE)/release-metadata.json $(1)/usr/lib/rustdesk-console/backend/
	$(CP) $(WEB_BUNDLE)/rustdesk-console-web $(WEB_BUNDLE)/build-info.json $(WEB_BUNDLE)/release-metadata.json $(1)/usr/lib/rustdesk-console/web/
	$(INSTALL_DIR) $(1)/etc/config $(1)/etc/init.d $(1)/usr/libexec
	$(INSTALL_CONF) ./files/rustdesk-console.config $(1)/etc/config/rustdesk-console
	$(INSTALL_BIN) ./files/rustdesk-console.init $(1)/etc/init.d/rustdesk-console
	$(INSTALL_BIN) ./files/rustdesk-console-run $(1)/usr/libexec/rustdesk-console-run
	sh ./normalize-musl.sh $(1)/usr/lib/rustdesk-console $(STAGING_DIR_HOST)/bin/patchelf
	find $(1)/usr/lib/rustdesk-console -type d -exec chmod 755 '{}' +
	find $(1)/usr/lib/rustdesk-console -type f -exec chmod 644 '{}' +
	chmod 755 $(1)/usr/lib/rustdesk-console/backend/node \
		$(1)/usr/lib/rustdesk-console/backend/rustdesk-console \
		$(1)/usr/lib/rustdesk-console/web/rustdesk-console-web
endef

$(eval $(call BuildPackage,rustdesk-console))
