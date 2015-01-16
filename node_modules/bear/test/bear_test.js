/*
  ======== A Handy Little Nodeunit Reference ========
  https://github.com/caolan/nodeunit

  Test methods:
    test.expect(numAssertions)
    test.done()
  Test assertions:
    test.ok(value, [message])
    test.equal(actual, expected, [message])
    test.notEqual(actual, expected, [message])
    test.deepEqual(actual, expected, [message])
    test.notDeepEqual(actual, expected, [message])
    test.strictEqual(actual, expected, [message])
    test.notStrictEqual(actual, expected, [message])
    test.throws(block, [error], [message])
    test.doesNotThrow(block, [error], [message])
    test.ifError(value)
*/

// get and fire up bear on port 8000
var bear = require('../lib/bear.js').create( 8000 );
var dexec = require( 'deferred-exec' );
var dfs = require( '../lib/deferred-fs.js' );

var site = JSON.parse('{"repo":"danheberden/payloads","git":"test/gits/original-copy/","deploy":"test/site/deploy/","live":"test/site/live/","liveBranch":"master","deployOnTag":"true"}');

// make a new site
var testSite = bear( site );

// sanity:
bear.verbose( false );

var siteVerifiers = {
  live: function( test, deployedVersion, dontEndTest ) {
    var folder = deployedVersion ? site.deploy + 'master/' : site.live;
    var update1 = dfs.readFile( folder + 'master.txt', 'utf8' );

    var update2 = update1.then( function( err, data ) {
      test.equal( data, 'updated-master\n', 'master.txt should get updated' );
      return dfs.readFile( folder + 'additional-master.txt', 'utf8' )
    });

    var update3 = update2.then( function( err, data ) {
      test.equal( data, 'additional-master\n', 'additional-master.txt should get copied' );
    }, function(){
      console.log( 'failed', arguments ); 
    }).always( function() {
      if ( !dontEndTest ) {
        test.done();
      }
    });
  },
  stage: function( test, folder ) {
    var update1 = dfs.readFile( folder + 'master.txt', 'utf8' );

    var update2 = update1.then( function( err, data ) {
      test.equal( data, 'updated-master\n', 'master.txt should get updated' );
      return dfs.readFile( folder + 'stage.txt', 'utf8' )
    });

    var update3 = update2.then( function( err, data ) {
      test.equal( data, 'staging\n', 'stage.txt should get created' );
      return dfs.readFile( folder + 'additional-master.txt', 'utf8' );
    });

    var update4 = update3.then( function( err, data ) {
      test.equal( data, 'additional-master\n', 'additional-master.txt should get copied' );
    }, function(){
      console.log( 'failed', arguments ); 
    }).always( function() {
      test.done();
    });

  }
};
     
// failsafe
setTimeout( function() {
  process.exit(127);
}, 10000 );

exports['bear update stage and master'] = {
  setUp: function(done) {
    // clean up our testing area
    var commands = [ 
      'rm -rf test/gits/original-copy',
      'cp -r test/gits/original test/gits/original-copy',
      'rm -rf test/site/deploy test/site/live',
      'mkdir test/site/deploy test/site/live',
      'git --git-dir="test/gits/original-copy/.git" remote add origin "$(pwd)/test/gits/origin/.git"'
    ];
    dexec( commands.join( '; ' ) )
      .then( function() {
        done();
      }, function() {
        console.log( 'An error occurred setting up the test suite. Make sure the `gits` and `site` folders are present.', arguments );
        process.exit(1);
      });
  },
  tearDown: function(done) {
    // clean up behind ourselvesj
    dexec( 'rm -rf test/gits/original-copy; rm -rf test/site/live; rm -r test/site/deploy' )
      .then( function() {
        done();
      }, function() {
        console.log( 'An error occurred tearing down the test suite. ', arguments );
        done();
      });
  },
  'update master manually': function(test) {
    test.expect( 2 );
    // tests here
    testSite.live().then( function(){
      return siteVerifiers.live( test );
    });
  },

  'update staging manually' : function(test) {
    test.expect( 3 );
    var folder = site.deploy + 'stage/';
    testSite.stage( 'stage' ).then( function(){
      return siteVerifiers.stage( test, folder );
    });
  },
  'gith server created on default port': function(test) {
    test.expect(1);
    testSite.start().then( function( g ) {
      test.ok( testSite.gith.port, 8000, "gith server should be running on port 8000" );
      test.done();
    });
  },
  'test payload - update master with tag' : function(test) {
    test.expect(4);
    var json = require( './payloads/update-master-tag.json' );

    // verify the site once gith runs
    testSite.attr( 'githCallback', function() {
      siteVerifiers.live( test, false, true );
      siteVerifiers.live( test, true );
    });

    // broadcast the payload
    testSite.start().then( function( g ) {
      testSite.gith.payload( json );
    });
  }

};
