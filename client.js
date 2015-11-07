"use strict";

var http2 = require('http2');
var console = require('console');
var fs = require('fs');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

var post_data = "my_fingerprint";

console.log("Hoj");
var request = http2.request({
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(post_data)
  },
  host: 'helkokbok.se',
  port: 8080,
  path: '/peer',
  rejectUnauthorized: false,
  key: fs.readFileSync('./userA.key'),
  cert: fs.readFileSync('./userA.crt')
}, function(res) {
  console.log('Hej');
  res.setEncoding('utf8');
  res.on('data', function(chunk) {
    console.log('Response: ' + chunk);
  });
});

request.on('response', function(response) {
  console.log('Got response!');
  response.pipe(process.stdout);
});

request.on('abort', function(response) {
  console.log('Got abort!');
});

request.write(post_data);
request.end();


