 
// makes all of the asyncronous fs methods return a promise
var fs = require( 'fs' );
var _ = require( 'lodash' );
_.mixin( require( 'underscore.deferred' ) );

  /* deferred wrapper for fs */
module.exports = (function() {
  var wrap = function( functionName, args ) {
    var dfd = _.Deferred();
    var as = [].concat( [].slice.call( args ), function( res, values ){
      if ( ( res !== null && values ) || ( res === false && values === undefined ) ) {
        dfd.reject.apply( dfd, arguments );
      } else {
        dfd.resolve.apply( dfd, arguments );
      }
    });
    fs[ functionName ].apply( fs, as );
    return dfd.promise();
  };
  var methods = {};
  _.each( fs, function( fn, key ) {
    if ( !/Sync/.test( key ) ) {
      methods[ key ] = function() {
        return wrap( key, arguments );
      };
    }
  });
  return methods;
}());

