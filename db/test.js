var MistDb = require( './mistDb.js' );

var mistDb = new MistDb.mistDb( 'test' );

mistDb.create()
    .then( function() {
        var t = new MistDb.Transaction();

        var users = t.newObject( MistDb.ROOT, 'users', null, null, { a: 'hej', b: ['a', 'b'], c: 17, d: 17.8, e: 1/3 } );
        t.newObject( users, 'alice', null, null, { name: 'Alice Secure Person' } );
        return mistDb.runTransaction( t );
    })
    .catch(function(err){console.log(err);console.log(err.stack)}).done(console.log('Done'));
