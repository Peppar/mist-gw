"use strict";

var Q = require( 'q' );
var Qdb = require( './q-sqlite3.js')
var sqlite3 = require( 'sqlite3' );
var fs = require( 'fs' );
var zip = require( 'node-zip' );
var FS = require( 'q-io/fs' );
var SHA3 = require( 'sha3' );
var crypto = require( 'crypto' );
var assert = require( 'assert' );
var archiver = require('archiver');

var ROOT_OBJECT = "root";

var Status = { CURRENT: 1, DELETED: 2, OLD: 3, OLD_DELETED: 4 };
var ErrNo = { 
    FILE_EXISTS: 1,
    INVALID_PARENT: 2,
    DUPLICATE: 3,
    NOT_FOUND: 4,
    NOT_EMPTY: 5,
};


function error( errno, message )
{
    var err = new Error( message );
    err.errno = errno;
    return err;
}


/**
 * Stringify method that sorts object keys. Needed to normalize transaction records.
 * The hash value for a transaction should always match, even if it is redone at a
 * later date.
 */
function stringify(obj)
{
    if (typeof obj == 'object' && obj != null && obj != undefined)
    {
        if (Array.isArray(obj))
        {
            return "["
                + obj.map( function (cur) { return stringify( cur ); } )
                    .reduce( function( prev, cur ) { return prev + "," + cur } )
                + "]"
        }
        else
        {
            var keys = Object.keys( obj );

            keys.sort();
            if (keys.length == 0)
                return "{}";
            return "{" +
                keys.map( function (cur) {
                    return JSON.stringify( cur )
                        + ":"
                        + stringify( obj[ cur ] ) } )
                    .reduce( function( prev, cur ) { return prev + "," + cur } )
                + "}";
        }
    }
    else
    {
        return JSON.stringify( obj );
    }
}

function dateToString( date )
{
    return date.toISOString().split( '.' )[0];
}

function stringToDate( str )
{
    return new Date( str.replace( ' ', 'T' ) );
}

function numberToUInt32Buf( num )
{
    var buf = new Buffer(4);

    buf.writeUIntLE( num, 0, 4 );
    return buf;
}

/*
 * Object used in lists of transactions
 */
function TransactionInfo( hash, user, signature, parents )
{
    this.hash = hash;
    this.user = user;
    this.signature = signature;
    this.parents = parents;
}

/*
 * Full transaction object. Is used for reading and receiving transactions, as well
 * as building new transactions. In the later case the constructor is called with
 * only nulls as arguments.
 */
function Transaction( hash, timestamp, user, signature, parents, objects, content, deletedObjects )
{
    this.hash = hash;
    this.timestamp = timestamp;
    this.user = user;
    this.signature = signature;
    this.parents = parents || {};
    this.objects = objects || {};
    this.content = content || {};
    this.deletedObjects = deletedObjects || {};
}

