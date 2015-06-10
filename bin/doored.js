#!/usr/bin/env node

/*** Door Relay Daemon ***/

var version = '0.1';

var config = {
    db: {
        path: '/var/lib/doored/doored.db',
    },
    log: {
        path: '/var/log/doored/doored.log',
        level: 'info'
    },
    w1: {
        device: '/dev/i2c-2',
    },
    server: {
        port: 2323,
        address: '0.0.0.0',
    }
};

var bunyan = require('bunyan');
var log = bunyan.createLogger({
    name: 'doored',
    streams: [{
        type: 'rotating-file',
        level: config.log.level,
        path: config.log.path,
        period: '1d',   // daily rotation
        count: 10       // keep logs for 10 days back
    }],
});

var DB = require('../lib/db');
var Door = require('../lib/door');
var Server = require('../lib/server');

var w1direct = require('w1direct');
var w1 = new w1direct.Manager();
var db = new DB(config.db.path, log);

var Gpio = require('onoff').Gpio;

var masters = [
/*
    {
        master: { name: 'master1', subType: '100', devFile: config.w1.device, address: 0x18 },
        doors: [ new Door({ id: 9, gpio: [  ], log: log }) ],
    },
    {
        master: { name: 'master2', subType: '100', devFile: config.w1.device, address: 0x19 },
        doors: [ new Door({ id: 10, gpio: [  ], log: log }) ],
    },
    {
        master: { name: 'master3', subType: '100', devFile: config.w1.device, address: 0x1a },
        doors: [ new Door({ id: 11, gpio: [ ], log: log }) ],
    },
*/
    {
        master: { name: 'master4', subType: '100', devFile: config.w1.device, address: 0x1b },
        doors: [ new Door({ id: 0, gpio: new Gpio(2, 'high'), invGpio: true, admin: true, log: log }) ],
    },
    {
        master: { name: 'master8', subType: '800', devFile: config.w1.device, address: 0x1c },
        doors: [
            new Door({ id: 1, gpio: [ new Gpio(72, 'low'), new Gpio(86, 'low') ], log: log }),
            new Door({ id: 2, gpio: [ new Gpio(73, 'low'), new Gpio(87, 'low') ], log: log }),
            new Door({ id: 3, gpio: [ new Gpio(74, 'low'), new Gpio(88, 'low') ], log: log }),
            new Door({ id: 4, gpio: [ new Gpio(75, 'low'), new Gpio(89, 'low') ], log: log }),
            new Door({ id: 5, gpio: [ new Gpio(76, 'low'), new Gpio(36, 'low') ], log: log }),
            new Door({ id: 6, gpio: [ new Gpio(77, 'low'), new Gpio(37, 'low') ], log: log }),
            new Door({ id: 7, gpio: [ new Gpio(78, 'low'), new Gpio(61, 'low') ], log: log }),
            new Door({ id: 8, gpio: [ new Gpio(79, 'low') ], log: log }),
        ],
    },
];

var adminDoor;

for (var i = 0; i < masters.length; i++)
{
    var m = masters[i];
    log.info('Initializing '+ m.master.name +'..');
    w1.registerDS2482Master(m.master);
    var buses = (m.master.subType == '800') ? 8 : 1;
    for (var j = 0; j < buses; j++)
    {
        log.info('..bus '+ j);
        var door = m.doors[j];
        door.set({db: db, w1: w1, master: m.master.name, bus: j});
        door.search();
        if (door.admin)
            adminDoor = door;
    }
}

log.info('Starting admin server..');

var srv = new Server(config.server.port, config.server.address,
                     log, db, masters, adminDoor,
                     {
                         red: new Gpio(2, 'high'),
                         green: new Gpio(22, 'high'),
                         blue: new Gpio(23, 'low'),
                     });

log.info('Ready.');