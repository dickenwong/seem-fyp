var Promise = require("bluebird");
var request = Promise.promisify(require("request"));
var jsonfile = require('jsonfile');
var fs = require('fs');
var moment = require('moment');
var Papa = require('papaparse');
moment().utcOffset(480);

function PairFinder() {
	var self = this;
	var cache = [];

	self.baseRequest = function(stockCode, startDate, endDate, qs) {
		if (!(startDate instanceof Date)) startDate = new Date(startDate);
		if (!(endDate instanceof Date)) endDate = new Date(endDate);
		return request({
			method: 'GET',
			url: 'http://real-chart.finance.yahoo.com/table.csv',
			qs: Object.assign({}, {
				s: stockCode, a: startDate.getMonth(), b: startDate.getDate(),
				c: startDate.getFullYear(), d: endDate.getMonth(), e: endDate.getDate(),
				f: endDate.getFullYear(), ignore: '.csv'
			}, qs),
			headers: {'Accept': 'text/csv'}
		}).then(function success(resp) {
			var body = resp[0].body;
			var headersInOrder = Papa.parse(body, {delimiter: ',', newline: '\n', preview: 1}).data[0];
			var results = Papa.parse(body, {delimiter: ',', newline: '\n', header: true}).data;
			var lastRecord = results[results.length - 1];
			if (lastRecord && lastRecord.Date == '') results.pop();
			return {headersInOrder: headersInOrder, results: results};
		});
	};

	self.getStockHistoricalData = function(stockCode, startDate, endDate) {
		return self.baseRequest(stockCode, startDate, endDate, {g: 'd'});
	};

	self.getDividends = function(stockCode, startDate, endDate) {
		return self.baseRequest(stockCode, startDate, endDate, {g: 'v'});
	};

	// self.cacheStockData = function(stockCode, startDate, endDate, data) {
	// 	cache.forEach(function(cachedData, i) {
	// 		if (cachedData.stockCode == stockCode &&
	// 			cachedData.startDate == startDate &&
	// 			cachedData.endDate == endDate) {
	// 			cache.splice(i, 1);
	// 			return false;
	// 		}
	// 	});
	// 	cache.push({
	// 		stockCode: stockCode,
	// 		startDate: startDate,
	// 		endDate: endDate,
	// 		data: data
	// 	});
	// };

	// self.getStockDataFromCache = function(stockCode, startDate, endDate) {
	// 	var data = null;
	// 	cache.forEach(function(cachedData, i) {
	// 		if (cachedData.stockCode == stockCode &&
	// 			cachedData.startDate == startDate &&
	// 			cachedData.endDate == endDate) {
	// 			data = cachedData.data;
	// 			return false;
	// 		}
	// 	});
	// 	return data;
	// };


}

// var testFinder = new PairFinder();
// testFinder.getStockHistoricalData('0001.HK', new Date('2015-01-01'), new Date('2015-01-03')).then(function(data) {
// 	console.log(data);
// });


module.exports = PairFinder;
