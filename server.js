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
//var sqlite3 = require("sqlite3");

var options = {
  key: fs.readFileSync('/etc/letsencrypt/live/helkokbok.se/privkey.pem'),
  cert: fs.readFileSync('/etc/letsencrypt/live/helkokbok.se/cert.pem'),
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
      response.end('TEST: Getting peer with fingerprint ' + fingerprint);
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
        console.log('going well...');
        request.on('data', function(data) {
          response.end('TEST: Setting peer with fingerprint ' + fingerprint +
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

