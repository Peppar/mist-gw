var assert = require('assert');
var MistDb = require( '../mistDb.js' );
var db = new MistDb.mistDb( ':memory:' );// 'test.sqlite' );
var res = {}

describe( 'MistDb', function() {
    describe( '#runTransaction()', function() {
        it( 'should create two objects', function(done) {
            var transaction = new MistDb.Transaction();

            var objA = transaction.newObject( MistDb.ROOT, 'A', null, null, { a: 17, b: 'string', c: { a: 17, b: 18 } } );
            var objB = transaction.newObject( objA, 'B', null, null, { a: 17, b: 'string', c: { a: 17, b: 18 } } );
//            var objC = transaction.newObject( { id: 'xxxx' }, 'B', null, null, { a: 17, b: 'string', c: { a: 17, b: 18 } } );

            return db.create().then( function() { return db.runTransaction( transaction ) } )
                .then( done )
//                .then( function() { console.log( "done?" ); done() } )
                .catch( function(err) { done( err ) } );
        })
    })
})
