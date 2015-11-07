"use strict";

var fs = require('fs');
var util = require("util");
var http2 = require("http2");
var console = require('console');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

var options = {
  key: fs.readFileSync('/etc/letsencrypt/live/helkokbok.se/privkey.pem'),
  cert: fs.readFileSync('/etc/letsencrypt/live/helkokbok.se/cert.pem'),
  requestCert: true,
  rejectUnauthorized: false,
  agent: false
};

var server = http2.createServer(options);

server.on('connection', function(socket) {
  console.log('Got connection!' + util.inspect(socket));
});

server.on('clientError', function(exception, socket) {
  console.log('Got client error!' + util.inspect(exception));
});

server.on('error', function(exception) {
  console.log('Got error!' + util.inspect(exception));
});

server.on('request', function(request, response) {
  console.log('Got request!' + util.inspect(request.socket));
  response.end(util.inspect(request.socket));
  //if (request.socket.authorized) {
  //  response.end('Hello client with certificate!',
  //    + util.inspect(request.socket.getPeerCertificate()));
  //} else {
  //  response.end('Hello client without certificate!');
  //}
});

server.listen(8002);

