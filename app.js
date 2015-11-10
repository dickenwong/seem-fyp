var express = require('express');
var http = require('http');
var path = require('path');
var bodyParser = require('body-parser');
var logger = require('morgan');
var router = require('./routes/index');

var pairFinder = require('./models/pair-finder');

var app = express();
var httpServer = http.createServer(app);

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));
app.use('/', router);
app.use(express.static(path.join(__dirname, 'static')));

var httpPort = process.env.PORT || 5555;
httpServer.listen(httpPort, function () {
    console.log('Http Server serving on localhost port %d', httpPort);
});
