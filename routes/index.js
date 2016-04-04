var express = require('express');
var path = require('path');
var router = express.Router();
var PairFinder = require('../models/pair-finder');


router.get('/', function (req, res) {
	res.sendFile(path.join(__dirname, '../static/html/data-mining.html'));
});


router.get('/pair/', function (req, res) {
	res.sendFile(path.join(__dirname, '../static/html/find-pair.html'));
});


router.get('/quotes/:stockCode/',
	handleDataRequest.bind(null, 'getStockHistoricalData'));


router.get('/dividends/:stockCode/',
	handleDataRequest.bind(null, 'getDividends'));


function handleDataRequest(finderMethod, req, res) {
	if (!req.params.stockCode || !req.query.start || !req.query.end) {
		res.sendStatus(400);
	}
	(new PairFinder())[finderMethod](
		req.params.stockCode,
		req.query.start,
		req.query.end
	).then(function (data) {
		res.set('Cache-Control', 'public, max-age=31536000');
		res.json(data);
	});
}


module.exports = router;
