var _ = require( 'lodash' );
_.mixin( require( 'underscore.deferred' ) );
var dexec = require( 'deferred-exec' );
var Gith = require( 'gith' );

// TODO: merge this into deferred-exec
var dfs = require('./deferred-fs.js');

// make this better/abstract out/find a plugin/whatever
var logger = function( type ) {
  return function() {
    if ( type !== 'Extra: ' || logger.verbose ) {
      var args = type ? [].concat.apply( [], [ type, arguments ] ) : arguments;
      console.log.apply( console, args );
    }
  };
};
var log = logger();
log.error = logger( 'Error: ' );
log.warn = logger( 'Warning: ' );
log.extra = logger( 'Extra: ' );

// standard operations
var standard = {
  updateGit: function( options, gitPath, remote ) {

    // default to origin
    remote = remote || 'origin';

    var gitCmd = 'GIT_WORK_TREE="' + gitPath + '" git --git-dir="' + gitPath + '.git"';

    // return a promise based on the git commands
    var update = dexec( gitCmd + ' fetch ' + remote ).then( function( stdout, stderr ) {
      // switch the working tree to the latest branch/sha/whatever we wanted
      var target = options.sha ? options.sha : ( remote + '/' + options.branch );
      return dexec( gitCmd + ' checkout -f ' + target )
        .done( function( stdout, stderr ) {
          log( 'Switching to updated content successful');
          log.extra( stdout, stderr );
        })
        .fail( function( error, stdout, stderr ) {
          log.error( 'Switching to updated content failed' );
          log.extra( stderr, stdout );
        });
    }).done( function( stdout, stderr ) {
      log( 'Updated contents from remote git repository' );
      log.extra( stdout, stderr );
    }).fail( function( error, stdout, stderr ) {
      log( 'Updating contents from remote git repository failed' );
      log.extra( stderr, stdout );
    });

    return update;
  },

  sync: function( gitDir, folder ) {
    var folderCheck = dfs.exists( folder ).then( null,
      function() {
        return dfs.mkdir( folder ).done( function() {
            log( 'Created ' + folder );
          })
          .fail( function( error ) {
            log.error( 'Creating ' + folder );
            log.extra( error );
          });
      });

    return folderCheck.then( function() {
      return dexec( 'rsync -r --delete-after --exclude .git --delete-excluded ' + gitDir + ' ' + folder )
        .done( function( stdout ) {
          log( 'Synced changes to ' + folder );
          log.extra( stdout );
        })
        .fail( function( error, stdout, stderr ) {
          log( 'Syncing changes to ' + folder + ' failed' );
          log.extra( stdout, stderr );
        });
    });
  }
};

var Bear = function( site, gith ){
  var bear = this;

  // keep a local ref to gith
  this.gith = gith;

  // used by other methods to see if this bear is ready to go
  this.ready = _.Deferred();

  // default settings
  var defaults = {
    liveBranch: "master"
  };

  if ( !site ) {
    log.error( 'Site configuration data is required' );
    bear.ready.reject();
  }

  // was this a filename?
  if ( typeof site === "string" ) {
    dfs.readFile( site, 'utf8' )
      .done( function( data ) {
        bear.settings = JSON.parse( data );
        bear.ready.resolve();
      })
      .fail( function() {
        log.error( 'Site configuration data at ' + site + ' was not found.' );
        bear.ready.reject();
      });
  }

  // a good ol' object - yay!
  if ( typeof site === "object" ) {
    this.settings = site || {};
    if ( !site.git ) {
      log.error( 'A git source folder is required in your site configuration' );
      bear.ready.reject();
    }
    bear.ready.resolve();
  }

  bear.ready.done( function() {
    bear.settings = _.extend( {}, defaults, bear.settings );
  });
};


