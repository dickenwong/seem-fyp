var express = require('express');
var path = require('path');
var router = express.Router();
var PairFinder = require('../models/pair-finder');

router.get('/', function (req, res) {

	res.sendFile(express.static(path.join(__dirname, 'static/html/data-mining.html')));
});

router.get('/pair/', function (req, res) {
	res.sendFile(express.static(path.join(__dirname, 'static/html/find-pair.html')));
});

router.get('/quotes/:stockCode/', function (req, res) {
	if (!req.params.stockCode || !req.query.start || !req.query.end) {
		res.sendStatus(400);
	}
	var stockCode = req.params.stockCode;
	var startDate = new Date(decodeURIComponent(req.query.start));
	var endDate = new Date(decodeURIComponent(req.query.end));
	var finder = new PairFinder();
	finder.getStockHistoricalData(stockCode, startDate, endDate).then(function (data) {
		res.json(data);
	});
});

module.exports = router;