Transaction.prototype =
{
    newObject: function( parent, pathElem, content, contentType, attributes )
    {
        var id = crypto.randomBytes( 16 ).toString( 'hex' );
        var obj;

        obj = {
            id: id,
            parent: parent == ROOT_OBJECT ? null : parent.id,
            pathElem: pathElem,
            content: content,
            contentType: contentType,
            attributes: attributes };
        assert( !this.objects[ id ] && !this.deletedObjects[ id ] && id != parent );
        this.objects[ id/*.toString( 'hex' )*/ ] = obj;
        return obj;
    },

    modifyObject: function( obj, parent, pathElem, content, contentType, attributes )
    {
        if (this.objects[ obj.id ] || this.deletedObjects[ obj.id ])
            throw error( ErrNo.DUPLICATE, "Object " + obj.id + " already exists in the transaction" );
        if (obj.id == parent)
            throw error( ErrNo.INVALID_PARENT, "Object " + obj.id + " has itself as parent" );
        this.objects[ obj.id.toString( 'hex' ) ]
            = { parent: parent ? (parent == ROOT_OBJECT ? NULL : parent.id.toString( 'hex' )) : obj.parentId,
                pathElem: pathElem ? pathElem : obj.pathElem,
                content: content ? content : obj.content,
                contentType: contentType ? contentType : obj.contentType,
                attributes: attributes ? attributes : obj.attributes }
    },

    deleteObject: function( obj )
    {
        if (this.objects[ obj.id ] || this.deletedObjects[ obj.id ])
            throw error( ErrNo.DUPLICATE, "Object " + obj.id + " already exists in the transaction" );
        this.deletedObjects[ obj.id ] = 1;
    },

    newContent: function( blob )
    {
        var d = new SHA3.SHA3Hash( 224 );
        var h

        d.update( blob );
        h = d.digest( 'hex' );
        this.content[ h ] = blob;
        return h;
    },

    computeHash: function()
    {
        var d = new SHA3.SHA3Hash( 224 );
        var dump = this.toJSON();
        var json = stringify( dump.transaction );

        d.update( json );
        return d;
    },

    setParents: function(parents)
    {
        this.parents = parents;
    },

    setTimestamp: function(timestamp)
    {
        this.timestamp = timestamp;
    },

    /**
     * Creates a JSON representation of the transaction, excluding
     * content data
     */
    toJSON: function()
    {
        var d = new SHA3.SHA3Hash( 224 );
        var keys
        var that = this;

        var res = {
            user: this.user || null,
            timestamp: dateToString( this.timestamp ),
            parents: this.parents,
            objects: {},
            deletedObjects: this.deletedObjects,
            content: this.content,
            version: 1,
        };

        for (var i in this.objects)
            res.objects[i] = {
                attributes: this.objects[i].attributes,
                content: this.objects[i].content,
                contentType: this.objects[i].contentType,
                parent: this.objects[i].parent,
                pathElem: this.objects[i].pathElem,
            };

        return { id: this.hash, transaction: res, signature: this.signature }
    },
}

function DB( fileName )
{
    this.fileName = fileName;
    this.db = null;
    this.lock = null;
}

