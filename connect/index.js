"use strict";

var Q = require( 'q' );
var fs = require( 'fs' );
var util = require( 'util' );
var http2 = require( 'http2' );
var thsBuilder = require( 'ths' );
var x509 = require( 'x509' );

var http2tor = require( './http2tor' );
var peerDb = require( './peerdb' );

function Connect( key, cert, socksHost, socksPort, onionAddress )
{
    this.key = key;
    this.cert = cert;
    this.parsedCert = x509.parseCert( cert.toString() );
    this.fingerprint = this.parsedCert.fingerPrint;
    this.socksHost = socksHost;
    this.socksPort = socksPort;
    this.onionAddress = onionAddress;
    this.directories = [];
    this.users = [];
    this.services = [];
}

Connect.prototype =
{
    setProxyConn: function()
    {
        http2tor.setupAgents( this.key, this.cert, this.socksHost, this.socksPort );
    },

//    setDirectConn: function()
//    {
//        http2tor.setupAgents( this.key, this.cert );
//    },

    addUser: function( username, certfile )
    {
        var cert = x509.parseCert( certfile.toString() );
        this.users.push( { username: username, cert: cert } );
    },
    
    addService: function( servicename, callback )
    {
        this.services.push( { servicename: servicename, callback: callback } );
    },
    
    getUserFromName: function( username )
    {
        for (var i = 0, l = this.users.length; i < l; i++) {
            var user = this.users[i];
            if (user.username === username) {
                return user;
            }
        }
        return null;
    },
    
    getUserFromCert: function( cert )
    {
        if (!cert)
            return null;
        for (var i = 0, l = this.users.length; i < l; i++) {
            var user = this.users[i];
            if (user.cert.fingerPrint === cert.fingerprint) {
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
        var that = this;
        this.server = http2.createServer( serverOptions, function( request, response ) {
            var user = that.getUserFromCert( request.socket.getPeerCertificate() );
            if ( user ) {
                that.onRequest( user, request, response );
            } else {
                response.writeHead( 403, 'Forbidden' );
                response.end();
                console.log( 'Refused an incoming request' );
            }
        });
        this.server.on('connection', function( socket, endpoint ) {
            var user = that.getUserFromCert( socket.getPeerCertificate() );
            if ( user ) {
                that.onConnection( user, endpoint );
            } else {
                /*if ( cert ) {
                    console.log( 'Got connect request from unrecognized user with fingerprint ' + cert.fingerprint + '!' );
                } else {
                    console.log( 'Got connect request from anonymous!' );
                }*/
                endpoint.close();
                console.log( 'Refused an incoming connection' );
            }
        });
        this.server.listen( port, 'localhost' );
    },
    
    onRequest: function( user, request, response )
    {
        var parts = request.url.split('/');
        if (parts.length === 2 &&
            parts[0] === "" &&
            parts[1] === "services") {
            var serviceList = this.services.map( function( service ) { return service.servicename; } );
            response.writeHead( 200, { "Content-Type": "application/json" } );
            response.end( JSON.stringify( serviceList ) )
        } else {
            console.log( 'Got a request from my old friend ' + user.username );
            response.end('Hello ' + user.username);
        }
    },
    
    onConnection: function( user, endpoint )
    {
        console.log( 'Got connection from my old friend ' + user.username );
    },
    
    _getUserPeers: function( user )
    {
        var fingerprint = user.cert.fingerPrint;
        
        return this.directories.reduce( function ( prev, directory ) {
            return prev.then( function ( allPeers ) {
                return directory.getPeers( fingerprint )
                    .then( function( peers ) {
                        return Q( allPeers.concat( peers ) ); } );
            });
        }, Q.fcall( function () { return [] } ) );
    },
    
    _peerRequest: function( user, options )
    {
        var deferred = Q.defer();

        var maxAttempts = options.maxAttempts|| 4;
        var attemptDelay = options.attemptDelay || 3000;
        var attemptDelayFactor = options.attemptDelayFactor || 2;

        this._getUserPeers( user )
        .then( function( peers ) {
            function tryConnect( i, attempt )
            {
                if (i == peers.length) {
                    if (attempt >= maxAttempts - 1) {
                        deferred.reject( new Error( "Could not connect to any of the user's peers" ) );
                    } else {
                        Q.delay( attemptDelay )
                        .then( function() {
                            attemptDelay = attemptDelay * attemptDelayFactor;
                            tryConnect( 0, attempt + 1 );
                        }).done();
                    }
                } else {
                    var peer = peers[i];
                    var requestOptions = util._extend( {}, options );
                    requestOptions.host = peer.address;
                    requestOptions.port = peer.port;
                    requestOptions.targetCert = user.cert;
                    http2tor.request( requestOptions )
                    .then( function( result ) {
                        deferred.resolve( result );
                    }).catch( function( err ) {
                        console.log( "Error "+err.toString() );
                        tryConnect( i + 1, attempt );
                    }).done();
                }
            }
            if (peers.length == 0) {
                deferred.reject( new Error( 'Could not find any peers for the user' ) );
            } else {
                tryConnect( 0, 0 );
            }
        })
        .catch( function( err ) { deferred.reject( err ) } )
        .done();
        
        return deferred.promise;
    },
    
    userRequest: function( username, options )
    {
        var options = util._extend( {}, options );
        options.getEndpoint = false;
        var user = this.getUserFromName( username );
        return this._peerRequest( user, options );
    },

    userConnect: function( username )
    {
        var user = this.getUserFromName( username );
        return this._peerRequest( user, { getEndpoint: true } )
    },
    
    addDirectory: function( host, port )
    {
        this.directories.push( new peerDb.MistDirectory( host, port ) );
    },
    
    publishPeers: function()
    {
        var peers = [{ type: 'tor', address: this.onionAddress, port: 443 }];
        return this.directories[0].setPeers(peers);
    }
};

function createConnect( options )
{
    var deferred = Q.defer();
    
    var torCmd = options.torCmd !== undefined ? options.torCmd : './tor/tor';
    var torData = options.torData !== undefined ? options.torData : './tor/data';
    var torErrorFn = options.torErrorFn;
    var torMessageFn = options.torMessageFn;
    var torCtrlMessageFn = options.torCtrlMessageFn;
    var key = options.key;
    var cert = options.cert;
    var serverPort = options.serverPort !== undefined ? option.serverPort : 2502;
    var ths = new thsBuilder( torData, undefined, undefined, torErrorFn, torMessageFn, torCtrlMessageFn );
    ths.setTorCommand( torCmd );
    ths.start( false, function() {
        /* Create hidden service mist_node if it does not already exist,
           and set its port to localhost:serverPort */
        var services = ths.getServices();
        var servicePorts;
        for (var i = 0; i < services.length; i++) {
            if (services[i].name == 'mist_node') {
                servicePorts = services[i].ports;
                break;
            }
        }
        if (servicePorts === undefined) {
            ths.createHiddenService( 'mist_node' );
        } else {
            ths.removePorts( 'mist_node', servicePorts );
        }
        ths.addPorts( 'mist_node', ['443 localhost:' + serverPort.toString()] )
        ths.saveConfig();
        
        /* Get the onion address of the hidden service
           This might take a while if we just created it,
           since TOR will be busy creating keys etc. */
        ths.getOnionAddress( 'mist_node', function(err, onionAddress) {
            var c = new Connect( key, cert, 'localhost', ths.socksPort(), onionAddress );
            /* Set up http2tor to use this SOCKS5 connection */
            c.setProxyConn();
            c.startServer( serverPort );
            deferred.resolve( c );
        });
    });
    
    return deferred.promise;
}

exports.createConnect = createConnect;
