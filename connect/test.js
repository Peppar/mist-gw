"use strict";

var Q = require( 'q' );
var util = require('util');
var fs = require('fs');
var connect = require('./index.js');
var http2tor = require('./http2tor.js');
var x509 = require('x509');

Q.longStackSupport = true;

var connectOptions = {
    key: fs.readFileSync('../userA.key'),
    cert: fs.readFileSync('../userA.crt'),
    torCmd: '../tor/tor',
    torData: '../tor-data',
    torErrorFn: console.error,
    torMessageFn: console.log,
    torCtrlMessageFn: function(controlMessage) { console.log( 'Ctrl: ' + controlMessage ) }
};

var getClassName = function(o) { 
    if (!o) {
        return "falsy";
    }
    var funcNameRegex = /function (.{1,})\(/;
    var results = (funcNameRegex).exec(o.constructor.toString());
    return (results && results.length > 1) ? results[1] : "";
}

function chatServiceCallback( user, request, response ) {
    var parts = request.url.split('/');
    if (request.method === "GET") {
        
    } else if (request.method === "POST") {
        request.on( 'data', function( chunk ) {
            response.end("Hello chat chat chat..." + chunk)
        });
    }
}

var c;
connect.createConnect( connectOptions )
    .then( function( _c ) { c = _c; } )
    .then( function() { console.log( 'Connectlib server up and running at ' + c.onionAddress ) } )
    .then( function() { console.log( 'Connectlib server fingerprint is ' + c.fingerprint ) } )
    .then( function() { c.addDirectory( 'helkokbok.se', 8080 ) } )
    .then( function() { c.addUser( 'peppar', connectOptions.cert ) } )
    .then( function() { c.addService( 'chat', chatServiceCallback ) } )
    .then( function() { return c.publishPeers() } )
    .then( function() { console.log( 'Published onion address to 4smogsofurtibfuq.onion' ) } )
    .then( function() { return c.userServiceRequest( 'peppar', 'chat', 'send', 'KORV' ) } )
    .then( function( data ) {
        console.log( 'Got data back: ' + data ); 
    })
    .done();
