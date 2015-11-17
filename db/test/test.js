var assert = require('assert');
var MistDb = require( '../mistDb.js' );
var db = new MistDb.DB( ':memory:' );// 'test.sqlite' );
var res = {};
var objA, objB;

describe( 'MistDb', function() {
    describe( '#runTransaction()', function() {
        it( 'should create two objects', function(done) {
            var transaction = new MistDb.Transaction();

            objA = transaction.newObject( MistDb.ROOT, 'A', null, null, { a: 17, b: 'string', c: { a: 17, b: 18 } } );
            objB = transaction.newObject( objA, 'B', null, null, { a: 17, b: 'string', c: { a: 17, b: 18 } } );
//            var objC = transaction.newObject( { id: 'xxxx' }, 'B', null, null, { a: 17, b: 'string', c: { a: 17, b: 18 } } );

            return db.create().then( function() { return db.runTransaction( transaction ) } )
                .then( done )
                .catch( function(err) { done( err ) } );
        }),
        it( 'should not be possible to create a loop', function(done) {
            var transaction = new MistDb.Transaction();

            transaction.modifyObject( objA, objB, 'A', null, null, { a: 17, b: 'string', c: { a: 17, b: 18 } } );
            return db.create().then( function() { return db.runTransaction( transaction ) } )
                .then( function() { done( new Error( "Accepted transaction with a loop." ) ) } )
                .catch( function(err) { if (err.errno == MistDb.ErrNo.INVALID_PARENT) done(); else done( err ); } );
        }),
        it( 'should not be possible to add an object with an invalid parent', function(done) {
            var transaction = new MistDb.Transaction();

            transaction.newObject( { id: 'xxxx' }, 'B', null, null, { a: 17, b: 'string', c: { a: 17, b: 18 } } );
            return db.create().then( function() { return db.runTransaction( transaction ) } )
                .then( function() { done( new Error( "Accepted transaction with a loop." ) ) } )
                .catch( function(err) { if (err.errno == MistDb.ErrNo.INVALID_PARENT) done(); else done( err ); } );
        })
    })
})
