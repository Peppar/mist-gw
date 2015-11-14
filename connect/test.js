"use strict";

var fs = require('fs');
var connect = require('./index.js');
var http2tor = require('./http2tor.js');

var connectOptions = {
    key: fs.readFileSync('../userA.key'),
    cert: fs.readFileSync('../userA.crt'),
    torCmd: '../tor/tor',
    torData: '../tor-data',
    torErrorFn: console.error,
    torMessageFn: console.log,
    torCtrlMessageFn: function(controlMessage) { console.log( 'Ctrl: ' + controlMessage ) }
};

connect.createConnect( connectOptions, function(c) {
    console.log( 'Connectlib server up and running at ' + c.onionAddress );
    c.addDirectory( '4smogsofurtibfuq.onion', 443 );
    c.publishPeers();
    console.log( 'Published onion address to 4smogsofurtibfuq.onion' );
    
    var hostname = '4smogsofurtibfuq.onion';
    console.log( 'Trying to connect to : ' + hostname );
    
    var requestOptions = {
        host: hostname,
        port: 443,
        path: '/peer/F6:84:3C:B4:E3:FE:A2:01:1A:6D:8D:00:4E:80:B8:EA:7E:ED:CF:65',
        keepAlive: false
    };
    var request = http2tor.request( requestOptions );
    request.setTimeout(20000);
    request.on('response', function(res) {
        console.log('Got response');
        res.setEncoding('utf8');
        res.pipe(process.stdout);
    });
    request.end();
});
