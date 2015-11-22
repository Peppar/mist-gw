var assert = require('assert');
var MistDb = require( '../mistDb.js' );
var db = new MistDb.DB(
    ':memory:' );
//     'test.sqlite' );
var res = {};
var objA, objB;
var Q = require( 'q' );

var transactionHash;

describe( 'MistDb', function() {
    describe( '#runTransaction()', function() {
        it( 'create two objects', function(done) {
            var transaction = new MistDb.Transaction();

            objA = transaction.newObject( MistDb.ROOT, 'A', null, null, { a: 17, b: 'string', c: { a: 17, b: 18 } } );
            objB = transaction.newObject( objA, 'B', null, null, { a: 17, b: 'string', c: { a: 17, b: 18 } } );
//            var objC = transaction.newObject( { id: 'xxxx' }, 'B', null, null, { a: 17, b: 'string', c: { a: 17, b: 18 } } );

            return db.create().then( function() { return db.runTransaction( transaction ) } )
                .then( done )
                .catch( function(err) { done( err ) } );
        }),
        it( 'loop error handling', function(done) {
            var transaction = new MistDb.Transaction();

            transaction.modifyObject( objA, objB, 'A', null, null, { a: 17, b: 'string', c: { a: 17, b: 18 } } );
            return db.runTransaction( transaction )
                .then( function() { done( new Error( "Accepted transaction with a loop." ) ) } )
                .catch( function(err) { if (err.errno == MistDb.ErrNo.INVALID_PARENT) done(); else done( err ); } );
        }),
        it( 'invalid parent error handling', function(done) {
            var transaction = new MistDb.Transaction();

            transaction.newObject( { id: 'xxxx' }, 'B', null, null, { a: 17, b: 'string', c: { a: 17, b: 18 } } );
            return db.runTransaction( transaction )
                .then( function() { done( new Error( "Accepted transaction with a loop." ) ) } )
                .catch( function(err) { if (err.errno == MistDb.ErrNo.INVALID_PARENT) done(); else done( err ); } );
        }),
        it( 'locking', function(done) {
            var locks = [];

            db.getLock().then( function() { return Q.delay(10); } ).then( function() { locks.push( 1 ); db.releaseLock(); } );

            db.getLock().then( function() { return Q.delay(10); } ).then( function() { locks.push( 2 ); db.releaseLock(); } );

            return db.getLock().then( function() { return Q.delay(10); } ).then( function() { locks.push( 3 ); db.releaseLock(); } )
                .then( function() {
                    if (locks.length == 3 && locks[0] == 1 && locks[1] == 2 && locks[2] == 3)
                        done();
                    else
                        done( new Error( "Locking fault" ) )
                } )
                .catch( done );
        }),
        it( 'list transactions', function(done) {
            db.listTransactions().then( function (transactions) {
                var keys = Object.keys( transactions );

                assert (keys.length == 1);
                assert (keys[0] == 2);
//                assert (transactions[2].hash == transactionHash );
                done();
            })
            .catch( done );
        }),
        it( 'get transactions', function(done) {
            db.getTransaction( 2 ).then( function (transaction) {
                assert (transaction.computeHash().digest( 'hex' ) == transaction.hash);
                done();
            })
            .catch( done );
        })
    })
})
