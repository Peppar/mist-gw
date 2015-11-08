"use strict";

var http2 = require('http2');
var console = require('console');
var fs = require('fs');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

function MistDirectory(host, port) {
  this.host = host;
  this.port = port;
}

MistDirectory.prototype.setPeers = function(key, cert, peers, callback) {
  var post_data = new Buffer(JSON.stringify(peers), 'utf8');
  var post_options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': post_data.length
    },
    path: '/peer',
    rejectUnauthorized: false,
    host: this.host,
    port: this.port,
    key: key,
    cert: cert
  };

  var request = http2.request(post_options, function(res) {
    var body = '';
    res.setEncoding('utf8');
    res.on('data', function(chunk) {
      body += chunk;
    });
    res.on('end', function() {
      if (callback) {
        callback(JSON.parse(body));
      }
    });
  });

  request.write(post_data);
  request.end();
};

MistDirectory.prototype.getPeers = function(fingerprint, callback) {
  var get_options = {
    method: 'GET',
    path: '/peer/' + fingerprint,
    rejectUnauthorized: false,
    host: this.host,
    port: this.port
  };

  var request = http2.request(get_options, function(res) {
    var body = '';
    res.setEncoding('utf8');
    res.on('data', function(chunk) {
      body += chunk;
    });
    res.on('end', function() {
      if (callback) {
        callback(JSON.parse(body));
      }
    });
  });
};

var util = require('util');
var key = fs.readFileSync('./userA.key');
var cert = fs.readFileSync('./userA.crt');
var peers = [{ type: 'tor', address: 'korv', port: 1234 }];
var fingerprint = "F6:84:3C:B4:E3:FE:A2:01:1A:6D:8D:00:4E:80:B8:EA:7E:ED:CF:65"

var mistDir = new MistDirectory('helkokbok.se', 8080);

mistDir.setPeers(key, cert, peers, function(res) {
  console.log("Setting peers: " + util.inspect(res));
  mistDir.getPeers(fingerprint, function(res) {
    console.log("Getting peers: " + util.inspect(res));
  });
});