Bear.prototype = {
  _deploy: function( branch, live, sha ) {

    var bear = this;

    // don't do stuff until bear is ready
    return bear.ready.then( function() {

      var targetDir;
      if ( live ) {
        targetDir = bear.settings.live;
      } else {
        targetDir = bear.settings.deploy + branch + '/';
      }

      var options = {
        branch: branch,
        sha: sha
      };

      // update the git repe
      var action = standard.updateGit( options, bear.settings.git );

      // attach hooks into actions
      _.each( bear.settings.hooks, function( hook ) {
        var split = hook.split('|');
        action = action.then( function() {
          return hooks[ split[0] ].call( bear, split[1] || '' );
        });
      });

      // finalize process by syncing changes
      return action.then( function() {
        return standard.sync( bear.settings.git, targetDir );
      });
    });
  },

  // manual methods for thy pleasure
  live: function( branch, sha ) {
    return this._deploy( branch || this.settings.liveBranch, true, sha );
  },
  stage: function( branch, sha ) {
      var options = {};
    return this._deploy( branch, false, sha );
  },

  // obligator getter and setter
  attr: function( setting, value ) {
    if ( !value ) {
      return this.settings[ setting ];
    } 
    this.settings[ setting ] = value;
    return this;
  },

  // but this is where the gold is
  start: function() {
    var bear = this;
    // don't bind until we're ready
    var srv = bear.ready.then( function() {
      var dfd = _.Deferred();
      // only make once
      if ( !bear.githInstance ) {
        bear.githInstance = bear.gith({
          repo: bear.settings.repo,
        }).on( 'all', bear._processPayload.bind( bear ) );
      }
      dfd.resolve( bear.githInstance );
      return dfd.promise();
    });

    return srv;
  },

  // process the payload gith emitted
  _processPayload: function( payload ) {
    var bear = this;
    var dfd = _.Deferred();
    var action = dfd.promise();

    // ok to launch live?
    if ( payload.branch === bear.settings.liveBranch  ) {
      // can we just upload master without worrying about tags?
      if ( !bear.settings.deployOnTag ) {
        action = action.then( function() {
          return bear.live( bear.settings.liveBranch);
        });
      } else if ( payload.tag ) {
        // since we tagged and that's required, only launch at that sha
        action = action.then( function() {
          return bear.live( bear.settings.liveBranch, payload.sha );
        });
      }
    }

    // either way, setup the staging version
    action = action.then( function() {
      return bear.stage( payload.branch );
    });

    // if we assigned a callback, fire it when these are done
    if ( bear.settings.githCallback ) {
      action.done( function() {
        bear.settings.githCallback.call( bear, payload );
      });
    }

    // start us off
    dfd.resolve();
  }

};

module.exports = function( port ) {
  return module.exports.create( port );
};

module.exports.create = function( port ) {

  var ret =  function( options ) {
    return new Bear( options, ret.gith );
  };

  ret.gith = Gith.create( port || 8000 );

  ret.verbose = function( toggle ) {
    logger.verbose = toggle;
  };

  return ret;
};

// todo - move this to its own folder and allow plugins to attach
// to it
var hooks = {

  // hook into our process
  npm: function() {
    return dexec( 'cd ' + this.settings.git + '; npm install' ).done(function( stdout, stderr ) {
        log( 'npm install successful' );
        log.extra( stdout, stderr );
      });
  },

  // run grunt based commands - tasks is a string or array of tasks
  // to follow the gruntCmd. gruntCmd defaults to `grunt` but can be
  // specified for other libs like `bbb`
  grunt: function( tasks ) {
    return hooks._grunt.call( this, tasks, 'grunt' );
  },
  bbb: function( tasks ) {
    return hooks._grunt.call( this, tasks, 'bbb' );
  },
  _grunt: function( tasks, gruntCmd ) {
      tasks = tasks || '';
      return dexec( 'cd ' + this.settings.git + '; ' + gruntCmd + ' --no-color ' + tasks )
        .done( function( stdout, stderr ) {
          log( '`' + gruntCmd + ' ' +  tasks + '` operation completed.' );
          log.extra( stdout, stderr );
        })
        .fail( function( error, stdout, stderr ) {
          log( '`' + gruntCmd + ' ' + tasks + '` operation failed :/' );
          log.extra( stdout, stderr );
        });
  }

};