DB.prototype =
{
    open: function()
    {
        var that = this;

        return Qdb.createDatabase( that.fileName, Qdb.OPEN_READWRITE )
            .then( function (db) { that.db = db } );
    },

    create: function()
    {
        var that = this;

        return FS.exists( that.fileName )
            .then( function (exists) { if (exists) throw error( ErrNo.FILE_EXISTS, "mistDb.create '" + that.fileName + "' already exists" ) } )
            .then( function() { return Qdb.createDatabase( that.fileName, Qdb.OPEN_CREATE|Qdb.OPEN_READWRITE ) } )
            .then( function (db) { that.db = db } )
            .then( function() { return Q.all( [
                that.db.run( "CREATE TABLE Object (globalId, localId, version, status, parent, pathElem, content, contentType)" ),
                that.db.run( "CREATE TABLE Attribute (id, version, name, value, json)" ),
                that.db.run( "CREATE TABLE Content (id, hash, nr, content)" ),
                that.db.run( "CREATE TABLE ContentVersion (id, version)" ),
                that.db.run( "CREATE TABLE \"Transaction\" (version, timestamp, user, hash, signature)" ),
                that.db.run( "CREATE TABLE TransactionParent (version, parentVersion)" ),
                that.db.run( "CREATE TABLE Setting (name, value)" ),
                that.db.run( "CREATE TABLE Log (timestamp, log)" ),
            ] ) } );
        // Create table log, find out which versions we received when


        // Create /access/
        // Create /access/ user1 with correct permissions
        // Higher level
    },

    /**
     * Verify that a JSON transaction object has the correct hash value,
     * and is internally consistent
     */
    verifyTransaction: function( transaction )
    {
//        if (transaction.hash && tra)


        var inOrder = true;

        transaction

        transaction.objects.forEach( function (obj, index) {
            if (index == 0) return;
            if (obj.id <= transaction.objects.id)
                inOrder = false
        } )
        transaction.contents.forEach( function (obj, index) {
            if (index == 0) return;
            if (hash.id <= transaction.contents.hash)
                inOrder = false

        })
/*

Handle loops by swapping objects

A/B/C/D

C->D

swap C, D?







*/

    },

    getLock: function()
    {
        if (this.lock == null)
        {
            this.lock = [];
            return Q.fcall( function() {} );
        }
        else
        {
            var deferred = Q.defer();

            this.lock.push( function () { deferred.resolve() } )
            return deferred.promise;
        }
    },

    releaseLock: function()
    {
        if (this.lock.length == 0)
            this.lock = null;
        else
            this.lock.shift().call( this );
    },

    /*
     * Run a new transaction generated by the local user
     *
     * The user and signFunction arguments are optional
     */
    runTransaction: function( transaction, user, signFunction )
    {
        var version, parentTransactions, nextLocalObjectId, nextBlobId;
        var hasErr = false;
        var deferred = Q.defer();
        var that = this;
        var objectLookupGlobalId = {};
        var objectLookupLocalId = {};
//        var parentLookup = {}
//        var missingParent = {}

        transaction.setTimestamp( new Date() );
        this.getLock()
            .then( function() { return that.db.run( "BEGIN TRANSACTION" ) } )
            .then( function() {
                // Find all versions that do not have a child transaction yet
                // We handle merge the transaction graph by setting all these
                // transaction as parents to the next transaction
                return that.db.all( 'SELECT t.version AS version, t.hash AS hash FROM "Transaction" AS t LEFT OUTER JOIN TransactionParent AS tp ON t.version=tp.version WHERE tp.version IS NULL' )
            })
            .then( function(rows) {
                parentTransactions = rows;

                var parents = {};
                rows.forEach( function(row) { parents[ row.hash ] = row.version } );
                // Need to set parents so the transaction obect can generate the correct hash
                transaction.setParents( parents );
            })
            .then( function() {
                // Find the local number of our transaction
                return that.db.all( 'SELECT IFNULL(MAX(version),0) AS max From "Transaction"' )
            })
            .then( function(rows) {
                // Just use even numbers for "real" transactions. Use odd numbers for conflict
                version = Math.floor( (rows[0].max + 2) / 2 ) * 2;
                // Either we are the first transaction, or there must be parent transactions
                assert( version == 2 || parentTransactions.length > 0 );
            })
            .then( function() {
                // Find the local number for the next object, in case we need to create some
                return that.db.all( 'SELECT IFNULL(MAX(localId),0) AS max FROM Object' )
            })
            .then( function(rows) {
                nextLocalObjectId = rows[0].max + 1
            })
            .then( function() {
                // Find the local number for the next content blob, in case we need to create some
                return that.db.all( 'SELECT IFNULL(MAX(id),0) AS max FROM Content' )
            })
            .then( function(rows) {
                nextBlobId = rows[0].max + 1
            })
            .then( function() {
                // Create the new transaction and create links to its parent transaction(s)
                var res =
                    [ that.db.run( 'INSERT INTO "Transaction" (version, timestamp) VALUES (?, DATETIME(\'now\'))',
                        [version] ) ]
                    .concat( parentTransactions.map( function(row) {
                        return that.db.run( 'INSERT INTO TransactionParent (version, parentVersion) VALUES (?, ?)',
                            [version, row.version] )} ) );
                return Q.all( res );
            })
            .then( function() {
                if (transaction.objects)
                    return ;

                // Fetch all objects from the transaction, as well as their parents. We need this to
                // convert between local ids and global ids, and to see if we have to perform loop checks
                // for parents that have changed.
                var query = 'SELECT globalId, localId, parent, status '
                    + 'FROM Object AS o '
                    + 'WHERE o.status <= ' + Status.DELETED + ' AND o.globalId IN ( '
                    + Object.keys( transaction.objects )
                        .map( function(key) { 
                            var obj = transaction.objects[key];

                            if (obj.parent)
                                return "'" + obj.id + "','" + obj.parent + "'";
                            else
                                return "'" + obj.id + "'";
                        } )
                        .concat( function () {
                            Object.keys( transaction.deletedObjects )
                                .map( function (key) { return "'" + key + "'" } );
                        })
                        .reduce( function(prev, cur) { return prev + "," + cur } )
                    + ")";

                return that.db.run( query )
            } )
            .then( function (rows) {
                var recursiveLookupParent = {};

                if (rows) {
                    rows.forEach( function(row) {
                        objectLookupLocalId[ row.localId ] = row;
                        objectLookupGlobalId[ row.globalId ] = row;
                    })
                }
                // Check so we do not have any loops and that all parent ids exist
                for (let i in transaction.objects)
                {
                    let obj = transaction.objects[i];
                    let ol = objectLookupGlobalId[ obj.id ];
                    let olParent = ol && ol.parent && objectLookupLocalId[ ol.parent ];

                    // This is a new object
                    if (!ol)
                    {
                        // The new object is a top level object, or it has a parent object that
                        // we know about
                        if (!obj.parent || transaction.objects[ obj.parent ])
                            continue;
                        // We do not have a parent object
                        throw error( ErrNo.INVALID_PARENT, "A new object has an invalid parent " + obj.parent );
                    }
                    else
                    {
                        // The object is a top level object, has the same parent as the last version
                        // of the object, or has a parent object that is a top level object
                        if (!obj.parent || olParent && obj.parent == olParent.globalId || ol.parent == null)
                            continue;

                        let o = ol

                        while (objectLookupLocalId[ o.parent ])
                            o = objectLookupLocalId[ o.parent ];
                        // We found a top level object whice recursing
                        if (o.parent == null)
                            continue;
                        // We need to fetch more objects from the database to be able to recurse
                        // to a top level object
                        obj.needRecursiveParentLookup;
                        recursiveLookupParent[ o.parent ] = 1;
                    }
                }
                // Do we need to lookup any more parents
                if (Object.keys( recursiveLookupParent ).length == 0)
                    return
                function buildQuery( keys )
                {
                    return 'SELECT globalId, localId, parent, status '
                        + 'FROM Object AS o '
                        + 'WHERE o.status <= ' + Status.DELETED + ' AND o.localId IN ( '
                        + keys.map( function(key) { return "'" + key + "'"; } )
                            .reduce( function(prev, cur) { return prev + "," + cur } )
                        + ")";
                }
                function doRecursiveLookup(rows)
                {
                    rows.forEach( function(row) {
                        objectLookupLocalId[ row.localId ] = row;
                        objectLookupGlobalId[ row.globalId ] = row;
                    });
                    recursiveLookupParent = {}
                    rows.forEach( function(row) {
                        var o = row;

                        while (o.parent != null && objectLookupLocalId[ o.parent ])
                            o = objectLookupLocalId[ o.parent ];
                        if (o.parent == null)
                            return;
                        recursiveLookupParent[ o.parent ] = 1;
                    } )
                    // Do not need to lookup any more parents
                    if (Object.keys( recursiveLookupParent ).length == 0)
                        return;
                    return that.db.all( buildQuery( Object.keys( recursiveLookupParent ) ) ).then( doRecursiveLookup )
                }
                return that.db.all( buildQuery( Object.keys( recursiveLookupParent ) ) ).then( doRecursiveLookup )
            }).then( function() {
                // Method is a bit complex since it needs to work with both local and global ids
                function findLoop( id, pathObjs )
                {
                    if (!id)
                        return false;
                    if (!pathObjs)
                        pathObjs = {};
                    if (pathObjs[ id ])
                        return true;
                    pathObjs[ id ] = 1;
                    if (transaction.objects[ id ])
                        return findLoop( transaction.objects[ id ].parent, pathObjs );
                    else if (objectLookupGlobalId[ id ] && objectLookupLocalId[ objectLookupGlobalId[ id ].parent ])
                        return findLoop( objectLookupLocalId[ objectLookupGlobalId[ id ].parent ].globalId, pathObjs );
                    // Should be impossible to reach here
                    assert( false );
                }

                for (let i in transaction.objects)
                {
                    let obj = transaction.objects;

                    if (!obj.needRecursiveParentLookup)
                        continue;

                    if (findLoop( obj.id ))
                        throw error( ErrNo.INVALID_PARENT, "Found a loop in transaction for object " + obj.id );
                }
            }).then( function() {
                var deletedChildLookup = {};

                if (Object.keys( transaction.deletedObjects ).length == 0)
                    return;
                // Check so we are deleting objects that exist, and that does not have any children that
                // are not also deleted
                for (let i in obj.deletedObjects)
                {
                    if (!objectLookupGlobalId[ i ] || objectLookupGlobalId[ i ].status == Status.DELETED)
                        throw errno( ErrNo.NOT_FOUND, "Trying to delete object " + obj.id + " that does not exist, or is already deleted" );
                    if (objectLookupGlobalId[ i ].parent)
                    {
                        // Store the number of children that are deleted in this transaction
                        if (!deletedChildLookup[ objectLookupGlobalId[ i ].parent ])
                            deletedChildLookup[ objectLookupGlobalId[ i ].parent ] = 0;
                        deletedChildLookup[ objectLookupGlobalId[ i ].parent ]++;
                    }
                }
                // Find out how many children each deleted object has in the database
                return that.db.all( "SELECT parent, count(*) AS count FROM Object WHERE status=" + Status.CURRENT + " AND parent IN ("
                    + Object.keys( obj.deletedObjects )
                        .map( function(key) { return "'" + objectLookupGlobalId[ key ].localId + "'" })
                        .reduce( function (prev, cur) { return prev + "," + cur })
                    + ") GROUP BY parent" )
                    .then( function(rows) {
                        rows.forEach( function(row) {
                            // Check whether all remaining children are deleted by in this transaction
                            if (deletedChildLookup[ row.parent ])
                            {
                                if (row.count <= deletedChildLookup[ row.parent ])
                                    return;
                            }
                            else if (row.count == 0)
                                return;
                            throw error( ErrNo.NOT_EMPTY, "Trying to delete object " + row.parent + " that has child objects" );
                        })
                    })
             }).then( function() {
                var res = [];
                for (let i in transaction.objects)
                {
                    let obj = transaction.objects[i];

                    if (objectLookupGlobalId[ obj.id ])
                    {
                        obj.localId = objectLookupGlobalId[ obj.id ].localId;
                        res.push( that.db.run( 'UPDATE Object SET status=status+2 WHERE localId=? AND status <= 2',
                            [ obj.localId ] ) );
                    }
                    else
                        obj.localId = nextLocalObjectId++;
                    objectLookupLocalId[ obj.localId ] = obj;
                    objectLookupGlobalId[ obj.id ] = obj;
                    obj.globalId = obj.id;
                }
                for (let i in transaction.objects)
                {
                    let obj = transaction.objects[i];

                    res.push( that.db.run( 'INSERT INTO Object (globalId, localId, version, status, parent, pathElem, content, contentType) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                        [ obj.id, obj.localId, version, Status.CURRENT, obj.parent ? objectLookupGlobalId[ obj.parent ].localId : null, obj.pathElem, obj.content, obj.contentType ] ) );
                    for (let j in obj.attributes)
                    {
                        var a = obj.attributes[j];
                        var json = false;

                        if (typeof a == 'object')
                        {
                            a = stringify( a );
                            json = true;
                        }
                        res.push( that.db.run( 'INSERT INTO Attribute (id, version, name, value, json) VALUES (?, ?, ?, ?, ?)',
                            [obj.localId, version, j, a, json ] ) );
                    }
                }
                for (let i in transaction.deletedObjects)
                {
                    let ol = objectLookupGlobalId[ i ]

                    res.push( that.db.run( 'UPDATE Object SET status=status+2 WHERE localId=? AND status <= 2',
                        [ ol.localId ] ) );
                    res.push( that.db.run( "INSERT INTO Object (globalId, localId, version, status, parent ) VALUES (?, ?, ?, ?, ?)",
                        [ i, ol.localId, version, Status.DELETED, ol.parent ] ) )
                }
                return Q.all( res );
            } )
            .then( function() {
                var d = transaction.computeHash();
                var p = parentTransactions.map( function(pt) { return pt.hash } );

                p.sort();
                p.forEach( function(hash) { d.update( hash ) } );
                return that.db.run( 'UPDATE "Transaction" SET hash=? WHERE version=?',
                    [ d.digest( 'hex' ), version ] );
            } )
            .then( function() {
                return that.db.run( 'COMMIT' );
            } )
            .catch( function(err) { that.db.db.run( 'ROLLBACK' ); deferred.reject( err ) } )
            .done( function() { 
                that.releaseLock();
                if (!hasErr)
                    deferred.resolve();
                } );
        return deferred.promise;
    },

    listTransactions: function()
    {
        var hasErr = false;
        var deferred = Q.defer();
        var that = this;

        this.getLock()
            .then( function() { return that.db.all(
                    "SELECT t.version AS version, t.timestamp AS timestamp, t.user AS user, t.hash AS hash, t.signature AS signature, "
                    +   "parentVersion, p.hash AS parentHash "
                    +   "FROM \"Transaction\" AS t "
                    +   "LEFT OUTER JOIN \"TransactionParent\" AS tp ON t.version=tp.version "
                    +   "LEFT OUTER JOIN \"Transaction\" AS p ON parentVersion=p.version "
                    +   "ORDER BY t.version" ) } )
            .then( function(rows) {
                var res = {};

                rows.forEach( function(row) {
                    if (!res[ row.version ])
                        res[ row.version ] = { version: row.version, timestamp: stringToDate( row.timestamp ), user: row.user, hash: row.hash, signature: row.signature, parents: {} };
                    if (row.parentVersion && row.parentHash)
                        res[ row.version ].parents[ row.parentVersion ] = row.parentHash;
                });
                return res;
            })
            .catch( function(err) { deferred.reject( err ) } )
            .done( function(res) { 
                that.releaseLock();
                if (!hasErr)
                    deferred.resolve(res);
                } );
        return deferred.promise;
    },

    getTransaction: function( transactionHashOrVersion )
    {
        var hasErr = false;
        var deferred = Q.defer();
        var that = this;
        var transaction;

        this.getLock()
            .then( function() {
                if (typeof transactionHashOrVersion == 'object')
                    transactionHashOrVersion = transactionHashOrVersion.version;
                if (typeof transactionHashOrVersion == 'number')
                    return that.db.all(
                        "SELECT t.version AS version, t.timestamp AS timestamp, t.user AS user, t.hash AS hash, t.signature AS signature, "
                        +   "p.hash AS parentHash "
                        +   "FROM \"Transaction\" AS t "
                        +   "LEFT OUTER JOIN \"TransactionParent\" AS tp ON t.version=tp.version "
                        +   "LEFT OUTER JOIN \"Transaction\" AS p ON parentVersion=p.version "
                        +   "WHERE t.version=?",
                        [transactionHashOrVersion] );
                return that.db.all(
                    "SELECT t.version AS version, t.timestamp AS timestamp, t.user AS user, t.hash AS hash, t.signature AS signature, "
                    +   "p.hash AS parentHash "
                    +   "FROM \"Transaction\" AS t "
                    +   "LEFT OUTER JOIN \"TransactionParent\" AS tp ON t.version=tp.version "
                    +   "LEFT OUTER JOIN \"Transaction\" AS p ON parentVersion=p.version "
                    +   "WHERE t.hash=?",
                    [transactionHashOrVersion] );
            })
            .then( function(rows) {
                var res = {};

                rows.forEach( function(row) {
                    if (!res[ row.version ])
                        res[ row.version ] = { version: row.version, timestamp: stringToDate( row.timestamp ), user: row.user, hash: row.hash, signature: row.signature, parents: {} };
                    if (row.parentHash)
                        res[ row.version ].parents[ row.parentHash ] = 1;
                });
                return res;
            })
            .then( function(transactions) {
                var keys = Object.keys( transactions );
                var objectRows;
                var parentRows;
                var attributeRows;
                var contentRows;

                if (keys.length != 1)
                    throw error( ErrNo.NOT_FOUND, "Transaction not found" );
                transaction = transactions[ keys[0] ];
                return that.db.all( "SELECT localId, globalId, parent, status, pathElem, o.content AS content, contentType, hash FROM Object AS o "
                        + "LEFT OUTER JOIN Content AS c ON o.content=id "
                        + "WHERE version=? ",
                        [ transaction.version ] )
                    .then( function (rows) {
                        objectRows = rows;
                        return that.db.all( "SELECT DISTINCT p.localId AS localId, p.globalId AS globalId FROM Object as o, Object as p "
                            + "WHERE o.version=? AND o.status IN (" + Status.CURRENT + "," + Status.OLD + ") AND o.parent=p.localId",
                            [ transaction.version ] );
                    }).then( function (rows) {
                        parentRows = rows;
                        return that.db.all( "SELECT id, name, value, json FROM Attribute "
                            + "WHERE version=? ",
                            [ transaction.version ] );
                    }).then( function (rows) {
                        attributeRows = rows;

                        var parents = {};
                        var objectByLocalId = {};
                        var objects = {};
                        var deletedObjects = {};

                        parentRows.forEach( function(row) {
                            parents[ row.localId ] = row.globalId;
                        });

                        objectRows.forEach( function(row) {
                            if (row.status == Status.DELETED || row.status == Status.OLD_DELETED)
                                deletedObjects[ row.globalId ] = 1;
                            var obj = {
                                id: row.globalId,
                                parent: parents[ row.parent ] ? parents[ row.parent ] : null,
                                pathElem: row.pathElem,
                                content: row.hash,
                                contentType: row.contentType,
                                attributes: {},
                            };
                            objectByLocalId[ row.localId ] = obj;
                            objects[ obj.id ] = obj;
                        });
                        attributeRows.forEach( function(row) {
                            var value = row.value;

                            if (row.json)
                                value = JSON.parse( value );
                            objectByLocalId[ row.id ].attributes[ row.name ] = value;
                        });
                        return new Transaction( transaction.hash, transaction.timestamp, transaction.user, transaction.signature,
                                                transaction.parents, objects, {}, deletedObjects );
                    })
            })
            .catch( function(err) { deferred.reject( err ) } )
            .done( function(transaction) { 
                that.releaseLock();
                if (!hasErr)
                    deferred.resolve(transaction);
                } );
        return deferred.promise;
    },

    writeTransaction: function( transaction, stream )
    {

    },

    backup: function( backupFile )
    {
        var output = fs.createWriteStream( backupFile );
        var archive = archiver('zip');
        var that = this;
        var deferred = Q.defer();
        var transactions;
        var transactionKeys;
        var transactionIndex = 0;

        function writeTransaction()
        {
            if (transactionIndex >= transactionKeys.length)
            {
                archive.finalize();
                deferred.resolve();
                return;
            }
            var trans = transactions[ transactionKeys[ transactionIndex ] ];

            that.getTransaction( trans )
                .then( function(transaction) {
                    var fileName = "transaction_" + transactionIndex+1 + ".json";

                    transactionIndex++;
                    archive.append( stringify( transaction.toJSON() ), { name: fileName } );
                })
                .catch( function(err) { deferred.error( err ); } )
                .done();
        }

        this.listTransactions().then( function(_transactions) {
            transactions = _transactions;
            transactionKeys = Object.keys( transactions );
            transactionKeys.sort();

            return 0;
        }).then( writeTransaction )
        .catch( function(err) { deferred.error( err ); } )
        .done();

        archive.pipe( output );
        archive.on('error', function(err) { deferred.error( err ) } );
        archive.on('close', function() { deferred.resolve() } );
        archive.on('entry', function(event) { writeTransaction() } );

        return deferred.promise;
    },

    restore: function( backupFile )
    {

    },

    incrementalBackup: function( backupFile )
    {

    },

    incrementalRestore: function( backupFile )
    {

    },

    query: function( query, args, callback )
    {

    },

    transaction: function( callback )
    {

    },

    receiveTransaction: function( callback )
    {

    },

    findMissingTransactions: function( callback )
    {

    },

    findCommonAncestor: function( callback )
    {

    },

    versionedAccess: function()
    {
        // select * from Tutorial where (id, version) in (select id, max(version) from Tutorial where id>10 and id<20 and version <= 4000 group by id)
        // and
    }
}

exports.TransactionInfo = TransactionInfo;
exports.Transaction = Transaction;
exports.DB = DB;
exports.ROOT = ROOT_OBJECT;
exports.Status = Status;
exports.ErrNo = ErrNo;
