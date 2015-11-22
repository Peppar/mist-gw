'use strict';

function ConnectError( message, errno ) {
    Error.captureStackTrace( this, this.constructor );
    this.name = this.constructor.name;
    this.message = message;
    this.errno = errno;
};

require('util').inherits(ConnectError, Error);

exports.ConnectError = ConnectError;

exports.create = function( message, errno ) {
    return new ConnectError( message, errno );
};

exports.E_SOCKS        = 1000;
exports.E_CONNECT_BAD  = 1001;
exports.E_CONNECT_FAIL = 1002;
