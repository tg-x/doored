var events = require('events');
var DB = require('./db');

const OPEN = 1, CLOSED = 0;

var Door = function (opts)
{
    events.EventEmitter.call(this);

    this.genSecret = false;
    this.minAccess = DB.XS.USER;
    this.openedBy = null;
    this.openDuration = 4000;
    this.searchInterval = 250;
    this.gpioLevel = [];

    this.set(opts);
};

Door.prototype.__proto__ = events.EventEmitter.prototype;

Door.prototype.set = function (o)
{
    /// ID of door
    if ('id' in o)
        this.id = o.id;

    /// name of door
    if ('name' in o)
        this.name = o.name;

    /// Logger
    if ('log' in o)
        this.log = o.log;

    /// array of GPIO objects
    if ('gpio' in o)
    {
        this.gpio = o.gpio;
        for (var i = 0; i < this.gpio.length; i++)
            if (! (i in this.gpioLevel))
                this.gpioLevel[i] = { open: 1, closed: 0 };

    }

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

    /// database object
    if ('db' in o)
        this.db = o.db;

    /// 1-wire object
    if ('w1' in o)
        this.w1 = o.w1;

    /// name of master
    if ('master' in o)
        this.master = o.master;

    /// bus number
    if ('bus' in o)
        this.bus = o.bus;
};


Door.prototype.open = function (devid)
{
    if (this.openedBy) // already open
    {
        if (this.openedBy.id != devid && this.openedBy.level >= DB.XS.ADMIN) // opened by an admin
        {
            this.log.info('Door #'+this.id +': set access level for '+ devid +' to '+ this.openedBy.level - 1);
            this.db.setAccess(devid, this.id, this.openedBy.level - 1);
            return true;
        }
        else
        {
            this.log.info('Door #'+this.id +': '+ devid +' tried opening already open door.');
            return false;
        }
    }

    var level = this.db.getAccess(devid, this.id);

    if (!(this.genSecret || level >= this.minAccess))
    {
        this.log.info('Door #'+this.id, ': access denied for '+ devid +' at level '+ level +'( < '+ this.minAccess +')');
        return false;
    }

    this.log.info('Door #'+this.id +': opened by '+ devid +' at level '+ level);

    this.openedBy = { id: devid, level: level };
    this.write(OPEN);

    var door = this;
    setTimeout(function () {
        door.close();
    }, this.openDuration);
};


Door.prototype.close = function ()
{
    this.log.debug('Door #'+this.id, 'closed');
    this.write(CLOSED);
    this.openedBy = null;
};


Door.prototype.write = function (value)
{
    for (var i=0; i < this.gpio.length; i++)
    {
        this.log.debug('Door #'+this.id +' - writing '+ value);
        this.gpio[i].write(value == OPEN
                           ? this.gpioLevel[i].open
                           : this.gpioLevel[i].closed);
    }
};


Door.prototype.authenticate = function (devid)
{
    var result = null;
    var secret = this.db.getSecret(devid);

    if (null != secret)
    {
        this.w1.updateDeviceById({deviceId: devid, set: 'auth_secret', value: secret});
        var values = this.w1.readDevicesById({ fields: [ 'values' ], deviceIds: [ devid ] });
        this.log.debug(values, 'Got authentication result.');
        result = ('YES' == values[devid].authenticated);
    }
    this.log.info('Authentication '+ (result ? 'succeeded' : 'failed') +' for '+ devid);
    this.emit('auth', devid, result);
    return result;
};


Door.prototype.search = function ()
{
    var devices = this.w1.syncBusDevices({masterName: this.master, busNumber: this.bus});
    for (var i in devices.added)
    {
        var secret;
        var dev = devices.added[i];
        this.log.info('#'+ dev.id +' added on '+ dev.master +' bus '+ dev.bus);

        if (!dev.id.match('^33')) // DS1961S device class
            continue;

        this.emit('read', dev.id);

        if (this.genSecret)
        {
            var ret = this.w1.updateDeviceById({deviceId: dev.id, set: 'generate_secret', value: ''});
            if (!ret.crcError)
            {
                this.log.debug('>> generated new secret at reader #'+ this.id +' for device '+ dev.id);
                var values = this.w1.readDevicesById({ fields: [ 'values' ], deviceIds: [ dev.id ] });
                this.log.debug(values, 'values after secret generation');
                secret = values[dev.id].generated_secret;
                this.db.setSecret(dev.id, secret);
                this.emit('reset', dev.id, true);
            }
            else
            {
                this.emit('reset', dev.id, false);
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
        console.log ('#', dev.id, 'removed from', dev.master, 'bus', dev.bus);
    }

    var door = this;
    setTimeout(function () { door.search() }, this.searchInterval);
};

module.exports = Door;
