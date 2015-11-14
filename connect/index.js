"use strict";

var fs = require('fs');
var util = require('util');
var http2 = require('http2');
var thsBuilder = require('ths');

var http2tor = require('./http2tor');
var peerDb = require('./peerdb');

//var x509 = require('x509');

function Connect( key, cert, socksHost, socksPort, onionAddress )
{
    this.key = key;
    this.cert = cert;
    this.socksHost = socksHost;
    this.socksPort = socksPort;
    this.onionAddress = onionAddress;
    this.directories = [];
    this.users = [];
}

Connect.prototype = {
    setProxyConn: function() {
        http2tor.setProxyConn( this.key, this.cert, this.socksHost, this.socksPort );
    },

    getUser: function( cert )
    {
        for (var i = 0, l = this.users.length; i < l; i++) {
            var user = this.users[i];
            if (user.cert.fingerprint == cert.fingerprint) {
                return user;
            }
        }
        return null;
    },
    
    startServer: function( port )
    {
        var serverOptions = {
            key: this.key,
            cert: this.cert,
            requestCert: true,
            rejectUnauthorized: false
        };
        this.server = http2.createServer( serverOptions, function(request, result) {
            var cert = request.socket.getPeerCertificate();
            var user;
            var fingerprint;
            if ( cert ) {
                fingerprint = cert.fingerprint;
                user = this.getUser( cert );
            }
            if ( user ) {
                console.log( 'Got connect request from my old friend ' + user.name );
            } else if ( fingerprint ) {
                console.log( 'Got connect request from unrecognized user with fingerprint ' + fingerprint + '!' );
            } else {
                console.log( 'Got connect request from anonymous!' );
                fingerprint = 'Anonymous';
            }
            result.end('Hello world! ' + fingerprint);
        });
        this.server.listen( port, 'localhost' );
    },
    
    addDirectory: function( host, port )
    {
        this.directories.push( new peerDb.MistDirectory( host, port ) );
    },
    
    addUser: function( username, certfile )
    {
        // TODO: Read certificates
        //var cert = x509.parseCert( certfile );
        //this.users.push( { username: username, cert: cert } );
    },
    
    publishPeers: function()
    {
        var peers = [{ type: 'tor', address: this.onionAddress, port: 443 }];
        for (var i = 0, l = this.directories.length; i < l; i++) {
            var directory = this.directories[i];
            directory.setPeers( peers );
        }
    }
};

function createConnect( options, cb )
{
    var torCmd = options.torCmd !== undefined ? options.torCmd : './tor/tor';
    var torData = options.torData !== undefined ? options.torData : './tor/data';
    var torErrorFn = options.torErrorFn;
    var torMessageFn = options.torMessageFn;
    var torCtrlMessageFn = options.torCtrlMessageFn;
    var key = options.key;
    var cert = options.cert;
    var serverPort = options.serverPort !== undefined ? option.serverPort : 2502;
    var ths = new thsBuilder( torData, undefined, undefined, torErrorFn, torMessageFn, torCtrlMessageFn );
    ths.setTorCommand(torCmd);
    ths.start( false, function() {
        ths.getOnionAddress( 'mist_node', function(err, onionAddress) {
            var c = new Connect( key, cert, 'localhost', ths.socksPort(), onionAddress );
            // Set up http2tor to use this SOCKS5 connection
            c.setProxyConn();
            c.startServer( serverPort );
            if (cb)
                cb( c );
        });
    });
}

exports.createConnect = createConnect;
