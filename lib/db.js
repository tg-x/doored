var nconf = require('nconf');
var fs = require('fs');

/* DB format:
 * {
 *   keys: {
 *     3300000000000000: { secret: "a 16-char secret" ] }
 *     3300000000000001: { secret: "a 16-char secret" ] },
 *     3300000000000002: { secret: "a 16-char secret" ] },
 *   },
 *   doors: {
 *     P1: {
 *       name: 'front',
 *       access : {
 *         3300000000000000: 3,
 *         300000000000001: 2,
 *         3300000000000002: 1,
 *       }
 *     },
 *     P2: {
 *       name: 'back',
 *       access: {
 *         3300000000000000: 3,
 *         3300000000000001: 1,
 *       }
 *     }
 *   }
 * }
 */

var DB = function (file, log)
{
    this.file = file;
    this.log = log;
    this.conf = new nconf.Provider({
        store: { type: 'file', file: file }
    });

    this.defaultKeyId = '0';
    this.defaultKeyName = 'default';

    this.saving = null;
    this.exists = false;
    this.watch();
};


DB.prototype.watch = function ()
{
    var db = this;

    fs.exists(this.file, function (exists) {
        db.exists = exists;

        if (exists)
        {
            fs.watch(db.file, function () {
                if (!db.saving)
                    db.reload();
            });
        }
        else // set default entry without saving
        {
            db.conf.set('doors', {});
            db.conf.set('keys:'+db.defaultKeyId, { name: db.defaultKeyName });
        }
    });
};


/**
 * Reload database from file.
 */

DB.prototype.reload = function ()
{
    this.log.info('Database file changed, reloading it.');
    this.conf.load();
};


DB.prototype.getStore = function ()
{
    return this.conf.stores.file.store;
};


DB.prototype.getDoors = function ()
{
    return this.conf.get('doors');
};


DB.prototype.getKeys = function ()
{
    return this.conf.get('keys');
};


DB.prototype.get = function (id)
{
    return this.conf.get(id);
};


DB.prototype.getDoor = function (doorId)
{
    var door = this.conf.get('doors:'+doorId);
    if (door)
        door.id = doorId;
    return door;
};


DB.prototype.getDoorByName = function (name)
{
    var doors = this.getDoors();

    for (var id in doors)
    {
        if (!doors[id])
            continue;

        if (doors[id].name == name)
        {
            return this.getDoor(id);
        }
    }
    return null;
};


DB.prototype.getDoorByIdOrName = function (doorIdOrName)
{
    return this.getDoor(doorIdOrName) || this.getDoorByName(doorIdOrName);
};


DB.prototype.setDoor = function (doorId, value, onSave)
{
    this.conf.set('doors:'+doorId), value;
    this.save(onSave);
    return true;
};


DB.prototype.getDoorName = function (doorId)
{
    return this.conf.get('doors:'+doorId+':name') || doorId;
};


DB.prototype.initDoor = function (doorId, name, onSave)
{
    this.conf.set('doors:'+doorId+':name', name.toString());
    this.save(onSave);
    return true;
};


DB.prototype.setDoorName = function (doorIdOrName, name, onSave)
{
    var door = this.getDoorByIdOrName(doorIdOrName);
    if (!door) {
        if (typeof onSave == 'function')
            onSave(new Error("Door not found."));
        return false;
    }

    var door2 = this.getDoorByName(name);
    if (door2 && door2.id != door.id)
    {
        if (typeof onSave == 'function')
            onSave(new Error("Door name already in use."));

        return false;
    }
    this.conf.set('doors:'+door.id+':name', name.toString());
    this.save(onSave);
    return true;
};


DB.prototype.getKey = function (keyId)
{
    var key = this.conf.get('keys:'+keyId);
    if (key)
        key.id = keyId;
    return key;
};


DB.prototype.setKey = function (keyId, value, onSave)
{
    this.conf.set('keys:'+keyId, value);
    this.save(onSave);
    return true;
};


DB.prototype.getKeyByName = function (name)
{
    var keys = this.getKeys();
    for (var id in keys)
    {
        if (keys[id].name == name)
        {
            return this.getKey(id);
        }
    }
    return null;
};


DB.prototype.getKeyByIdOrName = function (keyIdOrName)
{
    return this.getKey(keyIdOrName) || this.getKeyByName(keyIdOrName);
};


/**
 * Get secret of a key.
 */
