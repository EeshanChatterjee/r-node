/*
    Copyright 2010 Jamie Love

    This file is part of the "R-Node Server".

    R-Node Server is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 2.1 of the License, or
    (at your option) any later version.

    R-Node Server is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with R-Node Server.  If not, see <http://www.gnu.org/licenses/>.
*/

var SYS     = require("sys");
var QUERY   = require ("querystring");
var URL     = require("url");
var UTILS   = require("../rnodeUtils");
var FS      = require("fs");

exports.name = "/R";

var defaultReturnFormat = "raw";

/*
 * Restricted commands, we don't run.
 * This isn't really designed to stop users from doing these commands (there are easy ways
 * around them), but it ensures that users don't accidentally run commands that could mess
 * up the remote R connection we're providing.
 */
function isRestricted (cmd) {
    var r = [
        /^\s*q\s*\(/i,
        /^\s*quit\s*\(/i,
        /^\s*help\s*\(/i,
        /^\s*\?/i,
        /^\s*\.internal\s*\(/i,
        /^\s*system/i
    ];

    for (var i = 0; i < r.length; ++i) {
        if (cmd.search(r[i]) >= 0) {
            return true;
        }
    }

    return false;
}

var pageFilePrefix = '';
var pageFiles = {
};
function pager (rResp) {
    for (var i = 0; i < rResp.values.length; i++) {
        var key = SHA256.hex_sha256 (rResp.values[i] + (new Date().getTime()));
        SYS.debug ('adding ' + key + ' to list for ' + rResp.values[i]);
        pageFiles[key] = { file: rResp.values[i], deleteFile: rResp.attributes['delete'] == "TRUE" };
        rResp.values[i] = key;
    }
}

function handlePage(req, resp, sid, rNodeApi) {
    var url = URL.parse (req.url, true);
    var parts = url.href.split(/\?/)[0].split(/\//);
    var file = parts.length == 3 ? parts[2] : null;
    if (!file || !pageFiles[file]) {
        rNodeApi.log(req, 'Error finding file for page request.');
        resp.writeHeader(404, { "Content-Type": "text/plain" });
        resp.end();
        return;
    }

    UTILS.streamFile (pageFilePrefix + pageFiles[file].file, 'text/plain', resp, function (err) {
        if (err)
            rNodeApi.log (req, 'Error streaming paged file to client: ' + err);
        if (pageFiles[file].deleteFile)
            FS.unlinkSync(pageFilePrefix + pageFiles[file].file);

        pageFiles[file] = null;
    });
}

function handleR (req, resp, sid, rNodeApi) {
    var url = URL.parse (req.url, true);
    var parts = url.href.split(/\?/)[0].split(/\//);
    var request = QUERY.unescape(parts[2]);

    var format = url.query.format || defaultReturnFormat;
    if (format == "pretty") {
        request = "paste(capture.output(print(" + request + ")),collapse=\"\\n\")";
    }

    if (isRestricted(request)) {
        rNodeApi.log (req, 'R command \'' + request + '\' is restricted.');
        resp.writeHeader(403);
        resp.end();
        return;
    }

    rNodeApi.log(req, 'Executing R command: \'' + request + '\'');

    // Find session
    var r = rNodeApi.getRConnection(sid, false);

    // If we don't have a sessions, we've got a problem! we shouldn't be here.
    if (!r) {
        resp.writeHeader(500, { "Content-Type": "text/plain" });
        resp.end();
        return;
    }

    r.request(request, function (rResp) {
            
        if (rResp && rResp.attributes && rResp.attributes.class && rResp.attributes.class[0] == 'RNodePager') {
            pager (rResp);
        }

        var str = JSON.stringify(rResp);

        rNodeApi.log (req, 'Result of R command: \'' + request + '\' received.');

        if (format == "pretty" && rResp.length) {
            str = rResp[0];
        }

        resp.writeHeader(200, {
          "Content-Length": str.length,
          "Content-Type": "text/plain" // Change to application/json TODO
        });
        resp.write (str);
        resp.end();
    });
    return true;
}

exports.init = function (rNodeApi) {
    rNodeApi.addRestrictedUrl(/^\/R\//);
    rNodeApi.addRestrictedUrl(/^\/pager\//);
}

exports.handle = function (req, resp, sid, rNodeApi) {
    if (req.url.beginsWith ('/R/')) {
        handleR (req, resp, sid, rNodeApi);
        return true;
    } else if (req.url.beginsWith ('/pager/')) {
        handlePage (req, resp, sid, rNodeApi);
        return true;
    }
    return false;
}

exports.canHandle = function (req, rNodeApi) {
    return req.url.beginsWith ('/R/') || req.url.beginsWith('/pager/');
}