"use strict";

var Q = require( 'q' );
var http2tor = require('./http2tor');

function MistDirectory(host, port) {
    this.host = host;
    this.port = port;
}

MistDirectory.prototype =
{
    setPeers: function( peers )
    {
        var post_data = new Buffer( JSON.stringify(peers), 'utf8' );
        var post_options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': post_data.length
            },
            path: '/peer',
            host: this.host,
            port: this.port,
            keepAlive: false
        };
        
        return http2tor.request( post_options, post_data );
    },

    getPeers: function( fingerprint )
    {
        var get_options = {
            method: 'GET',
            path: '/peer/' + fingerprint,
            host: this.host,
            port: this.port
        };
        
        return http2tor.request( get_options )
            .then( function( body ) { return Q( JSON.parse( body ) ); } );
    }
};

exports.MistDirectory = MistDirectory;
