include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-rustdesk-console
PKG_VERSION:=1.0.0
PKG_RELEASE:=2
PKG_LICENSE:=AGPL-3.0-only

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-rustdesk-console
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=LuCI support for RustDesk Console
  DEPENDS:=+luci-base +rustdesk-console
  PKGARCH:=all
endef

define Build/Compile
endef

define Package/luci-app-rustdesk-console/install
	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/luci-app-rustdesk-console.json $(1)/usr/share/luci/menu.d/
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-app-rustdesk-console.json $(1)/usr/share/rpcd/acl.d/
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view
	$(INSTALL_DATA) ./rustdesk-console.js $(1)/www/luci-static/resources/view/
endef

$(eval $(call BuildPackage,luci-app-rustdesk-console))
