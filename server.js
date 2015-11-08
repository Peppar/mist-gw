"use strict";

var getClassName = function(o) { 
  if (o == null) {
    return "NULL";
  }
  var funcNameRegex = /function (.{1,})\(/;
  var results = (funcNameRegex).exec(o.constructor.toString());
  return (results && results.length > 1) ? results[1] : "";
};

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

var fs = require('fs');
var util = require("util");
var http2 = require("http2");
var sqlite3 = require("sqlite3").verbose();

function PeerDb(file) {
  this.db = new sqlite3.Database(file);
  this.db.run("CREATE TABLE IF NOT EXISTS `peer` " +
    "(`fingerprint` TEXT," +
     "`type` TEXT," +
     "`address` TEXT," +
     "`port` INT)");
}

PeerDb.prototype.setPeers = function(fingerprint, peers) {
  this.db.run("DELETE FROM `peer` WHERE `fingerprint`=?", fingerprint);
  for (var i in peers) {
    this.db.run("INSERT INTO `peer` " +
      "(`fingerprint`, `type`, `address`, `port`) " +
      "VALUES (?, ?, ?, ?)", fingerprint, peers[i].type,
        peers[i].address, peers[i].port);
  }
}

PeerDb.prototype.getPeers = function(fingerprint, callback) {
  this.db.all("SELECT * FROM `peer` WHERE `fingerprint`=?", fingerprint,
    function(err, rows) {
      var peers = rows.map(function(row) {
        return { type:    row.type,
                 address: row.address,
                 port:    row.port };
      });
      callback(peers);
  });
}

var peerDb = new PeerDb('./db/peer.sqlite');

var options = {
  key: fs.readFileSync('./keys/privkey1.pem'),
  cert: fs.readFileSync('./keys/cert1.pem'),
  requestCert: true,
  rejectUnauthorized: false
};

var server = http2.createServer(options);

server.on('request', function(request, response) {
  if (request.method === "GET") {
    var parts = request.url.split('/');
    if (parts.length === 3 &&
        parts[0] === "" &&
        parts[1] === "peer") {
      var fingerprint = parts[2];
      peerDb.getPeers(fingerprint, function(peers) {
        response.writeHead(200, {"Content-Type": "application/json"});
        response.end(JSON.stringify(peers));
      });
    } else {
      response.writeHead(404, 'Resource Not Found');
      response.end('Resource Not Found');
    }
  } else if (request.method === "POST") {
    var parts = request.url.split('/');
    if (parts.length === 2 &&
        parts[0] === "" &&
        parts[1] === "peer") {
      var cert = request.socket.getPeerCertificate();
      var fingerprint = null;
      if (cert) {
        fingerprint = cert.fingerprint;
      }
      if (fingerprint) {
        request.on('data', function(data) {
          peerDb.setPeers(fingerprint, JSON.parse(data));
          response.writeHead(200, {"Content-Type": "application/json"});
          response.end(JSON.stringify(true));
          console.log('TEST: Setting peer with fingerprint ' + fingerprint +
                      'to ' + data);
        });
        request.on('end', function() {
        });
      } else {
        response.writeHead(400, 'Bad Request');
        response.end('No valid certificate provided');
      }
    } else {
      response.writeHead(404, 'Resource Not Found');
      response.end('Resource Not Found');
    }
  } else {
    response.writeHead(405, 'Method Not Supported');
    response.end('Method Not Supported');
  }
});

server.listen(8080);

