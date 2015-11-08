"use strict";

var Q = require( 'q' );
var Qdb = require( './q-sqlite3.js')
var sqlite3 = require( 'sqlite3' );
var fs = require( 'fs' );
var zip = require( 'node-zip' );
var FS = require( 'q-io/fs' );
var SHA3 = require( 'sha3' );
var crypto = require( 'crypto' );

var ROOT_OBJECT = "root";

var STATUS_CURRENT = 1;
var STATUS_DELETED = 2;
var STATUS_OLD = 3;
var STATUS_OLD_DELETED = 4;

/**
 * Stringify method that sorts object keys. Needed to normalize transaction records.
 * The hash value for a transaction should always match, even if it is redone at a
 * later date.
 */
function stringify(obj)
{
    if (typeof obj == 'object')
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
            var keys = Object.keys( obj )

            keys.sort()
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

function Transaction()
{
    this.objects = {};
    this.content = {};
    this.deletedObjects = {};
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
        this.objects[ id/*.toString( 'hex' )*/ ] = obj;
        return obj;
    },

    modifyObject: function( obj, parent, pathElem, content, contentType, attributes )
    {
        this.objects[ obj.id.toString( 'hex' ) ]
            = { parent: parent ? (parent == ROOT_OBJECT ? NULL : parent.id.toString( 'hex' )) : obj.parentId,
                pathElem: pathElem ? pathElem : obj.pathElem,
                content: content ? content : obj.content,
                contentType: contentType ? contentType : obj.contentType,
                attributes: attributes ? attributes : obj.attributes }
    },

    deleteObject: function( obj )
    {
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

    hash: function()
    {
        // objects in id order:
        // id + parent + pathElem + content + contentType + attributes
        // content in hash order:
        // hash
        var d = new SHA3.SHA3Hash( 224 );
        var keys = Object.keys( this.objects );
        var that = this;

        keys.forEach( function(key) { 
            var obj = that.objects[ key ]

            d.update( obj.id )
            if (obj.parent)
                d.update( obj.parent );
            if (obj.pathElem)
                d.update( obj.pathElem );
            if (obj.content)
            {
                d.update( obj.content );
                d.update( obj.contentType );
            }
            if (Object.keys( obj.attributes ).length)
            {
                d.update( stringify( obj.attributes ) );
            }
        });
        keys = Object.keys( this.content );
        keys.forEach( function(key) { d.update( key ) } );
        return d
    },
}

function mistDb( fileName )
{
    this.fileName = fileName;
    this.db = null;
    this.lock = null;
}

mistDb.prototype =
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
            .then( function (exists) { if (exists) throw new Error( "mistDb.create '" + that.fileName + "' already exists" ) } )
            .then( function() { return Qdb.createDatabase( that.fileName, Qdb.OPEN_CREATE|Qdb.OPEN_READWRITE ) } )
            .then( function (db) { that.db = db } )
            .then( function () { that.db.run( "CREATE TABLE Object (id, version, status, parent, pathElem, content, contentType)" ) } )
            .then( function () { that.db.run( "CREATE TABLE Attribute (id, version, name, value, json)" ) } )
            .then( function () { that.db.run( "CREATE TABLE Content (hash, nr, content)" ) } )
            .then( function () { that.db.run( "CREATE TABLE \"Transaction\" (version, timestamp, user, hash, signature)" ) } )
            .then( function () { that.db.run( "CREATE TABLE TransactionParent (version, parentVersion)" ) } )
            .then( function () { that.db.run( "CREATE TABLE Setting (name, value)" ) } );
        // Create table log, find out which versions we received when


        // Create /access/
        // Create /access/ user1 with correct permissions
        // Higher level
    },

    verifyTransaction: function( transaction, callback )
    {
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

    getLock: function( callback )
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
            this.lock.shift.call( this );
    },

    runTransaction: function( transaction )
    {
        var version, parentTransactions;
        var hasErr = false;
        var deferred = Q.defer();
        var that = this

        this.getLock()
            .then( function() { return that.db.run( "BEGIN TRANSACTION" ) } )
            .then( function() {
                // Find all versions that do not have a child transaction yet
                // We handle merges by letting the next transaction have all these transactions as parent
                return that.db.all( 'SELECT t.version AS version, t.hash AS hash FROM "Transaction" AS t LEFT OUTER JOIN TransactionParent AS tp ON t.version=tp.version WHERE tp.version IS NULL' )
            })
            .then( function(rows) {
                parentTransactions = rows
            })
            .then( function() {
                // Find the local number for our transaction
                return that.db.all( 'SELECT MAX(version) AS max From "Transaction"' )
            })
            .then( function(rows) {
                if (rows.length)
                    version = rows[0].max + 1
                else
                    version = 1
                // Create the new transaction
                return that.db.run( 'INSERT INTO "Transaction" (version, timestamp) VALUES (?, DATETIME(\'now\'))',
                    [version] )
            })
            .then( function() {
                var res = parentTransactions.map( function(row) {
                    return that.db.run( 'INSERT INTO TransactionParent (version, parentVersion) VALUES (?, ?)',
                        [version, row.version] )
                })
                return Q.all( res );
            })
            .then( function() {
                var res = []

                for (let i in transaction.objects)
                {
                    var obj = transaction.objects[i];

                    res.push( that.db.run( 'UPDATE Object SET status=status+2 WHERE id=? AND status <= 2',
                        [obj.id] ) );
                    res.push( that.db.run( 'INSERT INTO Object (id, version, status, parent, pathElem, content, contentType) VALUES (?, ?, ?, ?, ?, ?, ?)',
                        [ obj.id, version, STATUS_CURRENT, obj.parent, obj.pathElem, obj.concat, obj.contentType ] ) );
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
                            [obj.id, version, j, a, json ] ) );
                    }
                }
                return Q.all( res );
            } )
            .then( function() {
                var d = transaction.hash();
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

    restore: function( backupFile, callback )
    {

    },

    backup: function( backupFile, callback )
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
}

exports.Transaction = Transaction;
exports.mistDb = mistDb;
exports.ROOT = ROOT_OBJECT;
