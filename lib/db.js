var nconf = require('nconf');
var fs = require('fs');

/* record format:
 *   ID: { secret: "a 16-byte secret", access: [ XS_NONE, XS_USER, XS_NONE, XS_ADMIN, ... ] }
 */

/* DB format:
 * {
 *   keys: {
 *     3300000000000000: { secret: "a 16-byte secret" ] }
 *     3300000000000001: { secret: "a 16-byte secret" ] },
 *     3300000000000002: { secret: "a 16-byte secret" ] },
 *   },
 *   doors: {
 *     front: {
 *       3300000000000000: 3,
 *       3300000000000001: 2,
 *       3300000000000002: 1,
 *     },
 *     back: {
 *       3300000000000000: 3,
 *       3300000000000001: 1,
 *     },
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

    this.defaultID = '0';
    this.defaultName = 'default';

    this.saving = false;
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
            db.conf.set(db.defaultID, { name: db.defaultName, access: [] });
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


DB.prototype.get = function (id)
{
    var rec = this.conf.get(id);
    if (!rec)
        return null;

    var res = { id: id };
    for (var k in { name: 1, access: 1 })
        res[k] = rec[k];
    return res;
};


DB.prototype.getByName = function (name)
{
    var store = this.getStore();
    for (var id in store)
        if (store[id].name == name)
            return this.get(id);
    return null;
};


DB.prototype.getStore = function ()
{
    return this.conf.stores.file.store;
};


DB.prototype.getIDs = function ()
{
    var ids = {};
    for (var id in this.getStore())
        ids[id] = 1;
    return ids;
};


/**
 * Get access level of a device for a door.
 */
DB.prototype.getAccess = function (id, door)
{
    var r = this.conf.get(id);
    //log.debug({id: id, door: door, rec: r}'DB.getAccess()');
    if (!r)
        return -1;

    return (r.access)
        ? r.access[door]
        : DB.XS.NONE;
};


/**
 * Get secret of a device.
 */
DB.prototype.getSecret = function (id)
{
    var r = this.conf.get(id);
    return r ? r.secret : null;
};


/**
 * Set access level of a device for a door.
 */
DB.prototype.setAccess = function (id, door, level, onSave)
{
    var r = this.conf.get(id);
    if (!r) {
        if (typeof onSave == 'function')
            onSave(new Error("ID not found in DB"));
        return false;
    }

    if (!(r.access instanceof Array))
        r.access = [];
    r.access[door] = level;
    this.conf.set(id, r);
    this.save(onSave);
    return true;
};


/**
 * Set access level of a device for a door.
 */
DB.prototype.setName = function (id, name, onSave)
{
    var r = this.conf.get(id);
    if (!r) {
        if (typeof onSave == 'function')
            onSave(new Error("ID not found in DB"));
        return false;
    }
    r.name = name;
    this.conf.set(id, r);
    this.save(onSave);
};


/**
 * Set secret and reset access list.
 */
DB.prototype.setSecret = function (id, secret, onSave)
{
    var rec = { secret: secret, access: [] };
    var def = this.get(this.defaultID);
    if (def)
    {
        for (var i in def.access)
            rec.access[i] = def.access[i];
    }
    //console.log('setSecret:',id, secret, rec);
    this.conf.set(id, rec);
    this.save(onSave);
    return true;
}

DB.prototype.remove = function (id, onSave)
{
    var db = this;
    return this.conf.clear(id, function () {
        db.save(onSave);
    });
};

/**
 * Save database to file.
 */
DB.prototype.save = function (onSave)
{
    this.saving = true;
    var db = this;

    this.conf.save(function(err) {
        db.saving = false;
        if (err)
        {
            log.error(err, 'Error saving database.');
            return;
        }
        if (typeof onSave == 'function')
            onSave(err);
        if (!db.exists)
            db.watch();
    });
}

DB.XS = {
    NONE: 0,
    USER: 1,
    ADMIN: 2,
    ROOT: 3,
};

module.exports = DB;
