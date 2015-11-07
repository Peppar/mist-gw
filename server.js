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

var options = {
  key: fs.readFileSync('/etc/letsencrypt/live/helkokbok.se/privkey.pem'),
  cert: fs.readFileSync('/etc/letsencrypt/live/helkokbok.se/cert.pem'),
  requestCert: true,
  rejectUnauthorized: false
};

var server = http2.createServer(options);

server.on('request', function(request, response) {
  var cert = request.socket.getPeerCertificate();
  var fingerprint = null;
  if (cert) {
    fingerprint = cert.fingerprint;
  }
  if (fingerprint) {
    response.end('Hello, your fingerprint is: ' + fingerprint);
  } else {
    response.end('Hello, you have no fingerprint!');
  }
});

server.listen(8080);

