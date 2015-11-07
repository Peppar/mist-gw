"use strict";

var http2 = require('http2');
var console = require('console');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

var request = http2.request({
  method: 'get',
  host: 'helkokbok.se',
  port: 8002,
  url: '/',
  rejectUnauthorized: false
});

request.on('response', function(response) {
  console.log('Got response!');
  response.pipe(process.stdout);
});

request.on('abort', function(response) {
  console.log('Got abort!');
});

console.log('Lalala!');

//('https://helkokbok.se:8002/', function(response) {
//  response.pipe(process.stdout);
//});



