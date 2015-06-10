var DB = require('./db');
var net = require('net');
var printf = require('printf');

const LOW = 0, HIGH = 1;
const ON = 0, OFF = 1;

var Server = function (port, host, log, db, masters, door, leds)
{
    function resetLEDs ()
    {
        leds.red.write(OFF);
        leds.green.write(OFF);
        leds.blue.write(ON);
    }

    function setLED (col, state)
    {
        leds[col].write(state);
    }

    var server = net.createServer(function (socket) {
        var reading = false;
        var disconnected = false;
        var level = DB.XS.NONE;
        var initDB = false;
        var fail = 0;

        socket.on('error', function(err) {
            log.debug(err, 'Server: socket error.');
        });

        socket.on('close', function(had_error) {
            log.debug('Server: socket closed.  Had error? '+ had_error);
            disconnected = true;
            door.removeListener('auth', onAuth);
            resetLEDs();
        });

        resetLEDs();
        socket.write('Welcome to DooReMI -- Door Relay Management Interface.\n\n');
        login();

        function login ()
        {
            if (db.exists)
            {
                socket.write('Touch your key on the reader to log in.\n');
            }
            else
            {
                socket.write('The database is empty.  Touch the root key on the reader.\n');
                door.set({ genSecret: true });
                initDB = true;
            }

            startReading();
            door.once('auth', onAuth);
        }

        function onRead (id)
        {
            if (disconnected)
            {
                door.removeListener('read', onRead);
                return;
            }
            if (reading)
                return;

            socket.write('\n(o) ');
            cmdKeyShow(id);
            cmdPrompt();
        }

        function onAuth (id, result)
        {
            if (disconnected)
                return;

            stopReading();
            door.set({ genSecret: false });

            if (true != result)
            {
                socket.write('Authentication failed.\n\n');
                ++fail <3 ? login() : socket.end();
                return;
            }

            if (initDB) // initialize empty database: grant root access to the first key
            {
                db.setName(id, 'root');
                for (var i = 0; i < masters.length; i++)
                    for (var j = 0; j < masters[i].doors.length; j++)
                        db.setAccess(id, masters[i].doors[j].id, DB.XS.ROOT);
            }
            else if (!(db.getAccess(id, door.id) >= DB.XS.ADMIN))
            {
                socket.write('Access denied.  An admin key is needed to proceed.\n\n');
                ++fail <3 ? login() : socket.end();
                return;
            }

            cmdHelp();
            cmdPrompt();

            door.on('read', onRead);

            socket.on('data', function(c) {
                var understood = true;
                var args = c.toString().replace(/^[ \t]*/, '').split(/[ \r\n]/);
                if ('cancel' == args[0].toLowerCase())
                {
                    stopReading();
                    cmdPrompt();
                    return;
                }
                if (reading)
                    return;
                switch (args[0].toLowerCase())
                {
                case '?':
                case 'h':
                case 'he':
                case 'hel':
                case 'help':
                    cmdHelp();
                    break;
                case 'whoami':
                    cmdKeyShow(id);
                    break;

                case 'k':
                case 'ke':
                case 'key':
                    switch ((args[1] || '').toLowerCase())
                    {
                    case 's':
                    case 'sh':
                    case 'sho':
                    case 'show':
                        if (args[2])
                            cmdKeyShow(args[2]);
                        else
                            readID(function (id) {
                                cmdKeyShow(id);
                                cmdPrompt();
                            });
                        break;
                    case 'l':
                    case 'li':
                    case 'lis':
                    case 'list':
                        cmdKeyList();
                        break;

                    case 'r':
                    case 're':
                    case 'ren':
                    case 'rename':
                        if (args[3])
                            cmdKeyRename(args[3], args[2]);
                        else if (args[2])
                            readID(function (id) {
                                cmdKeyRename(id, args[2]);
                                cmdPrompt();
                            });
                        else
                            understood = false;
                        break;

                    case 'd':
                    case 'de':
                    case 'del':
                    case 'delete':
                        if (args[2])
                            cmdKeyDelete(args[2]);
                        else
                            understood = false;
                        break;

                    case 'i':
                    case 'in':
                    case 'ini':
                    case 'init':
                        if (args[2])
                            cmdKeyInit(args[2]);
                        else
                            understood = false;
                        break;

                    default:
                        understood = false;
                    }
                    break;


                case 'a':
                case 'x':
                case 'xs':
                case 'access':
                    switch ((args[1] || '').toLowerCase())
                    {
                    case 'g':
                    case 'gr':
                    case 'gra':
                    case 'grant':
                        if (args[4])
                            cmdDoorGrant(args[4], args[2], args[3]);
                        else if (args[2])
                            readID(function (id) {
                                cmdDoorGrant(id, args[2], args[3]);
                                cmdPrompt();
                            });
                        else
                            understood = false;
                        break;

                    case 'r':
                    case 're':
                    case 'rev':
                    case 'revoke':
                        if (args[3])
                            cmdDoorRevoke(args[3], args[2]);
                        else if (args[2])
                            readID(function (id) {
                                cmdDoorRevoke(id, args[2]);
                                cmdPrompt();
                            });
                        else
                            understood = false;
                        break;

                    default:
                        understood = false;
                    }
                    break;

                case 'ex':
                case 'exit':
                case 'by':
                case 'bye':
                    socket.write('Bye.\n');
                    socket.end();
                    return;

                default:
                    if (args[0])
                        understood = false;
                }
                if (!understood)
                    socket.write('Er, not sure what you mean.  Try help.\n');
                if (!reading)
                    cmdPrompt();
            });
        }

        function cmdPrompt ()
        {
            socket.write('# ');
        }

        function startReading ()
        {
            setLED('red', ON);
            socket.write('(o) ');
            reading = true;
        }

        function stopReading ()
        {
            setLED('red', OFF);
            socket.write('\n');
            reading = false;
            door.removeListener('read', onReadID);
        }

        function onReadID (id) {
            if (disconnected)
                return;
            stopReading();
            cont(id);
        }

        function readID(cont)
        {
            startReading();
            door.once('read', onReadID);
        }

        function cmdHelp ()
        {
            var fmt = '';
            for (var i=0; i<12; i++)
                fmt += '  % -45s%s\n';

            socket.write(
                printf('Commands:\n' + fmt,
                       'help',                                 'This message.',
                       'whoami',                               'Show info about the key used to log in.',
                       'key list',                             'Show all keys.',
                       'key show [<id> | <name>]',             'Show info about <id>, <name>, or key on reader.',
                       'key init <name>',                      'Initialise key on the reader and assign a name to it.',
                       '',                                     'Writes new secret and resets door access list to default.',
                       'key rename [<id> | <name>]',           'Rename key.',
                       'key delete [<id> | <name>]',           'Delete key from the system.',
                       'access grant <door> <level> [<id> | <name>]', 'Grant access to <door> at <level> for <id>, <name>, or key on reader.',
                       'access revoke <door> [<id> | <name>]',        'Revoke access to <door> for <id>, <name>, or key on reader.',
                       'cancel',                               'Cancel reading a key at a (o) prompt.',
                       'exit / bye',                           'Leave session.'
                      ));

            fmt = '';
            for (var i=0; i<4; i++)
                fmt += '  % -25s%s\n';

            socket.write(
                printf('\nAccess levels:\n' + fmt,
                       '0: no access' ,     '',
                       '1: user access' ,  'Can open door.',
                       '2: admin access' , 'Can give user access to next authenticated key while door is open.',
                       '3: root access',   'Can give admin access to next authenticated key while door is open.'
                      ));
        }

        function writeKeyHeader ()
        {
            var doors = '';
            for (var i = 0; i < masters.length; i++)
                for (var j = 0; j < masters[i].doors.length; j++)
                    doors += printf('% 3d', masters[i].doors[j].id);
            socket.write(printf('% -16s  %-16s    Door:%s\n', 'Key ID', 'Name', doors));
            for (var i=0; i<80; i++)
                socket.write('-');
            socket.write('\n');
        }

        function writeKeyEntry (rec)
        {
            var access = ''
            for (var i in rec.access)
                access += printf('% 3s', rec.access[i] || ' ');
            socket.write(printf('% -16s  %-24s %s\n', rec.id, rec.name, access));
        }

        function cmdKeyShow (id)
        {
            var rec = db.get(id) || db.getByName(id);
            if (null == rec)
            {
                socket.write('Key not found: '+ id +'\n');
                return;
            }
            writeKeyHeader();
            writeKeyEntry(rec);
        }

        function cmdKeyList ()
        {
            writeKeyHeader();
            for (var id in db.getIDs())
                writeKeyEntry(db.get(id));
        }

        function cmdKeyRename (id, name)
        {
            var rec = db.get(id) || db.getByName(id);
            if (null == rec)
            {
                socket.write('Key not found: '+ id +'\n');
                return;
            }
            if (db.getByName(name))
            {
                socket.write('Name is already in use: '+ name +'.  Pick a different one.\n');
                return;
            }
            db.setName(rec.id, name);
            socket.write('Key '+ id +' renamed to '+ name +'\n');
        }

        function cmdKeyDelete (id)
        {
            var rec = db.get(id) || db.getByName(id);
            if (null == rec)
            {
                socket.write('Key not found: '+ id +'\n');
                return;
            }
            db.remove(rec.id);
            socket.write('Key '+ id +' removed from the system.\n');
        }

        function cmdKeyInit (name)
        {
            door.set({ genSecret: true });
            startReading();
            door.once('reset', function (id, result) {
                if (disconnected)
                    return;
                door.set({ genSecret: false });
                stopReading();
                if (true == result)
                {
                    var rec = db.getByName(name);
                    if (rec && rec.id != id)
                    {
                        socket.write('Name is already taken: '+ name +'.  Pick something else.\n');
                        return;
                    }
                    db.setName(id, name);
                    socket.write('Key '+ id +' was reset and assigned to '+ name +'.\n');
                }
                else
                {
                    socket.write('Reset failed.  Try again!\n');
                }
                cmdPrompt();
            });
        }

        function cmdDoorGrant (id, door, level)
        {
            var rec = db.get(id) || db.getByName(id);
            if (null == rec)
            {
                socket.write('Key not found: '+ id +'\n');
                return;
            }
            db.setAccess(rec.id, door, level);
            socket.write('Access granted to '+ (rec.name || rec.id) + ' for door #'+ door +' at level '+ level +'.\n');
        }

        function cmdDoorRevoke (id, door)
        {
            var rec = db.get(id) || db.getByName(id);
            if (null == rec)
            {
                socket.write('Key not found: '+ id +'\n');
                return;
            }
            db.setAccess(rec.id, door, 0);
            socket.write('Access revoked from '+ (rec.name || rec.id) + ' for door #'+ door +'.\n');
        }

    });

    try
    {
        server.listen(port, host);
    }
    catch (err)
    {
        console.error(err);
    }
};

module.exports = Server;
