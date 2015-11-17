"use strict";

var Q = require( 'q' );
var util = require('util');
var fs = require('fs');
var connect = require('./index.js');
var http2tor = require('./http2tor.js');
var x509 = require('x509');

var connectOptions = {
    key: fs.readFileSync('../userA.key'),
    cert: fs.readFileSync('../userA.crt'),
    torCmd: '../tor/tor',
    torData: '../tor-data',
    torErrorFn: console.error,
    torMessageFn: console.log,
    torCtrlMessageFn: function(controlMessage) { console.log( 'Ctrl: ' + controlMessage ) }
};

function startChatService( username ) {
    // TODO
}

var c;
connect.createConnect( connectOptions )
    .then( function( _c ) { c = _c; } )
    .then( function() { console.log( 'Connectlib server up and running at ' + c.onionAddress ) } )
    .then( function() { console.log( 'Connectlib server fingerprint is ' + c.fingerprint ) } )
    .then( function() { c.addDirectory( '4smogsofurtibfuq.onion', 443 ) } )
    .then( function() { c.addUser( 'peppar', connectOptions.cert ) } )
    .then( function() { c.addService( 'chat', startChatService ) } )
    .then( function() { return c.publishPeers() } )
    .then( function() { console.log( 'Published onion address to 4smogsofurtibfuq.onion' ) } )
    .then( function() { return c.userRequest( 'peppar', { path: '/services'} ) } )
    .then( function( body ) { console.log( 'Got response!' + body.toString() ); } )
    .then( function() { return c.userRequest( 'peppar', { path: '/hoj'} ) } )
    .then( function( body ) { console.log( 'Got response!' + body.toString() ); } )
    .done();
