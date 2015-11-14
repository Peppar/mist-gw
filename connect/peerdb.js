"use strict";

var http2tor = require('./http2tor');

function MistDirectory(host, port) {
    this.host = host;
    this.port = port;
}

MistDirectory.prototype =
{
    setPeers: function(peers, callback)
    {
        var post_data = new Buffer(JSON.stringify(peers), 'utf8');
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
    
        var request = http2tor.request( post_options, function(res) {
            var body = '';
            res.setEncoding('utf8');
            res.on('data', function(chunk) {
                body += chunk;
            });
            res.on('end', function() {
                if (callback) {
                    callback( JSON.parse(body) );
                }
            });
        });
    
        request.write(post_data);
        request.end();
    },

    getPeers: function(fingerprint, callback)
    {
        var get_options = {
            method: 'GET',
            path: '/peer/' + fingerprint,
            host: this.host,
            port: this.port
        };
    
        var request = http2tor.request( get_options, function(res) {
            var body = '';
            res.setEncoding('utf8');
            res.on('data', function(chunk) {
                body += chunk;
            });
            res.on('end', function() {
                if (callback) {
                    callback( JSON.parse(body) );
                }
            });
        });
    }
};

exports.MistDirectory = MistDirectory;
