'use strict';
'require view';
'require form';
'require rpc';
'require uci';

var getService = rpc.declare({ object: 'service', method: 'list', params: ['name'], expect: {} });

return view.extend({
	load: function() {
		return Promise.all([uci.load('rustdesk-console'), getService('rustdesk-console')]);
	},
	render: function(data) {
		var instances = (data[1]['rustdesk-console'] || {}).instances || {};
		var running = instances.backend && instances.backend.running && instances.web && instances.web.running;
		var m = new form.Map('rustdesk-console', _('RustDesk Console'),
			_('Native Console with persistent SQLite storage. The API listens on loopback. Configure the web address below before enabling LAN access. Initial username: databk; the generated password is in /etc/rustdesk-console/credentials.'));
		var s = m.section(form.NamedSection, 'main', 'console');
		s.anonymous = true;
		var o = s.option(form.DummyValue, '_status', _('Status'));
		o.rawhtml = false;
		o.cfgvalue = function() { return running ? _('Running') : _('Stopped'); };
		o = s.option(form.Flag, 'enabled', _('Enable'));
		o.rmempty = false;
		o = s.option(form.Value, 'bind_addr', _('Web listen address'));
		o.datatype = 'ipaddr("nomask")';
		o.rmempty = false;
		o = s.option(form.Value, 'port', _('Web port'));
		o.datatype = 'and(uinteger,range(1024,65535))';
		o.rmempty = false;
		o = s.option(form.Value, 'backend_port', _('Internal API port'));
		o.datatype = 'and(uinteger,range(1024,65535))';
		o.rmempty = false;
		o.validate = function(section, value) {
			var webPort = uci.get('rustdesk-console', 'main', 'port');
			return value !== webPort || _('Internal API port must differ from the web port.');
		};
		o = s.option(form.Value, 'data_dir', _('Persistent data directory'),
			_('Changing this value restarts the service against the new directory without migrating the existing database. Stop the service and copy the data manually before applying.'));
		o.rmempty = false;
		o.validate = function(section, value) {
			return /^\/(srv|mnt|opt)\/.+/.test(value) || _('Use an absolute directory under /srv, /mnt or /opt.');
		};
		o = s.option(form.Value, 'heap_mb', _('JavaScript heap limit (MiB)'));
		o.datatype = 'and(uinteger,range(64,512))';
		o.rmempty = false;
		o = s.option(form.DummyValue, '_open', _('Console'));
		o.renderWidget = function() {
			var host = uci.get('rustdesk-console', 'main', 'bind_addr');
			if (!host || host === '127.0.0.1' || host === '::1')
				return E('span', {}, _('Set the router LAN address to open the Console from another computer.'));
			if (host === '0.0.0.0' || host === '::') host = window.location.hostname;
			if (host.indexOf(':') >= 0 && host.charAt(0) !== '[') host = '[' + host + ']';
			return E('a', { 'class': 'cbi-button', href: 'http://' + host + ':' + uci.get('rustdesk-console', 'main', 'port') + '/', target: '_blank', rel: 'noopener noreferrer' }, _('Open Console'));
		};
		return m.render();
	}
});
