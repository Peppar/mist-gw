"use strict";

var http2 = require('http2');
var console = require('console');
var fs = require('fs');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

var request = http2.request({
  method: 'get',
  host: 'helkokbok.se',
  port: 8080,
  url: '/',
  rejectUnauthorized: false,
  key: fs.readFileSync('./userA.key'),
  cert: fs.readFileSync('./userA.crt')
});

request.on('response', function(response) {
  console.log('Got response!');
  response.pipe(process.stdout);
});

request.on('abort', function(response) {
  console.log('Got abort!');
});

