'use strict';

var util = require('util');
var http2 = require('http2');
var SocksAgent = require('socks5-https-client/lib/Agent');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

var _useProxy = true;
var _globalAgent;
var _key;
var _cert;

function SocksHttp2Agent(options) {
    http2.Agent.call( this, options );
    var agentOptions = {
        log: options.log,
        ALPNProtocols: ['h2'],
        NPNProtocols: ['h2'],
        socksHost: options.socksHost,
        socksPort: options.socksPort,
        key: options.key,
        cert: options.cert,
        rejectUnauthorized: false
    };
    this._httpsAgent = new SocksAgent( agentOptions );
    this.sockets = this._httpsAgent.sockets;
    this.requests = this._httpsAgent.requests;
}

util.inherits(SocksHttp2Agent, http2.Agent);

exports.setProxyConn = function( key, cert, socksHost, socksPort ) {
    var options = {
        key: key,
        cert: cert, 
        socksHost: socksHost,
        socksPort: socksPort
    };
    _key = key;
    _cert = cert;
    _globalAgent = new SocksHttp2Agent( options );
    _useProxy = true;
};

exports.setDirectConn = function( key, cert ) {
    _key = key;
    _cert = cert;
    _useProxy = false;
}

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

function requestDirect( options, cb )
{
    options.key = _key;
    options.cert = _cert;
    options.rejectUnauthorized = false;
    return http2.request( options, cb );
}

function requestProxy( options, cb )
{
    if ( !_globalAgent ) {
        throw new Error( 'SOCKS5 proxy settings have not been set before request' );
    }
    if ( options.agent != null || hasAgentOptions( options ) ) {
        throw new Error( 'Agent options cannot be specified with a request' );
    };
    var tmpGlobalAgent = http2.globalAgent;
    var request;
    try {
        http2.globalAgent = _globalAgent;
        request = http2.request( options, cb );
    } finally {
        http2.globalAgent = tmpGlobalAgent;
    }
    return request;
}

function requestAuto( options, cb )
{
    if ( _useProxy ) {
        return requestProxy( options, cb );
    } else {
        return requestDirect( options, cb );
    }
};

exports.request = requestAuto;
exports.requestDirect = requestDirect;
