'use strict';

var Q = require( 'q' );
var util = require('util');
var http2 = require('http2');
var https = require('https');
var SocksAgent = require('socks5-https-client/lib/Agent');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

var _useProxy = true;

var _http2Agent;
var _socksAgent;
var _httpsAgent;

function createHttpsAgent( key, cert ) {
    var agentOptions = {
        ALPNProtocols: ['h2'],
        NPNProtocols: ['h2'],
        key: key,
        cert: cert,
        rejectUnauthorized: false
    };
    return new https.Agent( agentOptions );
}

function createSocksAgent( key, cert, socksHost, socksPort ) {
    var agentOptions = {
        ALPNProtocols: ['h2'],
        NPNProtocols: ['h2'],
        socksHost: socksHost,
        socksPort: socksPort,
        key: key,
        cert: cert,
        rejectUnauthorized: false
    };
    return new SocksAgent( agentOptions );
}

function SocksHttp2Agent( options ) {
    http2.Agent.call( this, options );
}

util.inherits( SocksHttp2Agent, http2.Agent );

SocksHttp2Agent.prototype.secureRequest = function( options, body ) 
{
    var that = this;
    var deferred = Q.defer();
    var key = ['false', options.host, options.port].join(':');
    
    if (options.getEndpoint && key in this.endpoints) {
        deferred.accept( this.endpoints[key] );
    } else {
        var request;
        if (!(key in this.endpoints)) {
            this.once(key, function(endpoint) {
                if (!endpoint) {
                    deferred.reject( new Error( 'An HTTP2 connnection was not established.' ) );
                } else {
                    var cert = endpoint.socket.getPeerCertificate();
                    if (options.targetCert &&
                        (!cert || !cert.fingerprint ||
                         cert.fingerprint !== options.targetCert.fingerPrint)) {
                        deferred.reject( new Error( 'Fingerprint mismatch' ) );
                        endpoint.close();
                    } else if (options.getEndPoint) {
                        deferred.resolve( endpoint );
                    }
                }
            });
        }
        request = this.request( options );
        request.on( 'response', function( res ) {
            var body = '';
            res.setEncoding('utf8');
            res.on('data', function(chunk) {
                body += chunk;
            });
            res.on('end', function() {
                if (options.getEndpoint) {
                    deferred.resolve( that.endpoints[key] );
                } else {
                    deferred.resolve( body );
                }
            });
        });
        request.on( 'error', function( err ) {
            deferred.reject( err );
        });
        if (body !== undefined) {
            request.write( body );
        }
        request.end();
    }
    return deferred.promise;
}

exports.setupAgents = function( key, cert, socksHost, socksPort ) {
    _http2Agent = new SocksHttp2Agent( {} );
    _httpsAgent = createHttpsAgent( key, cert );
    if ( socksHost && socksPort ) {
        _socksAgent = createSocksAgent( key, cert, socksHost, socksPort );
    } else {
        _socksAgent = undefined;
    }
};

/* Copied from HTTP2 library. This must not resolve to true,
 * since it will make the library create a new (non-SOCKS5) agent.
 */
function hasAgentOptions(options) {
    return options.pfx != null ||
        options.key != null ||
        options.passphrase != null ||
        options.cert != null ||
        options.ca != null ||
        options.ciphers != null ||
        options.rejectUnauthorized != null ||
        options.secureProtocol != null;
}

function requestDirect( options, body )
{
    options = util._extend( {}, options );
    options.agent = _httpsAgent;
    return _http2Agent.secureConnect( options, body );
}

function requestProxy( options, body )
{
    if ( !_socksAgent ) {
        throw new Error( 'SOCKS5 proxy settings have not been set before request' );
    }
    if ( options.agent != null || hasAgentOptions( options ) ) {
        throw new Error( 'Agent options cannot be specified with a request' );
    };
    options = util._extend( {}, options );
    options.agent = _socksAgent;
    return _http2Agent.secureRequest( options, body );
}

function requestAuto( options, body )
{
    if ( _useProxy ) {
        return requestProxy( options, body );
    } else {
        return requestDirect( options, body );
    }
};

exports.request = requestAuto;
exports.requestDirect = requestDirect;
