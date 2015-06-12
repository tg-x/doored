var DB = require('./db');
var net = require('net');
var printf = require('printf');

const LOW = 0, HIGH = 1;
const ON = 0, OFF = 1;

var Server = function (port, host, log, db, masters, door, leds)
{
    function resetLeds ()
    {
        leds.red.write(OFF);
        leds.green.write(OFF);
        leds.blue.write(ON);
    }

    function setLed (col, state)
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
            resetLeds();
        });

        resetLeds();
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

        function onError(err) {
            if (err)
            {
                log.error(err);
            }
        };

        function onRead (keyId)
        {
            if (disconnected)
            {
                door.removeListener('read', onRead);
                return;
            }
            if (reading)
                return;

            socket.write('\n(o)\n');
            cmdKeyShow(keyId);
            cmdPrompt();
        }

        function onAuth (keyId, result)
        {
            if (disconnected)
                return;

            stopReading();
            door.set({ genSecret: false });

            if (initDB) // initialize empty database: grant root access to the first key
            {
                db.setKeyName(keyId, 'root', onError);

                for (var i = 0; i < masters.length; i++)
                {
                    for (var j = 0; j < masters[i].doors.length; j++)
                    {
                        var d = masters[i].doors[j];
                        db.setDoorName(d.id, d.id == door.id ? 'console' : d.id);
                        db.setKeyAccess(keyId, d.id, DB.XS.ROOT, onError);
                    }
                }
            }
            else
            {
                if (true != result)
                {
                    socket.write('Authentication failed.\n\n');
                    ++fail <3 ? login() : socket.end();
                    return;
                }


            if (!(db.getKeyAccess(keyId, door.id) >= DB.XS.ADMIN))
            {
                socket.write('Access denied.  An admin key is needed to proceed.\n\n');
                ++fail <3 ? login() : socket.end();
                return;
            }
            }
            cmdHelp();
            cmdPrompt();

            door.on('read', onRead);

            socket.on('data', function(c) {
                var understood = true;
                var args = c.toString().replace(/^[ \t]*/, '').split(/[ \r\n]/);

                switch (args[0].toLowerCase())
                {
                case 'a':
                case 'ab':
                case 'abo':
                case 'abor':
                case 'abort':
                case 'c':
                case 'ca':
                case 'can':
                case 'canc':
                case 'cance':
                case 'cancel':
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
                    cmdKeyShow(keyId);
                    break;

                case 'd':
                case 'do':
                case 'doo':
                case 'door':
                    switch ((args[1] || '').toLowerCase())
                    {
                    case 'r':
                    case 're':
                    case 'ren':
                    case 'rena':
                    case 'renam':
                    case 'rename':
                        if (args.length >= 4)
                            cmdDoorRename(args[2], args[3]);
                        else
                            understood = false;
                        break;

                    default:
                        understood = false;
                    }

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
                            readId(function (keyId) {
                                cmdKeyShow(keyId);
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
                    case 'rena':
                    case 'renam':
                    case 'rename':
                        if (args[3])
                            cmdKeyRename(args[3], args[2]);
                        else if (args[2])
                            readId(function (keyId) {
                                cmdKeyRename(keyId, args[2]);
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

                    case 'g':
                    case 'ge':
                    case 'gen':
                    case 'gene':
                    case 'gener':
                    case 'generat':
                    case 'generate':
                        cmdKeyGenerate();
                        break;

                    default:
                        understood = false;
                    }
                    break;

                case 'a':
                case 'ac':
                case 'acc':
                case 'acce':
                case 'acces':
                case 'access':
                case 'xs':
                    switch ((args[1] || '').toLowerCase())
                    {
                    case 'g':
                    case 'gr':
                    case 'gra':
                    case 'grant':
                        if (args[4])
                        {
                            cmdAccessGrant(args[4], args[2], args[3]);
                            return
                        }
                        else if (args[2])
                        {
                            readId(function (keyId) {
                                cmdAccessGrant(keyId, args[2], args[3]);
                            });
                            return;
                        }
                        else
                            understood = false;
                        break;

                    case 'r':
                    case 're':
                    case 'rev':
                    case 'revoke':
                        if (args[3])
                        {
                            cmdAccessRevoke(args[3], args[2]);
                            return;
                        }
                        else if (args[2])
                        {
                            readId(function (keyId) {
                                cmdAccessRevoke(keyId, args[2]);
                            });
                            return;
                        }
                        else
                            understood = false;
                        break;

                    default:
                        understood = false;
                    }
                    break;

                case 'q':
                case 'qu':
                case 'qui':
                case 'quit':
                case 'ex':
                case 'exi':
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
            setLed('red', ON);
            socket.write('(o) ');
            reading = true;
        }

        function stopReading ()
        {
            setLed('red', OFF);
            socket.write('\n');
            reading = false;
        }

        function readId(cont)
        {
            startReading();
            door.once('read', function (keyId) {
                if (disconnected || !reading)
                    return;
                stopReading();
                cont(keyId);
            });
        }

        function cmdHelp ()
        {
            var fmt = '';
            for (var i=0; i<14; i++)
                fmt += '  % -40s%s\n';

            socket.write(
                printf('Commands:\n' + fmt,
                       'help',                                 'This message.',
                       'whoami',                               'Show info about the key used to log in.',
                       'key list',                             'Show all keys.',
                       'key show <key>',                       'Show info about <id>, <name>, or key on reader.',
                       'key init <name>',                      'Initialise key on the reader and assign a name to it.',
                       '',                                     'Writes new secret and resets door access list to default.',
                       'key generate',                         'Generate new secret and keep access list',
                       'key rename <new_name> <key>',          'Rename key.',
                       'key delete <key>',                     'Delete key from the system.',
                       'access grant <door> <level> <key>',    'Grant access to <door> at <level> for <id>, <name>, or key on reader.',
                       'access revoke <door> <key>',           'Revoke access to <door> for <id>, <name>, or key on reader.',
                       'door rename <new_name>  <door>',       'Rename door.',
                       'abort | cancel',                       'Abort current command at a (o) prompt.',
                       'quit | exit | bye',                    'Leave session.'
                      ));

            socket.write('\nCommands can be abbreviated.  E.g. key gen, k l, d ren, acc gr, xs rev, q\n');

            socket.write('\nArguments:\n'
                         + '  <key>    Key ID or name.  Optional: touch key on reader instead if omitted.\n'
                         + ' <door>    Door ID or name.\n'
                        );

            fmt = '';
            for (var i=0; i<4; i++)
                fmt += '  % -20s%s\n';

            socket.write(
                printf('\nAccess levels:\n' + fmt,
                       '0: none' ,     '',
                       '1: user' ,  'Can open door.',
                       '2: admin' , 'Can give user access to next authenticated key while door is open.',
                       '3: root',   'Can give admin access to next authenticated key while door is open.'
                      ));

            socket.write('\nPrompts:\n'
                         + ' #    Command input.\n'
                         + ' (o)  Key is expected on the reader.\n'
                        );

            socket.write('\n');
        }

        function cmdDoorRename (id, name)
        {
            if (name.length > 8)
            {
                socket.write('Error: Door name should not be longer than 8 characters.\n');
                return;
            }
            if (!db.setDoorName(id, name))
            {
                socket.write('Error: Door name already in use: '+ name +'.\n');
                return;
            }
            socket.write('Door '+ id +' renamed to '+ name +'.\n');
        }

        function printKeyHeader ()
        {
            socket.write(printf('% -16s  % -10s % 5s ', '', '', 'ID:'));
            var doors = '';
            var n = 0;
            for (var i = 0; i < masters.length; i++)
            {
                for (var j = 0; j < masters[i].doors.length; j++)
                {
                    var d = masters[i].doors[j];
                    socket.write(printf(' % 8s', d.id));
                    doors += printf(' % 8s', db.getDoorName(d.id));
                    n++;
                }
            }
            socket.write(printf('\n% -16s  % -10s % 5s %s\n', 'Key ID', 'Name', 'Door:', doors));
            for (var i = 0; i < 16 + 2 + 16 + 1 + 9 * n; i++)
                socket.write('-');
            socket.write('\n');
        }

        function printKeyEntry (key)
        {
            access = db.getKeyAccessAll(key.id);
            var line = '';
            for (var doorId in access)
            {
                var level = access[doorId];
                line += printf(' % 8s', (0 == level) ? '' : DB.XS_NAME[level] || '');
            }
            socket.write(printf('% -16s  %-16s %s\n', key.id, key.name, line));
        }

        function cmdKeyShow (keyIdOrName)
        {
            var key = db.getKeyByIdOrName(keyIdOrName);
            if (null == key)
            {
                socket.write('Key not found: '+ keyIdOrName +'\n');
                return;
            }
            printKeyHeader();
            printKeyEntry(key);
        }

        function cmdKeyList ()
        {
            printKeyHeader();
            for (var id in db.getKeys())
                printKeyEntry(db.getKey(id));
        }

        function cmdKeyRename (id, name)
        {
            if (name.length > 15)
            {
                socket.write('Error: Key name should not be longer than 15 characters.\n');
                return;
            }
            if (db.getKeyByName(name))
            {
                socket.write('Error: Key name is already in use: '+ name +'.  Pick a different one.\n');
                return;
            }
            if (!db.setKeyName(id, name))
            {
                socket.write('Error: Key not found: '+ id +'\n');
                return;
            }
            socket.write('Key '+ id +' renamed to '+ name +'\n');
        }

        function cmdKeyDelete (keyIdOrName)
        {
            if (!db.removeKey(keyIdOrName))
            {
                socket.write('Error: Key not found: '+ keyIdOrName +'.\n');
                return;
            }
            socket.write('Key '+ keyIdOrName +' removed.\n');
        }

        function cmdKeyInit (name)
        {
            if (name.length > 16)
            {
                socket.write('Error: Key name should not be longer than 16 characters.\n');
                return;
            }
            door.set({ genSecret: true });
            startReading();
            door.once('secret', function (keyId, result) {
                if (disconnected)
                    return;
                door.set({ genSecret: false });
                stopReading();
                if (true == result)
                {
                    db.resetKeyAccess(keyId);
                    socket.write('Generated new secret and reset access list for key '+ keyId +'.\n');
                    if (db.setKeyName(keyId, name))
                    {
                        socket.write('Key is now assigned to '+ name +'.\n');
                    }
                    else
                    {
                        socket.write('Error: Name is already taken: '+ name +'.  Pick something else.\n');
                    }
                }
                else
                {
                    socket.write('Error: Secret generation failed.  Try again!\n');
                }
                cmdPrompt();
            });
        }

        function cmdKeyGenerate ()
        {
            door.set({ genSecret: true });
            startReading();
            door.once('secret', function (id, result) {
                if (disconnected)
                    return;
                door.set({ genSecret: false });
                stopReading();
                if (true == result)
                {
                    socket.write('Generated new secret for key '+id+'.\n');
                }
                else
                {
                    socket.write('Error: Secret generation failed.  Try again!\n');
                }
                cmdPrompt();
            });
        }

        function cmdAccessGrant (keyIdOrName, doorIdOrName, level)
        {
            if (level in DB.XS_LEVEL)
            {
                level = DB.XS_LEVEL[level];
            }

            if (!(level in DB.XS_NAME))
            {
                socket.write('Error: invalid level.\n');
                cmdPrompt();
                return;
            }

            db.setKeyAccess(keyIdOrName, doorIdOrName, parseInt(level), function (err) {
                socket.write(err
                             ? err +'\n'
                             : 'Access granted to '+ (this.key.name || this.key.id)
                             +' for '+ (this.door.name || this.door.id) +' door at '+ DB.XS_NAME[level] +' level.\n');
                cmdPrompt();
            });
        }

        function cmdAccessRevoke (keyIdOrName, doorIdOrName)
        {
            db.setKeyAccess(keyIdOrName, doorIdOrName, DB.XS.NONE, function (err) {
                socket.write(err
                             ? err +'\n'
                             : 'Access revoked from '+ (this.key.name || this.key.id)
                             + ' for '+ (this.door.name || this.door.id) +' door.\n');
                cmdPrompt();
            });
        }

    });

    try
    {
        server.listen(port, host);
    }
    catch (err)
    {
        log.error(err);
    }
};

module.exports = Server;
