'use strict';

var fs = require('fs');
var yaml = require('js-yaml');
var Mustache = require('mustache');
var resolve = require('path').resolve;
var basename = require('path').basename;
var logger = require('../utils/logger');

function actionSync(dir, options) {
  var code = exports.run(dir, options);
  process.exit(code);
}

exports.cmd = function(program) {
  var pm = program
    .command('template')
    .description('Render config templates')
    .arguments('<path>')
    .option('-p, --properties <value>',
      'config properties as a JSON string')
    .on('--help', function() {
      console.log('  Description:');
      console.log('');
      console.log('    Render mustache config templates of a package at <path> using the');
      console.log('    package\'s properties.yml file. If config properties are supplied,');
      console.log('    it only merges the properties with the contents of properties.yml,');
      console.log('    without doing the actual rendering.');
      console.log('');
    });

  pm.action(actionSync);
};

/**
 * Merge package properties with existing ones.
 */

function writeProperties(config, file) {
  var newConfig = {};

  try {
    newConfig = yaml.safeLoad(fs.readFileSync(file));
  } catch (err) {
    // log any errors but keep going
    logger.log(err);
  }

  // merge properties
  for (var attr in config) {
    newConfig[attr] = config[attr];
  }

  try {
    fs.writeFileSync(file, yaml.safeDump(newConfig));
  } catch (err) {
    if (err instanceof SyntaxError) {
      logger.errorMessage(err.message);
      return 1;
    }

    logger.handleError(err);
    return 1;
  }

  logger.successMessage('Done');
  return 0;
}

/**
 * Make sure directory exists.
 */

function checkIsDirectory(dir) {
  try {
    var stats = fs.lstatSync(dir);

    if (!stats.isDirectory()) {
      logger.errorMessage('Not a valid package directory: ' + dir);
      return 1;
    }
  } catch (err) {
    logger.errorMessage(err.message);
    return 1;
  }
}

/**
 * Return the package's template list.
 */

function listTemplates(dir) {
  var files;

  try {
    files = fs.readdirSync(resolve(dir, 'config'));
  } catch (err) {
    // packages whithout config folder are ignored
    if (err.code === 'ENOENT') {
      logger.log(err);
      return [];
    }

    logger.handleError(err);
    return 1;
  }

  var templates = files.filter(function(file) {
    return file.match(/\.tmpl$/) !== null;
  });

  return templates;
}

/**
 * Render the package's templates using its properties file.
 */

function renderTemplates(dir, config, templates) {
  for (var i = 0; i < templates.length; i++) {
    var dirname = resolve(dir, 'config', templates[i]);

    var data;
    try {
      data = fs.readFileSync(dirname);
    } catch (err) {
      logger.handleError(err);
      return 1;
    }

    // add header
    var output = '; Dynamic riemann.config file for Riemann generated by Horus\n' +
      ';     DO NOT EDIT THIS FILE BY HAND -- YOUR CHANGES WILL BE OVERWRITTEN\n';

    output += Mustache.render(data.toString('utf8'), config);

    // create clj file from rendered template
    try {
      fs.writeFileSync(resolve(dir, 'config', basename(templates[i], '.tmpl') + '.clj'), output);
    } catch (err) {
      logger.handleError(err);
      return 1;
    }
  }
}

exports.run = function(dir, options) {
  var config;

  // remove trailing slash
  dir = dir.replace(/\/$/, '');

  if (checkIsDirectory(dir) === 1) {
    return 1;
  }

  if (options.properties) {
    try {
      config = JSON.parse(options.properties);
    } catch (err) {
      logger.handleError(err);
      return 1;
    }

    // merge properties with any existing ones
    return writeProperties(config, resolve(dir, 'properties.yml'));
  } else {
    var noProperties = false;

    // load properties
    try {
      config = yaml.safeLoad(fs.readFileSync(resolve(dir, 'properties.yml'), 'utf8'));
    } catch (err) {
      // packages whithout properties are valid if there are no templates
      if (err.code === 'ENOENT') {
        logger.log(err);
        noProperties = true;
      } else {
        logger.handleError(err);
        return 1;
      }
    }

    var templates = listTemplates(dir);
    if (templates === 1) {
      return 1;
    }

    if (noProperties) {
      // check whether there are templates
      if (templates.length === 0) {
        logger.successMessage('Done');
        return 0;
      } else {
        logger.errorMessage('Could not find \'properties.yml\' in this package although templates are defined');
        return 1;
      }
    }

    if (renderTemplates(dir, config, templates) === 1) {
      return 1;
    }

    logger.successMessage('Done');
    return 0;
  }
};
