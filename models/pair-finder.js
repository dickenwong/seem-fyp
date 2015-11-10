var Promise = require("bluebird");
var request = Promise.promisify(require("request"));
var jsonfile = require('jsonfile');
var fs = require('fs');
var moment = require('moment');
var Papa = require('papaparse');
moment().utcOffset(480);

function PairFinder() {
	var self = this;

	self.getStockHistoricalData = function(stockCode, startDate, endDate) {
		var reqDetail = {
			method: 'GET',
			url: 'http://real-chart.finance.yahoo.com/table.csv',
			qs: {
				s: stockCode, a: startDate.getMonth(), b: startDate.getDate(),
				c: startDate.getFullYear(), d: endDate.getMonth(), e: endDate.getDate(),
				f: endDate.getFullYear(), g: 'd', ignore: '.csv'
			},
			headers: {'Accept': 'text/csv'}
		};
		return request(reqDetail).then(function success(resp) {
			var headersInOrder = Papa.parse(resp[0].body, {
				delimiter: ',', newline: '\n', preview: 1
			}).data[0];
			var results = Papa.parse(resp[0].body, {
				delimiter: ',', newline: '\n', header: true
			}).data;
			var lastRecord = results[results.length - 1];
			if (lastRecord && lastRecord.Date == '') results.pop();
			return {
				headersInOrder: headersInOrder,
				results: results
			};
		});
	};
}

// var testFinder = new PairFinder();
// testFinder.getStockHistoricalData('0001.HK', new Date('2015-01-01'), new Date('2015-01-03')).then(function(data) {
// 	console.log(data);
// });


module.exports = PairFinder;
