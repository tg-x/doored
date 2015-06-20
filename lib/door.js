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
    this.openDuration = 4000;
    this.searchInterval = 250;
    this.gpioDoor = [];
    this.gpioAccess = [];
    this.logKeyId = false;
    this.idPresent = false;
    this.idTimeout = 15000;

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

    /// Logger
    if ('log' in o)
        this.log = o.log;

    /// array of GPIO objects to toggle when opening the door
    if ('gpioDoor' in o)
        this.gpioDoor = o.gpioDoor;

    // OPTIONAL;

    /// array of GPIO objects to blink when granting access at the door
    if ('gpioAccess' in o)
        this.gpioAccess = o.gpioAccess;

    /// name of door
    if ('name' in o)
        this.name = o.name;

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

    if ('idDevice' in o)
        this.idDevice = o.idDevice;

    if ('idTimeout' in o)
        this.idTimeout = o.idTimeout;

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


Door.prototype.grantAccess = function (keyId)
{
    this.info({key: keyId},
              'set access level for key <keyId>');
    this.db.setKeyAccess(keyId, this.id, this.openedBy.level - 1);

    if (this.gpioAccess.length)
        this.blinkLed(this.gpioAccess, 3);
}


Door.prototype.open = function (keyId)
{
    if (this.openedBy) // already open
    {
        if (this.openedBy.id != keyId && this.openedBy.level >= DB.XS.ADMIN) // opened by an admin
        {
            this.grantAccess(keyId);
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


Door.prototype.writeGpio = function (gpio, value)
{
    try {
        this.trace({}, 'writing '+ value +' to GPIO');
        // the GPIO IC might reset, thus need to set direction as well
        // instead of just writing a value
        gpio.setDirection(value ? 'high' : 'low');
    }
    catch (err)
    {
        this.error({error: err, gpio: gpio},
                    'Error writing to GPIO: '+ err);
    }

}


Door.prototype.setState = function (state)
{
    for (var i=0; i < this.gpioDoor.length; i++)
    {
        var value = (state == OPEN) ? 1 : 0
        this.writeGpio(this.gpioDoor[i], value);
    }
};


Door.prototype.blinkLed = function (gpio, count, duration)
{
    var n = 0;
    var value = 0;
    if (!duration)
        duration = 333;

    function blink ()
    {
        for (var i = 0; i < gpio.length; i++)
            this.writeGpio(gpio[i], value);
        value = value ? 0 : 1;
        if (n++ < count * 2)
            setTimeout(blink.bind(this), duration);
    }
    blink.call(this);
}


Door.prototype.authenticate = function (keyId)
{
    var result = null;
    var secret = this.db.getKeySecret(keyId);

    if (null == secret && this.db.getKey(keyId))
    {
        this.info({key: keyId}, 'no secret set for key <keyId>, generating one');
        secret = this.generateSecret(keyId);
    }

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


Door.prototype.generateSecret = function (keyId)
{
    var secret = null;
    var ret = this.w1.updateDeviceById({deviceId: keyId, set: 'generate_secret', value: ''});
    if (!ret.crcError)
    {
        this.debug({key: keyId},
                   'generating new secret for key <keyId>');
        var values = this.w1.readDevicesById({ fields: [ 'values' ], deviceIds: [ keyId ] });
        this.debug({key: keyId, values: values},
                   'secret generation completed');
        secret = values[keyId].generated_secret;
        this.db.setKeySecret(keyId, secret);
        this.emit('secret', keyId, true);
    }
    else
    {
        this.emit('secret', keyId, false);
        this.emit('auth', keyId, null);
    }
    return secret;
};


Door.prototype.search = function ()
{
    if ((typeof this.id != 'number' && typeof this.id != 'string')
        || typeof this.gpioDoor != 'object'
        || typeof this.db != 'object'
        || typeof this.log != 'object'
        || typeof this.w1 != 'object'
        || typeof this.master != 'string'
        || typeof this.bus != 'number')
    {
        console.error('Error initializing door '+ this.id +': missing/invalid options.\n',
                      { id: typeof this.id, gpio: typeof this.gpioDoor,
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

        if (this.idDevice && dev.id == this.idDevice)
        {
            this.idPresent = true;
        }

        if (!dev.id.match('^33')) // DS1961S device class
            continue;

        this.emit('read', dev.id);

        if (this.genSecret)
        {
            if (!this.generateSecret(dev.id))
                continue;
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
        if (this.idDevice && dev.id == this.idDevice)
        {
            var door = this;
            this.idPresent = false;
            setTimeout(function () {
                if (!door.idPresent)
                    door.emit('idRemoved', door);
            }, this.idTimeout);
        }
    }

    var door = this;
    setTimeout(function () { door.search() }, this.searchInterval);
};

module.exports = Door;
