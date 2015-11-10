'use strict';

/* Services */

var dataMiningServices = angular.module('dataMiningServices', []);

dataMiningServices.factory('YQLHelper', ['$http', '$q', 'Papa',
	function ($http, $q, Papa){
		var canceler = $q.defer();
		var doYQL = function(YQL) {
			return $http({
				method: 'GET',
				url: 'https://query.yahooapis.com/v1/public/yql',
				params: {
					format: 'json',
					q: YQL,
					env: 'store://datatables.org/alltableswithkeys',
					diagnostics: true,
					callback: ''
				},
				cache: false,
				responseType: 'json',
				timeout: canceler.promise
			});
		};
		var getHistoricalData = function(stockCode, startDate, endDate) {
			var req = $http({
				method: 'GET',
				url: 'http://real-chart.finance.yahoo.com/table.csv',
				params: {
					s: stockCode, a: startDate.getMonth(), b: startDate.getDate(),
					c: startDate.getFullYear(), d: endDate.getMonth(), e: endDate.getDate(),
					f: endDate.getFullYear(), g: 'd', ignore: '.csv'
				},
				cache: true,
				responseType: 'text/csv',
				timeout: canceler.promise
			});
			return req.then(function success(resp) {
				var config = { delimiter: ',', newline: '\n' };
				resp.data = {
					headersInOrder: Papa.parse(resp.data, angular.extend({preview: 1}, config)).data[0],
					results: Papa.parse(resp.data,angular.extend({header: true}, config)).data
				};
				return resp;
			});
		};
		var getHistoricalDataViaServer = function(stockCode, startDate, endDate) {
			var req = $http({
				method: 'GET',
				url: 'quotes/' + stockCode + '/',
				params: {start: startDate, end: endDate},
				cache: true,
				responseType: 'json',
				timeout: canceler.promise
			});
			return req;
		};
		var cancelAll = function() {
			canceler.resolve();
			canceler = $q.defer();
		};
		return {
			'doYQL': doYQL,
			'cancelAll': cancelAll,
			'getHistoricalData': getHistoricalData,
			'getHistoricalDataViaServer': getHistoricalDataViaServer
		};
	}
]);

dataMiningServices.factory('PairCalculator', ['$q',
	function ($q) {
		var _toDataByDate = function(stockData) {
			var dataByDate = {};
			stockData.forEach(function(record) {
				dataByDate[record.Date] = record;
			});
			return dataByDate;
		};

		var byLeastSquare = function(stockData1, stockData2) {
			stockData1 = _toDataByDate(stockData1);
			stockData2 = _toDataByDate(stockData2);
			var dates1 = Object.keys(stockData1);
			var dates2 = Object.keys(stockData2);
			var dates = dates1.concat(dates2.filter(function(date) {
				return dates1.indexOf(date) == -1;
			}));

			var sumOfSqDelta = 0;
			var dateCount = 0;
			dates.forEach(function(date) {
				if (!stockData1[date] || !stockData2[date]) return;
				var close1 = +stockData1[date].Close;
				var close2 = +stockData2[date].Close;
				var delta = close1 - close2;
				var sqDelta = delta * delta;
				sumOfSqDelta += sqDelta;
				dateCount += 1;
			});
			var avgSqDelta = sumOfSqDelta / dateCount;
			return avgSqDelta;
		};

		var byLeastSquareDeltaPercentChange = function(stockData1, stockData2) {
			stockData1 = _toDataByDate(stockData1);
			stockData2 = _toDataByDate(stockData2);
			var dates1 = Object.keys(stockData1);
			var dates2 = Object.keys(stockData2);
			var dates = dates1.concat(dates2.filter(function(date) {
				return dates1.indexOf(date) == -1;
			}));
			dates.sort(function(a, b){return new Date(a) - new Date(b);});

			var sumOfSqDelta = 0;
			var dateCount = 0;
			dates.forEach(function(date, i) {
				var nextDay = dates[i + 1];
				if (!nextDay) return;
				if (!stockData1[date] || !stockData2[date]) return;
				if (!stockData1[nextDay] || !stockData2[nextDay]) return;
				var day1close1 = +stockData1[date].Close;
				var day2close1 = +stockData1[nextDay].Close;
				var day1close2 = +stockData2[date].Close;
				var day2close2 = +stockData2[nextDay].Close;
				var percentChange1 = (day2close1 - day1close1) / day1close1;
				var percentChange2 = (day2close2 - day1close2) / day1close2;
				var delta = percentChange1 - percentChange2;
				var sqDelta = delta * delta;
				sumOfSqDelta += sqDelta;
				dateCount += 1;
			});
			var avgSqDelta = sumOfSqDelta / dateCount;
			return avgSqDelta;
		};

		return {
			'byLeastSquare': byLeastSquare,
			'byLeastSquareDeltaPercentChange': byLeastSquareDeltaPercentChange
		};
	}
]);