DB.prototype.getKeySecret = function (keyId)
{
    var key = this.getKey(keyId);
    return key ? key.secret : null;
};


/**
 * Get access level of a key for a door.
 */
DB.prototype.getKeyAccess = function (keyId, doorId)
{
    var door = this.getDoor(doorId);
    if (!door)
        return -1;
    if (!door.access)
        door.access = {};

    return door.access[keyId] || DB.XS.NONE;
};


/**
 * Get access level of a key for all doors.
 */
DB.prototype.getKeyAccessAll = function (keyId)
{
    var doors = this.getDoors();
    var access = {};

    for (var doorId in doors)
    {
        var door = doors[doorId];
        if (!door)
            continue;
        if (!door.access)
            door.access = {};

        access[doorId] = door.access[keyId] || DB.XS.NONE;
    }

    return access;
};


/**
 * Set access level of a key for a door.
 */
DB.prototype.setKeyAccess = function (keyIdOrName, doorIdOrName, level, onSave)
{
    var key = this.getKeyByIdOrName(keyIdOrName);
    if (!key)
    {
        if (typeof onSave == 'function')
            onSave(new Error("Key not found: "+ keyIdOrName));
        return false;
    }

    var door = this.getDoorByIdOrName(doorIdOrName);
    if (!door) {
        if (typeof onSave == 'function')
            onSave(new Error("Door not found: "+ doorIdOrName));
        return false;
    }

    this.conf.set(['doors', door.id, 'access', key.id].join(':'), level);

    if (onSave)
        onSave = onSave.bind({key: key, door: door});

    this.save(onSave, {key: key, door: door});
    return true;
};


/**
 * Reset access levels of a key to default.
 */
DB.prototype.resetKeyAccess = function (keyId, onSave)
{
    var doors = this.getDoors();
    for (var doorId in doors)
    {
        this.conf.set(['doors', doorId, 'access', keyId].join(':'),
                      this.getKeyAccess(this.defaultKeyId, doorId));
    }
    this.save(onSave);
}


/**
 * Delete key from database.
 */
DB.prototype.removeKey = function (keyIdOrName, onSave)
{
    var key = this.getKeyByIdOrName(keyIdOrName);
    if (!key)
    {
        if (typeof onSave == 'function')
            onSave(new Error("Key not found."));
        return false;
    }

    var doors = this.getDoors();
    for (var doorId in doors)
    {
        this.conf.clear(['doors', doorId, 'access', key.id].join(':'));
    }

    this.conf.clear('keys:'+key.id);
    this.save(onSave);
    return true;
};


/**
 * Set secret.
 */
DB.prototype.setKeySecret = function (keyId, secret, onSave)
{
    this.conf.set(['keys', keyId, 'secret'].join(':'), secret)
    this.save(onSave);
    return true;
}


/**
 * Set access level of a device for a door.
 */
DB.prototype.setKeyName = function (keyIdOrName, name, onSave)
{
    var keyId;

    var key = this.getKeyByIdOrName(keyIdOrName);
    if (key)
    {
        keyId = key.id;
        var key2 = this.getKeyByName(name)
        if (key2 && key2.id != key.id)
        {
            if (typeof onSave == 'function')
                onSave(new Error("Key name already in use."));
            return false;
        }
    }
    else if (keyIdOrName.match(/^[0-9a-f]{16}$/i))
    {
        keyId = keyIdOrName;
    }
    else
    {
        if (typeof onSave == 'function')
            onSave(new Error("Key not found."));
        return false;
    }

    this.conf.set(['keys', keyId, 'name'].join(':'), name)
    this.save(onSave);
    return true;
};


/**
 * Save database to file.
 */
DB.prototype.save = function (onSave, args)
{
    if (this.saving)
        clearTimeout(this.saving);

    this.saving = setTimeout(function() {
        this.saving = null;
    }.bind(this), 10000);

    this.conf.save();

    if (typeof onSave == 'function')
        onSave(null, args);

    if (!this.exists)
        this.watch();
}

DB.XS = {
    NONE: 0,
    USER: 1,
    ADMIN: 2,
    ROOT: 3,
};


DB.XS_NAME = {
    0: 'none',
    1: 'user',
    2: 'admin',
    3: 'root',
};

DB.XS_LEVEL = {
    none: 0,
    user: 1,
    admin: 2,
    root: 3,
};

module.exports = DB;
