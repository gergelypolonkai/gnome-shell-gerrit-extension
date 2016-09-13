const Lang = imports.lang;
const Gio = imports.gi.Gio;
const Secret = imports.gi.Secret;
const GLib = imports.gi.GLib;
const Soup = imports.gi.Soup;
const GObject = imports.gi.GObject;
const Signals = imports.signals;

const GERRITEXT_SETTINGS_SCHEMA = 'org.gnome.shell.extensions.gerrit';

// TODO: Get this from GSettings
let config = {
    instances: [
//        {
//            name: <display name of the instance>,
//            url_base: <base URL for the instance (ie. the front page>,
//            username: <username, or null>,
//            password: <password, or null>,
//            strict_ssl: false,
//            List of sections, with a Gerrit query string
//            rules: [
//                {
//                    name: 'To be reviewed by me',
//                    query: 'reviewer:self+is:open'
//                }
//            ]
//        }
//    ]
};

const GerritChecker = new Lang.Class({
    Name: "GerritChecker",

    _init: function(menu_button, instance_config) {
        menu_button.connect('network-state-changed',
                            Lang.bind(this, this._onNetworkStateChanged));

        this._config = instance_config;
        this._connected = false;

        this._httpSession = new Soup.Session();
        this._httpSession.ssl_strict = this._config.strict_ssl;

        if (this._config.username) {
            this._httpSession.add_feature_by_type = Soup.AuthDomainBasic;
            this._httpSession.connect(
                'authenticate',
                Lang.bind(this, function(session, message, auth, retrying) {
                    log('Authenticating ' + this._config.name);
                    auth.authenticate(this._config.username,
                                      this._config.password);
                }));
        }

        GLib.timeout_add(null, 5000, Lang.bind(this, function() {
            if (this._connected) {
                this._update();
            }

            return true;
        }));
    },

    _onNetworkStateChanged: function(proxy, connected) {
        this._connected = connected;
    },

    _update: function() {
        log("Updating " + this._config.name);

        let url = this._config.url_base + 'a/changes/?q=reviewer:self+is:open';
        let uri = new Soup.URI(url);
        let message = Soup.Message.new_from_uri('GET', uri);
        log('Fetching: ' + uri.to_string(null));

        this._httpSession.queue_message(
            message,
            Lang.bind(this, function(session, msg) {
                if (message.status_code >= 200 &&
                    message.status_code < 300) {
                    let json_data = JSON.parse(
                        message.response_body.data.slice(5));
                    json_data.forEach(function(change) {
                        log(change.change_id);
                        log(change.status);
                        log(change.subject);
                    });
                    loop.quit();
                } else {
                    log('Failed to fetch '
                        + message.uri.to_string(null)
                        + ' ('
                        + message.status_code
                        + ': '
                        + message.reason_phrase
                        + ')');
                }
            }));
    }
});

const GerritMenuButton = new GObject.Class({
    Name: "GerritMenuButton",
    GTypeName: 'GerritMenuButton',

    _init: function() {
        this.parent();

        log('Initializing');
        this._connected = false;
        this._network_monitor = Gio.network_monitor_get_default();
        this._network_monitor_connection = this._network_monitor.connect(
            'network-changed',
            Lang.bind(this, this._onNetworkStateChanged));

        // Let’s check connectivity
        this._checkConnectionState();

        this._instances = [];

        let i;
        for (i in config.instances) {
            this._instances.push(new GerritChecker(this, config.instances[i]));
        }

        this._password_schema = Secret.Schema.new(
            'eu.polonkai.gergely.gnome-shell-gerrit-extension.Store',
            Secret.SchemaFlags.NONE,
            {
                "username": Secret.SchemaAttributeType.STRING,
            });
    },

    _onNetworkStateChanged: function() {
        log('Network change');
        this._checkConnectionState();
    },

    _checkConnectionState: function() {
        // TODO: Get this from the config
        let url = 'https://www.gerritcodereview.com/';
        // TODO: Port number from schema!
        let port = 443;
        let address = Gio.NetworkAddress.parse_uri(url, port);
        let cancellable = Gio.Cancellable.new();

        this._oldConnected = this._connected;
        this._connected = false;

        log('Checking for connection');

        try {
            this._network_monitor.can_reach_async(
                address, cancellable,
                Lang.bind(this, this._asyncReadyCallback));
            log('Checking');
        } catch (err) {
            let title = _("Can not connect to %s").format(url);
            log(title + '\n' + err.message);  // TODO: Remove this!
        }
    },

    _asyncReadyCallback: function(nm, res) {
        this._connected = this._network_monitor.can_reach_finish(res);

        log('Connection check finished: '
            + this._oldConnected
            + ' => '
            + this._connected);

        this.emit('network-state-changed', this._connected);
    }
});
Signals.addSignalMethods(GerritMenuButton.prototype);

let e = new GerritMenuButton();
let loop = GLib.MainLoop.new(null, false);
loop.run();