dataMiningServices.factory('PairCrawler',
	['$q', 'YQLHelper', 'Papa', 'PairCalculator',
	function ($q, YQLHelper, Papa, PairCalculator) {

		var _stockPool = [];
		var importStockPool = function(csvString) {
			var result = Papa.parse(csvString, {delimiter: ","});
			result = result.data.reduce(function(prev, current) {
				return prev.concat(current);
			}, []).map(function(item) {
				if (item.trim()) return item.trim();
			}).filter(function(item, pos, self) {
				return self.indexOf(item) == pos;
			});
			_stockPool = result;
			return _stockPool;
		};
		var crawl = function(ruleFuncName, startDate, endDate) {
			var pool = _stockPool;
			var getPromises = [];
			var dataset = [];
			pool.forEach(function(stock, i) {
				var promise = YQLHelper.getHistoricalDataViaServer(
                    stock, startDate, endDate
                );
				getPromises.push(promise);
			});
			return $q.all(getPromises).then(function(dataset) {
				var scores = [];
				dataset = dataset.map(function(resp) {
					return resp.data.results;
				});
				pool.forEach(function(stock1, i) {
					pool.forEach(function(stock2, j) {
						if (j <= i) return;
						var score = PairCalculator[ruleFuncName](dataset[i], dataset[j]);
						scores.push({
							stock1: stock1,
							stock2: stock2,
							score: score
						});
					});
				});
				return scores;
			});
		};
		return {
			'importStockPool': importStockPool,
			'crawl': crawl
		};
	}]
);

dataMiningServices.factory('StockCategories', [function(){
	return [
		{
			name: 'Banking',
			stocks: '0005.HK, 0011.HK, 0023.HK, 0440.HK, 0626.HK, 0939.HK, 0998.HK, 1111.HK, 1288.HK, 1398.HK, 1963.HK, 1988.HK, 2066.HK, 2356.HK, 2388.HK, 2888.HK, 3328.HK, 3618.HK, 3698.HK, 3968.HK, 3988.HK, 4605.HK, 6138.HK, 6818.HK'
		},
		{
			name: 'Insurance',
			stocks: '0662.HK, 0945.HK, 0966.HK, 1299.HK, 1336.HK, 1339.HK, 1508.HK, 2318.HK, 2328.HK, 2378.HK, 2601.HK, 2628.HK, 6161.HK',
		},
		{
			name: 'Properties',
			stocks: '0012.HK, 0016.HK, 0017.HK, 0020.HK, 0021.HK, 0028.HK, 0034.HK, 0035.HK, 0041.HK, 0050.HK, 0051.HK, 0059.HK, 0063.HK, 0081.HK, 0088.HK, 0095.HK, 0112.HK, 0115.HK, 0119.HK, 0123.HK, 0124.HK, 0127.HK, 0129.HK, 0160.HK, 0163.HK, 0169.HK, 0173.HK, 0183.HK, 0190.HK, 0199.HK'
		}
	];
}])
