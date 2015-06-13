var events = require('events');
var DB = require('./db');

const OPEN = 1, CLOSED = 0;

var Door = function (opts)
{
    events.EventEmitter.call(this);

    // defaults:
    this.genSecret = false;
    this.minAccess = DB.XS.USER;
    this.openedBy = null;
    this.openDuration = 40000;
    this.searchInterval = 250;
    this.gpio = [];
    this.gpioLevel = [];
    this.logKeyId = false;

    this.set(opts);
};

Door.prototype.__proto__ = events.EventEmitter.prototype;

Door.prototype.set = function (o)
{
    // REQUIRED:

    /// ID of door
    if ('id' in o)
        this.id = o.id;

    /// 1-wire object
    if ('w1' in o)
        this.w1 = o.w1;

    /// name of master
    if ('master' in o)
        this.master = o.master;

    /// bus number
    if ('bus' in o)
        this.bus = o.bus;

    /// database object
    if ('db' in o)
        this.db = o.db;

    /// Logger, reguired
    if ('log' in o)
        this.log = o.log;

    /// array of GPIO objects, required
    if ('gpio' in o)
    {
        this.gpio = o.gpio;
        for (var i = 0; i < this.gpio.length; i++)
            if (! (i in this.gpioLevel))
                this.gpioLevel[i] = { open: 1, closed: 0 };

    }

    // OPTIONAL;

    /// name of door
    if ('name' in o)
        this.name = o.name;

    // invert GPIO logic levels if true
    if ('invGpio' in o)
    {
        for (var i = 0; i < this.gpio.length; i++)
            this.gpioLevel[i]
              = o.invGpio
              ? { open: 0, closed: 1 }
              : { open: 1, closed: 0 };
    }

    /// reader is used for administration, not for authentication at the door
    if ('admin' in o)
        this.admin = o.admin;

    /// perform secret generation instead of authentication
    if ('genSecret' in o)
        this.genSecret = o.genSecret;

    /// minimum access level to open the door
    if ('minAccess' in o)
        this.minAccess = o.minAccess;

    /// door open duration in milliseconds
    if ('openDuration' in o)
        this.openDuration = o.openDuration;

    /// search interval for new devices
    if ('searchInterval' in o)
        this.searchInterval = o.searchInterval;

    /// log key IDs? true / false
    if ('logKeyId' in o)
        this.logKeyId = o.logKeyId;
};

function addLogLevel(level)
{
    Door.prototype[level] = function(data, msg)
    {
        data = data || {};
        data.door = this.name || this.id;
        if (!this.logKeyId)
            delete data.key;
        msg = data.door +' door: ' + msg.replace('<keyId>', this.logKeyId ? data.key : '');
        this.log[level](data, msg);
    };
}

var levels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];
for (var i in levels)
{
    addLogLevel(levels[i]);
}

Door.prototype.open = function (keyId)
{
    if (this.openedBy) // already open
    {
        if (this.openedBy.id != keyId && this.openedBy.level >= DB.XS.ADMIN) // opened by an admin
        {
            this.info({key: keyId},
                      'set access level for key <keyId>');
            this.db.setKeyAccess(keyId, this.id, this.openedBy.level - 1);
            return true;
        }
        else
        {
            this.info({key: keyId},
                      'key <keyId> tried opening already open door');
            return false;
        }
    }

    var level = this.db.getKeyAccess(keyId, this.id);

    if (!(this.genSecret || level >= this.minAccess))
    {
        this.info({key: keyId},
                  'access denied for key <keyId>');
        return false;
    }

    this.info({key: keyId},
              'opened by key <keyId>');
    this.openedBy = { id: keyId, level: level };
    this.setState(OPEN);

    var door = this;
    setTimeout(function () {
        door.close();
    }, this.openDuration);
};


Door.prototype.close = function ()
{
    this.debug({}, 'closed');
    this.setState(CLOSED);
    this.openedBy = null;
};


Door.prototype.setState = function (state)
{
    for (var i=0; i < this.gpio.length; i++)
    {
        var value
            = (state == OPEN)
            ? this.gpioLevel[i].open
            : this.gpioLevel[i].closed;
        this.debug({}, 'writing '+ value +' to GPIO');
        this.gpio[i].write(value);
    }
};


Door.prototype.authenticate = function (keyId)
{
    var result = null;
    var secret = this.db.getKeySecret(keyId);

    if (null != secret)
    {
        this.debug({key: keyId},
                   'initiating challenge-response authentication');
        this.w1.updateDeviceById({deviceId: keyId, set: 'auth_secret', value: secret});
        var values = this.w1.readDevicesById({ fields: [ 'values' ], deviceIds: [ keyId ] });
        this.debug({key: keyId, values: values},
                   'authentication completed');
        result = ('YES' == values[keyId].authenticated);
    }
    this.info({key: keyId},
              'authentication '+ (result ? 'succeeded' : 'failed') +' for key <keyId>');
    this.emit('auth', keyId, result);
    return result;
};


Door.prototype.search = function ()
{
    if ((typeof this.id != 'number' && typeof this.id != 'string')
        || typeof this.gpio != 'object'
        || typeof this.db != 'object'
        || typeof this.log != 'object'
        || typeof this.w1 != 'object'
        || typeof this.master != 'string'
        || typeof this.bus != 'number')
    {
        console.error('Error initializing door '+ this.id +': missing/invalid options.\n',
                      { id: typeof this.id, gpio: typeof this.gpio,
                        db: typeof this.db, log: typeof this.log,
                        w1: typeof this.w1, master: typeof this.master, bus: typeof this.bus});
        throw new Error('Missing/invalid options.');
    }

    var devices = this.w1.syncBusDevices({masterName: this.master, busNumber: this.bus});
    for (var i in devices.added)
    {
        var secret;
        var dev = devices.added[i];
        this.debug({key: dev.id},
                   'added key <keyId>');

        if (!dev.id.match('^33')) // DS1961S device class
            continue;

        this.emit('read', dev.id);

        if (this.genSecret)
        {
            var ret = this.w1.updateDeviceById({deviceId: dev.id, set: 'generate_secret', value: ''});
            if (!ret.crcError)
            {
                this.debug({key: dev.id},
                           'generating new secret for key <keyId>');
                var values = this.w1.readDevicesById({ fields: [ 'values' ], deviceIds: [ dev.id ] });
                this.debug({key: dev.id, values: values},
                           'secret generation completed');
                secret = values[dev.id].generated_secret;
                this.db.setKeySecret(dev.id, secret);
                this.emit('secret', dev.id, true);
            }
            else
            {
                this.emit('secret', dev.id, false);
                this.emit('auth', dev.id, null);
                continue;
            }
        }
        if (this.authenticate(dev.id))
        {
            if (!this.admin)
                this.open(dev.id);

        }
    }

    for (var i in devices.removed)
    {
        var dev = devices.removed[i];
        this.debug({key: dev.id},
                   'removed key <keyId>');
    }

    var door = this;
    setTimeout(function () { door.search() }, this.searchInterval);
};

module.exports = Door;
