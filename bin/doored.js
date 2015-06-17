#!/usr/bin/env node

/*** Door Relay Daemon ***/

var version = '0.1';

var config = {
    init: {
        path: '/run/doored-init.pid',
    },
    db: {
        path: '/var/lib/doored/doored.db',
    },
    log: {
        path: '/var/log/doored/doored.log',
        level: 'info',
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

var fs = require('fs');

/* watchdog - restarts system if not written to in 60 seconds while open */
fs.open('/dev/watchdog', 'a', function (err, fd) {
    if (err)
    {
        log.error(err, 'Error opening watchdog');
        return;
    }

    var buf = new Buffer('.');

    setInterval(function () {
        fs.write(fd, buf, 0, 1, null, function (err, written, string) {
            if (err)
                log.error(err, 'Error writing to watchdog');
        });
    }, 10000);
});

process.on('uncaughtException', function(err) {
    process.removeListener('uncaughtException', arguments.callee);

    console.error(err.stack);
    log.fatal(err);

    var count = log.streams.length;
    var n = 0;

    for (var i = 0; i < count; i++)
    {
        // close stream, flush buffer to disk
        log.streams[i].stream.end();
    }

    process.exit(2);
});

/* allow logs to be flushed */

process.on('exit', function(code) {
    process.exit(code);
});


fs.exists(config.init.path, function (exists) {
    if (exists)
    {
        log.info('Waiting for initialization to finish.');
        var watcher = fs.watch(config.init.path,
                               function (event, filename) {
                                   watcher.close();
                                   run();
                               });
    }
    else
    {
        run();
    }
});


function run()
{
    var DB = require('../lib/db');
    var Door = require('../lib/door');
    var Server = require('../lib/server');

    var w1direct = require('w1direct');
    var w1 = new w1direct.Manager();
    var db = new DB(config.db.path, log);

    var Gpio = require('onoff').Gpio;

    var resetGpio = new Gpio(45, 'low');
    var resetting = false;
    var adminDoor;

    var masters = [
        {
            master: { name: 'master8', subType: '800', devFile: config.w1.device, address: 0x1c },
            doors: [
                new Door({ id: 'x1', idDevice: '01E6270618000069',
                           gpioDoor: [ new Gpio(72, 'low'),
                                       new Gpio(86, 'low'),
                                       new Gpio(504, 'low') ],
                           gpioAccess: [ new Gpio(504, 'low') ] }),
                new Door({ id: 'x2', idDevice: '015040061800009C',
                           gpioDoor: [ new Gpio(73, 'low'),
                                   new Gpio(87, 'low'),
                                   new Gpio(505, 'low') ],
                           gpioAccess: [ new Gpio(505, 'low') ] }),
                new Door({ id: 'x3', idDevice: '01345706180000AE',
                           gpioDoor: [ new Gpio(74, 'low'),
                                       new Gpio(88, 'low'),
                                       new Gpio(506, 'low') ],
                           gpioAccess: [ new Gpio(506, 'low') ] }),
                new Door({ id: 'x4', idDevice: '015940061800000A',
                           gpioDoor: [ new Gpio(75, 'low'),
                                       new Gpio(89, 'low'),
                                       new Gpio(507, 'low') ],
                           gpioAccess: [ new Gpio(507, 'low') ] }),
                new Door({ id: 'x5', idDevice: '017B1B0618000037',
                           gpioDoor: [ new Gpio(76, 'low'),
                                       new Gpio(36, 'low'),
                                       new Gpio(508, 'low') ],
                           gpioAccess: [ new Gpio(508, 'low') ] }),
                new Door({ id: 'x6', idDevice: '0144F005180000DC',
                           gpioDoor: [ new Gpio(77, 'low'),
                                       new Gpio(37, 'low'),
                                       new Gpio(509, 'low') ],
                           gpioAccess: [ new Gpio(509, 'low') ] }),
/*
                new Door({ id: 'x7', idDevice: '017C1B06180000B2',
                           gpioDoor: [ new Gpio(78, 'low'),
                                   new Gpio(61, 'low'),
                                   new Gpio(510, 'low') ] }),
                new Door({ id: 'x8', idDevice: '014BF005180000F8',
                           gpioDoor: [ new Gpio(79, 'low'),
                                   new Gpio(511, 'low') ] }),
*/
            ],
        },
        /*
          {
          master: { name: 'master1', subType: '100', devFile: config.w1.device, address: 0x18 },
          doors: [ new Door({ id: 'p1',
          gpioDoor: [  ] }) ],
          },
          {
          master: { name: 'master2', subType: '100', devFile: config.w1.device, address: 0x19 },
          doors: [ new Door({ id: 'p2',
          gpioDoor: [  ] }) ],
          },
          {
          master: { name: 'master3', subType: '100', devFile: config.w1.device, address: 0x1a },
          doors: [ new Door({ id: 'p3',
          gpioDoor: [ ] }) ],
          },
        */
        {
            master: { name: 'master4', subType: '100', devFile: config.w1.device, address: 0x1b },
            doors: [ new Door({ id: 'p4',
                                admin: true,
                                logKeyId: false }) ],
        },
    ];

    for (var i = 0; i < masters.length; i++)
    {
        var m = masters[i];
        log.info('Initializing '+ m.master.name +'..');
        w1.registerDS2482Master(m.master);
        for (var j = 0; j < m.doors.length; j++)
        {
            log.info('..bus '+ j);
            var door = m.doors[j];
            door.set({name: db.getDoorName(door.id), db: db, log: log,
                      w1: w1, master: m.master.name, bus: j});

            if (door.admin)
                adminDoor = door;

            door.on('idRemoved', function (door) {
                log.error('ID device removed from door '+ door.id);
                /* ID chip removed, power cycle master */
                process.exit(3);
            });

            door.search();
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

    log.info('Door Relay Daemon is ready.');
}
