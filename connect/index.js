"use strict";

var Q = require( 'q' );
var fs = require( 'fs' );
var util = require( 'util' );
var http2 = require( 'http2' );
var thsBuilder = require( 'ths' );
var x509 = require( 'x509' );

var http2tor = require( './http2tor' );
var peerDb = require( './peerdb' );
var cerr = require('./error');

var getClassName = function(o) { 
    if (o == null) {
      return "NULL";
    }
    var funcNameRegex = /function (.{1,})\(/;
    var results = (funcNameRegex).exec(o.constructor.toString());
    return (results && results.length > 1) ? results[1] : "";
  };

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
    
    getService: function( servicename )
    {
        for (var i = 0, l = this.services.length; i < l; i++) {
            var service = this.services[i];
            if (service.servicename === servicename) {
                return service;
            }
        }
        return null;
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
                endpoint.close();
                console.log( 'Refused an incoming connection' );
            }
        });
        this.server.listen( port, 'localhost' );
    },
    
    onRequest: function( user, request, response )
    {
        var parts = request.url.split('/');
        if (parts.length == 2 &&
            parts[0] === "" &&
            parts[1] === "services") {
            var serviceList = this.services.map( function( service ) { return service.servicename; } );
            response.writeHead( 200, { "Content-Type": "application/json" } );
            response.end( JSON.stringify( serviceList ) );
        } else if (parts.length > 2 &&
            parts[0] === "" &&
            parts[1] === "services") {
            var service = this.getService( parts[2] );
            if ( !service ) {
                response.writeHead( 404, { "Content-Type": "application/json" } );
                response.end( JSON.stringify( undefined ) );
            } else {
                service.callback( user, request, response, false );
            }
        } else {
            console.log( 'Got a request from my old friend ' + user.username );
            response.end('Hello ' + user.username );
        }
    },
    
    onConnection: function( user, endpoint )
    {
        console.log( 'Got connection from my old friend ' + user.username );
        console.log( 'Got endpoint!' + getClassName(endpoint));
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
    
    _peerRequest: function( user, options, post_data )
    {
        var deferred = Q.defer();
        var maxAttempts = options.maxAttempts|| 5;
        var attemptDelay = options.attemptDelay || 3000;
        var attemptDelayFactor = options.attemptDelayFactor || 2;

        this._getUserPeers( user )
        .then( function( peers ) {
            function tryConnect( i, attempt )
            {
                if (i == peers.length) {
                    if (attempt >= maxAttempts - 1) {
                        deferred.reject( cerr.create( "Could not connect to any of the user's peers", cerr.E_CONNECT_FAIL ) );
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
                    http2tor.request( requestOptions, post_data )
                    .then( function( body ) {
                        deferred.resolve( body );
                    })
                    .catch( function( err ) {
                        console.log( err.toString() );
                        if (err instanceof cerr.ConnectError &&
                            err.errno == cerr.E_CONNECT_BAD) {
                            /* Bad certificate or fingerprint or negotiated protocol;
                             * don't retry this peer */
                            peers = peers.splice(i, 1);
                            tryConnect( i, attempt );
                        } else {
                            tryConnect( i + 1, attempt );
                        }
                    });
                }
            }
            if (peers.length == 0) {
                deferred.reject( cerr.create( 'Could not find any peers for the user', cerr.E_CONNECT_FAIL ) );
            } else {
                tryConnect( 0, 0 );
            }
        })
        .catch( function( err ) { deferred.reject( err ) } )
        .done();
        
        return deferred.promise;
    },
    
    userServiceRequest: function( username, servicename, path, post_data )
    {
        var user = this.getUserFromName( username );
        var service = this.getService( servicename );
        if (!user) {
            throw new Error( 'No such user' );
        } else if (!service) {
            throw new Error( 'No such service' );
        } else {
            var options = {
                path: '/services/' + servicename + '/' + path,
                method: (post_data !== undefined ? 'POST' : 'GET')
            }
            return this._peerRequest( user, options, post_data );
        }
    },
    
    userRequest: function( username, options, post_data )
    {
        var user = this.getUserFromName( username );
        return this._peerRequest( user, options, post_data );
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
         * and set its port to localhost:serverPort */
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
         * This might take a while if we just created it,
         * since TOR will be busy creating keys etc. */
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
